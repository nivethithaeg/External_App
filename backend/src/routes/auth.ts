import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { badRequest, conflict, HttpError, unauthorized } from '../errors.js';
import { parse } from '../lib/http.js';
import { renderEmail } from '../lib/emailTemplate.js';
import { audit } from '../lib/audit.js';
import { ADMIN_PERMISSIONS } from '../middleware/auth.js';
import { normalizePhone, phoneCandidates, INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE } from '../lib/phone.js';
import { syncAccount } from '../lib/accounts.js';
import jwt from 'jsonwebtoken';
import { newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from '../lib/totp.js';

const password = z.string().min(8).max(72).regex(/[A-Za-z]/, 'Must contain a letter').regex(/[0-9]/, 'Must contain a digit');
const phone = z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE);

const registerSchema = z.object({
  email: z.email().max(254), password, fullName: z.string().trim().min(2).max(100),
  phone: phone.optional(), role: z.enum(['customer', 'owner']).default('customer'),
  businessName: z.string().trim().min(2).max(150).optional(),
  confirmPassword: z.string().max(72).optional(),
  preferredSports: z.array(z.string().trim().max(40)).max(12).optional(), city: z.string().trim().max(80).optional(), // optional customer preferences
}).refine((x) => x.confirmPassword === undefined || x.confirmPassword === x.password, { message: 'Passwords do not match', path: ['confirmPassword'] })
  .refine((x) => x.role !== 'customer' || !!x.phone, { message: 'Enter your mobile number', path: ['phone'] }); // customers sign up with a mobile number

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const publicUser = (u: any) => ({
  id: u.id, email: u.email, phone: u.phone, fullName: u.full_name, role: u.role, adminRole: u.admin_role,
  // an admin's effective permissions, so the portal can hide pages they cannot open ('*' = everything)
  ...(u.role === 'admin' ? { permissions: u.admin_role === 'super_admin' ? ['*'] : u.admin_permissions ?? ADMIN_PERMISSIONS[u.admin_role] ?? [] } : {}),
  emailVerified: u.email_verified, phoneVerified: u.phone_verified, credentialSet: u.password_set !== false, // named so the user object never contains the word password
});

