import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { badRequest, conflict, HttpError, unauthorized } from '../errors.js';
import { parse } from '../lib/http.js';
import { emailLayout } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { ADMIN_PERMISSIONS } from '../middleware/auth.js';
import { normalizePhone, phoneCandidates, INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE } from '../lib/phone.js';
import { syncAccount } from '../lib/accounts.js';

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
      await ctx.mailer.send(target, 'Your KickOff verification code', emailLayout('Verification code', `<p>Hi ${name.replace(/[<>&]/g, '')}, your code is</p><p style="font-size:32px;letter-spacing:6px;color:#b6f03c"><b>${code}</b></p><p>It expires in 10 minutes.</p>`));
    else await ctx.sms.send(target, `KickOff: your verification code is ${code}. Valid for 10 minutes.`);
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
    if (!u.is_active) throw new HttpError(403, 'This account has been suspended. Please contact KickOff support for help.', 'account_disabled');
    await audit(ctx.db, req, 'user.login', 'user', u.id, {}, u.id);
    const token = signToken(ctx, u, b.remember ? '30d' : '12h');
    await syncAccount(ctx.db, u.id, { loggedIn: true });
    res.json({ token, user: publicUser(u) });
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
      if (b.role !== 'owner') await issueOtp(u.id, 'email', u.email, u.full_name).catch((e) => console.error('[otp] email send failed', e));
      if (b.role === 'owner') await ctx.notifier.notifyAdmins('users', { title: 'New turf owner registered', body: `${u.full_name}${b.businessName ? ` (${b.businessName})` : ''} signed up with Google and is completing the application.`, type: 'admin_owner_registered', email: true, data: { link: '/admin/applications' } });
    } else {
      if (!u.is_active) throw new HttpError(403, 'This account has been disabled', 'account_disabled');
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
    await ctx.notifier.notify(u.id, { title: 'Your password was changed', type: 'security', email: true, body: 'Your KickOff password was just reset. If this was not you, contact support immediately.' });
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
    await ctx.notifier.notify(u.id, { title: 'Your password was changed', type: 'security', email: true, body: 'Your KickOff password was just changed. If this was not you, contact support immediately.' });
    res.json({ changed: true, token: signToken(ctx, nu) }); // other sessions are signed out; this one gets a fresh token
  });

  return r;
}