export function authRoutes(ctx: Ctx) {
  const r = Router();
  const rounds = ctx.cfg.NODE_ENV === 'test' ? 4 : 12;
  const auth = authenticate(ctx);

  async function findByIdentifier(id: string) {
    return id.includes('@')
      ? (await ctx.db.query('SELECT * FROM users WHERE lower(email)=lower($1)', [id.trim()])).rows[0]
      : (await ctx.db.query('SELECT * FROM users WHERE phone = ANY($1)', [phoneCandidates(id)])).rows[0];
  }

  // ---- admin two-step sign-in with an authenticator app (Google Authenticator and the like) ----
  const adminNeedsMfa = (u: { role: string }) => u.role === 'admin' && ctx.cfg.ADMIN_MFA === 'true';
  const mfaKey = () => ctx.cfg.MFA_ENCRYPTION_KEY || ctx.cfg.JWT_SECRET;
  const mfaJwtKey = () => `${ctx.cfg.JWT_SECRET}:admin-mfa`; // a different key, so this token can never be used as a session
  /** After the password: a 10-minute ticket for the code step, plus the QR details the first time. */
  async function mfaChallenge(u: any, remember: boolean) {
    const mfaToken = jwt.sign({ sub: u.id, tv: u.token_version ?? 0, rm: remember, p: 'mfa' }, mfaJwtKey(), { expiresIn: '10m' });
    if (u.totp_enabled_at) return { mfaRequired: true, mfaToken };
    let secret: string | null = null;
    try { secret = u.totp_secret_enc ? openSecret(u.totp_secret_enc, mfaKey(), [ctx.cfg.JWT_SECRET]) : null; } catch { secret = null; }
    if (!secret) { secret = newTotpSecret(); await ctx.db.query('UPDATE users SET totp_secret_enc=$2 WHERE id=$1', [u.id, sealSecret(secret, mfaKey())]); }
    return { mfaSetupRequired: true, mfaToken, secret, otpauthUrl: otpauthUrl(secret, u.email) };
  }

  async function issueOtp(userId: string, channel: 'email' | 'phone', target: string, name: string) {
    const last = await ctx.db.query(`SELECT created_at FROM otp_codes WHERE user_id=$1 AND channel=$2 ORDER BY created_at DESC LIMIT 1`, [userId, channel]);
    if (last.rows[0] && ctx.now().getTime() - new Date(last.rows[0].created_at).getTime() < 30000)
      throw new HttpError(429, 'Please wait 30 seconds before requesting another code', 'otp_cooldown');
    const hour = await ctx.db.query(`SELECT count(*)::int AS n FROM otp_codes WHERE user_id=$1 AND channel=$2 AND created_at > $3`, [userId, channel, new Date(ctx.now().getTime() - 3600000).toISOString()]);
    if (hour.rows[0].n >= 5) throw new HttpError(429, 'Too many codes requested. Please try again in an hour.', 'otp_hourly_limit');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await ctx.db.query(`INSERT INTO otp_codes (user_id, channel, code_hash, expires_at) VALUES ($1,$2,$3,$4)`,
      [userId, channel, sha(code + userId), new Date(ctx.now().getTime() + 10 * 60000).toISOString()]);
    if (channel === 'email')
      await ctx.mailer.send(target, 'Your PlaynX verification code', renderEmail({ appUrl: ctx.mailer.appUrl ?? 'http://localhost:5173', ...ctx.mailer.brand, type: 'otp', title: 'Verification code', name, role: (await ctx.db.query('SELECT role FROM users WHERE id=$1', [userId])).rows[0]?.role,
        text: 'Use this code to verify your email on PlaynX:',
        html: `<div style="margin:18px 0 6px;padding:18px;border-radius:16px;background:#F5F0FF;border:1px dashed #A100FF;text-align:center;font:800 36px 'Poppins',Arial,sans-serif;letter-spacing:10px;color:#7200FF">${code}</div><div style="font-size:13px;color:#777B90;text-align:center">It expires in 10 minutes. If you did not ask for it, you can ignore this email.</div>` }));
    else await ctx.sms.send(target, `PlaynX: your verification code is ${code}. Valid for 10 minutes.`);
  }

  async function checkOtp(userId: string, channel: 'email' | 'phone', code: string) {
    const { rows } = await ctx.db.query(
      `SELECT * FROM otp_codes WHERE user_id=$1 AND channel=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, [userId, channel]);
    const otp = rows[0];
    if (!otp || new Date(otp.expires_at) < ctx.now()) throw badRequest('Code expired or not requested', 'otp_expired');
    if (otp.attempts >= 5) throw new HttpError(429, 'Too many attempts. Request a new code.', 'otp_locked');
    await ctx.db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1', [otp.id]);
    const ok = crypto.timingSafeEqual(Buffer.from(otp.code_hash), Buffer.from(sha(code + userId)));
    if (!ok) throw badRequest('Incorrect code', 'otp_invalid');
    await ctx.db.query('UPDATE otp_codes SET consumed_at = now() WHERE id=$1', [otp.id]);
  }

  /** Which verification channels actually work on this server, so the app never pretends a text was sent. */
  r.get('/verification-options', (_req, res) => res.json({ email: !!ctx.cfg.SMTP_HOST, sms: !!ctx.cfg.SMS_WEBHOOK_URL }));

  r.post('/register', async (req, res) => {
    const b = parse(registerSchema, req.body);
    const hash = await bcrypt.hash(b.password, rounds);
    const user = await ctx.db.tx(async (q) => {
      // Say exactly which field clashes so the form can show the reason next to it.
      if ((await q.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [b.email])).rows[0]) throw new HttpError(409, 'An account with this email address already exists. Log in instead, or reset your password if you have forgotten it.', 'email_taken', { field: 'email' });
      if (b.phone && (await q.query('SELECT 1 FROM users WHERE phone = ANY($1)', [phoneCandidates(b.phone)])).rows[0]) throw new HttpError(409, 'An account with this mobile number already exists. Log in with it instead, or use a different number.', 'phone_taken', { field: 'phone' });
      const u = (await q.query(
        `INSERT INTO users (email, phone, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [b.email.toLowerCase(), b.phone ? normalizePhone(b.phone) : null, hash, b.fullName, b.role])).rows[0];
      if (b.role === 'customer') {
        const slugs = b.preferredSports?.length ? (await q.query('SELECT slug FROM sports WHERE slug = ANY($1)', [b.preferredSports])).rows.map((r: any) => r.slug) : [];
        await q.query('INSERT INTO customer_profiles (user_id, city, preferred_sports) VALUES ($1,$2,$3)', [u.id, b.city || null, slugs]);
      }
      else await q.query('INSERT INTO owner_profiles (user_id, business_name) VALUES ($1,$2)', [u.id, b.businessName ?? b.fullName]);
      await audit(q, null, 'user.register', 'user', u.id, { role: b.role });
      return u;
    });
    await syncAccount(ctx.db, user.id);
    if (b.role !== 'owner') { // a venue owner asks for the code on the verification step of the application, not at sign-up
      await issueOtp(user.id, 'email', user.email, user.full_name).catch((e) => console.error('[otp] email send failed', e));
      if (user.phone) await issueOtp(user.id, 'phone', user.phone, user.full_name).catch((e) => console.error('[otp] sms send failed', e));
    }
    if (b.role === 'owner') await ctx.notifier.notifyAdmins('users', { title: 'New turf owner registered', body: `${user.full_name} created an owner account and is completing the application.`, type: 'admin_owner_registered', email: true, data: { link: '/admin/applications' } });
    res.status(201).json({ token: signToken(ctx, user), user: publicUser(user) });
  });

  r.post('/login', async (req, res) => {
    // `email` accepts either the registered email address or the mobile number.
    const b = parse(z.object({ email: z.string().min(3).max(254), password: z.string().max(72), remember: z.boolean().default(true) }), req.body);
    const u = await findByIdentifier(b.email);
    // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
    const ok = await bcrypt.compare(b.password, u?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
    if (!u || !ok) throw unauthorized('Incorrect email or password');
    if (!u.is_active) throw new HttpError(403, 'This account has been suspended. Please contact PlaynX support for help.', 'account_disabled');
    if (adminNeedsMfa(u)) return void res.json(await mfaChallenge(u, b.remember)); // no session until the authenticator code is entered
    await audit(ctx.db, req, 'user.login', 'user', u.id, {}, u.id);
    const token = signToken(ctx, u, b.remember ? '30d' : '12h');
    await syncAccount(ctx.db, u.id, { loggedIn: true });
    res.json({ token, user: publicUser(u) });
  });

  /** The second step of an admin sign-in: the 6-digit code from the authenticator app (the first one also finishes setup). */
  r.post('/mfa/verify', async (req, res) => {
    const b = parse(z.object({ mfaToken: z.string().min(10).max(2048), code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app') }), req.body);
    let t: any;
    try { t = jwt.verify(b.mfaToken, mfaJwtKey()); } catch { throw unauthorized('This sign-in has expired. Please log in again.'); }
    if (t?.p !== 'mfa') throw unauthorized('This sign-in has expired. Please log in again.');
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [t.sub])).rows[0];
    if (!u || !u.is_active || u.role !== 'admin' || (u.token_version ?? 0) !== t.tv) throw unauthorized('This sign-in has expired. Please log in again.');
    if (u.mfa_locked_until && new Date(u.mfa_locked_until) > ctx.now()) throw new HttpError(429, 'Too many incorrect codes. Please try again in 15 minutes.', 'mfa_locked');
    let secret: string;
    try { secret = openSecret(u.totp_secret_enc ?? '', mfaKey(), [ctx.cfg.JWT_SECRET]); } catch { throw unauthorized('Set up your authenticator again: please log in again.'); }
    const step = verifyTotp(secret, b.code, ctx.now().getTime(), u.totp_last_step == null ? null : Number(u.totp_last_step));
    if (step === null) {
      const fails = (u.mfa_failed_count ?? 0) + 1;
      await ctx.db.query(`UPDATE users SET mfa_failed_count=$2, mfa_locked_until=$3 WHERE id=$1`, [u.id, fails >= 5 ? 0 : fails, fails >= 5 ? new Date(ctx.now().getTime() + 15 * 60000).toISOString() : null]);
      await audit(ctx.db, req, 'user.mfa_failed', 'user', u.id, {}, u.id);
      throw new HttpError(401, fails >= 5 ? 'Too many incorrect codes. Please try again in 15 minutes.' : 'Incorrect code. Check the time on your phone and try the newest code.', fails >= 5 ? 'mfa_locked' : 'mfa_invalid');
    }
    const firstTime = !u.totp_enabled_at;
    const nu = (await ctx.db.query(`UPDATE users SET totp_last_step=$2, totp_enabled_at=COALESCE(totp_enabled_at, now()), mfa_failed_count=0, mfa_locked_until=NULL WHERE id=$1 RETURNING *`, [u.id, step])).rows[0];
    await audit(ctx.db, req, firstTime ? 'user.mfa_enabled' : 'user.login', 'user', u.id, { mfa: true }, u.id);
    if (firstTime) await ctx.notifier.notify(u.id, { title: 'Two-step sign-in is on', type: 'security', email: true, body: 'Your PlaynX admin account now asks for a code from your authenticator app every time you sign in. If this was not you, contact another admin immediately.' });
    await syncAccount(ctx.db, u.id, { loggedIn: true });
    res.json({ token: signToken(ctx, nu, t.rm === false ? '12h' : '30d'), user: publicUser(nu) });
  });

  /** "Continue with Google": the ID token is verified server-side; Google has already verified the email. */
  r.post('/google', async (req, res) => {
    const b = parse(z.object({
      credential: z.string().min(10).max(4096), create: z.boolean().default(false),
      role: z.enum(['customer', 'owner']).default('customer'), businessName: z.string().trim().min(2).max(150).optional(),
      expect: z.enum(['customer', 'owner']).optional(), // sign-up pages: refuse to sign into an account of the other type
    }), req.body);
    let g;
    try { g = await ctx.google.verify(b.credential); } catch (e) { if (e instanceof HttpError) throw e; throw unauthorized('Invalid Google sign-in'); }
    let u = (await ctx.db.query('SELECT * FROM users WHERE lower(email)=lower($1)', [g.email])).rows[0];
    if (u && b.expect && u.role !== b.expect && (u.role === 'customer' || u.role === 'owner'))
      throw new HttpError(409, `This Google email is already registered as a ${u.role === 'owner' ? 'venue owner' : 'customer'} account, so it can't be used to sign up as a ${b.expect === 'owner' ? 'venue owner' : 'customer'}. Use a different Google account, or log in to continue as a ${u.role === 'owner' ? 'venue owner' : 'customer'}.`, 'role_mismatch');
    if (!u) {
      if (!b.create) throw new HttpError(404, 'No account found for this Google email. Please sign up first.', 'no_account');
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), rounds); // unusable password; user can set one via reset
      u = await ctx.db.tx(async (q) => {
        const nu = (await q.query(`INSERT INTO users (email, password_hash, full_name, role, email_verified, password_set) VALUES ($1,$2,$3,$4,false,false) RETURNING *`, [g.email, hash, g.name.slice(0, 100), b.role])).rows[0]; // Google proves the address, but every new account still confirms it with a code
        if (b.role === 'customer') await q.query('INSERT INTO customer_profiles (user_id) VALUES ($1)', [nu.id]);
        else await q.query('INSERT INTO owner_profiles (user_id, business_name) VALUES ($1,$2)', [nu.id, b.businessName ?? nu.full_name]); // the real business name is asked in the application
        await audit(q, null, 'user.register_google', 'user', nu.id, { role: b.role });
        return nu;
      });
      await issueOtp(u.id, 'email', u.email, u.full_name).catch((e) => console.error('[otp] email send failed', e)); // players and venue owners alike confirm a Google email with the code
      if (b.role === 'owner') await ctx.notifier.notifyAdmins('users', { title: 'New turf owner registered', body: `${u.full_name}${b.businessName ? ` (${b.businessName})` : ''} signed up with Google and is completing the application.`, type: 'admin_owner_registered', email: true, data: { link: '/admin/applications' } });
    } else {
      if (!u.is_active) throw new HttpError(403, 'This account has been disabled', 'account_disabled');
      if (adminNeedsMfa(u)) throw new HttpError(403, 'Admins sign in with their email, password and authenticator code.', 'admin_password_only');
    }
    await audit(ctx.db, req, 'user.login_google', 'user', u.id, {}, u.id);
    await syncAccount(ctx.db, u.id, { loggedIn: true });
    res.json({ token: signToken(ctx, u), user: publicUser(u) });
  });

  r.get('/me', auth, async (req, res) => {
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [req.user!.id])).rows[0];
    res.json({ user: publicUser(u) });
  });

  r.post('/otp/send', auth, async (req, res) => {
    const { channel } = parse(z.object({ channel: z.enum(['email', 'phone']) }), req.body);
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [req.user!.id])).rows[0];
    if (channel === 'phone' && !u.phone) throw badRequest('Add a phone number to your profile first', 'no_phone');
    await issueOtp(u.id, channel, channel === 'email' ? u.email : u.phone, u.full_name);
    res.json({ sent: true });
  });

  r.post('/otp/verify', auth, async (req, res) => {
    const b = parse(z.object({ channel: z.enum(['email', 'phone']), code: z.string().regex(/^\d{6}$/) }), req.body);
    await checkOtp(req.user!.id, b.channel, b.code);
    const col = b.channel === 'email' ? 'email_verified' : 'phone_verified';
    const u = (await ctx.db.query(`UPDATE users SET ${col}=true, updated_at=now() WHERE id=$1 RETURNING *`, [req.user!.id])).rows[0];
    await syncAccount(ctx.db, u.id);
    res.json({ user: publicUser(u) });
  });

  /** An account created with Google chooses its own password once, so it can also sign in with email and password. */
  r.post('/set-password', auth, async (req, res) => {
    const b = parse(z.object({ newPassword: password, confirmPassword: z.string().max(72) }).refine((x) => x.confirmPassword === x.newPassword, { message: 'Passwords do not match', path: ['confirmPassword'] }), req.body);
    const u = (await ctx.db.query('SELECT id, password_set FROM users WHERE id=$1', [req.user!.id])).rows[0];
    if (u.password_set !== false) throw new HttpError(409, 'You already have a password. Use Change password in your account instead.', 'password_already_set');
    await ctx.db.query('UPDATE users SET password_hash=$2, password_set=true, updated_at=now() WHERE id=$1', [u.id, await bcrypt.hash(b.newPassword, rounds)]);
    await syncAccount(ctx.db, u.id);
    await audit(ctx.db, req, 'user.password_set', 'user', u.id, {});
    res.json({ passwordSet: true });
  });

  /**
   * A venue owner who signed up with Google: Google gave the email; the owner still fills in first name, last name, mobile
   * number and a password (and accepts the terms) before the portal opens.
   */
  r.post('/complete-signup', auth, async (req, res) => {
    const nm = z.string().trim().min(1, 'Enter the name').max(50).regex(/^[\p{L}][\p{L} .'-]*$/u, 'Use letters only');
    const b = parse(z.object({ firstName: nm, lastName: nm, phone: z.string().trim().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE), newPassword: password, confirmPassword: z.string().max(72),
      acceptTerms: z.literal(true, 'Please accept the Terms and Conditions') }).refine((x) => x.confirmPassword === x.newPassword, { message: 'Passwords do not match', path: ['confirmPassword'] }), req.body);
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [req.user!.id])).rows[0];
    if (u.role !== 'owner') throw new HttpError(403, 'Only venue owner accounts finish sign-up here', 'forbidden');
    if (u.password_set !== false) throw new HttpError(409, 'Your account is already set up.', 'already_complete');
    const phone = normalizePhone(b.phone);
    if ((await ctx.db.query('SELECT 1 FROM users WHERE phone = ANY($1) AND id <> $2', [phoneCandidates(phone), u.id])).rows[0]) throw new HttpError(409, 'An account with this mobile number already exists. Use a different number.', 'phone_taken', { field: 'phone' });
    const nu = (await ctx.db.query(`UPDATE users SET full_name=$2, phone=$3, phone_verified=false, password_hash=CASE WHEN password_set = false THEN $4 ELSE password_hash END, password_set=true, updated_at=now() WHERE id=$1 RETURNING *`,
      [u.id, `${b.firstName} ${b.lastName}`.slice(0, 100), phone, await bcrypt.hash(b.newPassword, rounds)])).rows[0];
    await syncAccount(ctx.db, u.id);
    await audit(ctx.db, req, 'user.signup_completed', 'user', u.id, {});
    res.json({ user: publicUser(nu) });
  });

  r.post('/forgot-password', async (req, res) => {
    const { email } = parse(z.object({ email: z.string().min(3).max(254) }), req.body); // email address or mobile number
    const u = await findByIdentifier(email);
    if (u?.is_active) {
      const viaEmail = email.includes('@');
      await issueOtp(u.id, viaEmail ? 'email' : 'phone', viaEmail ? u.email : u.phone, u.full_name).catch(() => {});
    }
    res.json({ sent: true }); // identical response whether or not the account exists
  });

  r.post('/reset-password', async (req, res) => {
    const b = parse(z.object({ email: z.string().min(3).max(254), code: z.string().regex(/^\d{6}$/), newPassword: password, confirmPassword: z.string().optional() })
      .refine((x) => x.confirmPassword === undefined || x.confirmPassword === x.newPassword, { message: 'Passwords do not match', path: ['confirmPassword'] }), req.body);
    const u = await findByIdentifier(b.email);
    if (!u) throw badRequest('Code expired or not requested', 'otp_expired');
    const channel = b.email.includes('@') ? 'email' : 'phone';
    await checkOtp(u.id, channel, b.code);
    await ctx.db.query(`UPDATE users SET password_hash=$2, email_verified = email_verified OR $3, phone_verified = phone_verified OR $4, token_version=token_version+1, updated_at=now() WHERE id=$1`, [u.id, await bcrypt.hash(b.newPassword, rounds), channel === 'email', channel === 'phone']);
    await ctx.notifier.notify(u.id, { title: 'Your password was changed', type: 'security', email: true, body: 'Your PlaynX password was just reset. If this was not you, contact support immediately.' });
    await audit(ctx.db, req, 'user.password_reset', 'user', u.id, {}, u.id);
    await syncAccount(ctx.db, u.id);
    res.json({ reset: true });
  });

  /** Sign out every other device: bumps the token version and returns a fresh token for this session. */
  r.post('/logout-all', auth, async (req, res) => {
    const nu = (await ctx.db.query('UPDATE users SET token_version=token_version+1, updated_at=now() WHERE id=$1 RETURNING *', [req.user!.id])).rows[0];
    await audit(ctx.db, req, 'user.logout_all', 'user', nu.id);
    res.json({ token: signToken(ctx, nu) });
  });

  r.post('/change-password', auth, async (req, res) => {
    const b = parse(z.object({ currentPassword: z.string().max(72), newPassword: password }), req.body);
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [req.user!.id])).rows[0];
    if (!(await bcrypt.compare(b.currentPassword, u.password_hash))) throw unauthorized('Current password is incorrect');
    const nu = (await ctx.db.query('UPDATE users SET password_hash=$2, token_version=token_version+1, updated_at=now() WHERE id=$1 RETURNING *', [u.id, await bcrypt.hash(b.newPassword, rounds)])).rows[0];
    await audit(ctx.db, req, 'user.password_change', 'user', u.id);
    await ctx.notifier.notify(u.id, { title: 'Your password was changed', type: 'security', email: true, body: 'Your PlaynX password was just changed. If this was not you, contact support immediately.' });
    res.json({ changed: true, token: signToken(ctx, nu) }); // other sessions are signed out; this one gets a fresh token
  });

  return r;
}
