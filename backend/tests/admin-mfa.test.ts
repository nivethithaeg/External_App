import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { setup, uniq, type TestEnv } from './helpers.js';
import { base32Decode, base32Encode, openSecret, stepAt, totpCode, verifyTotp } from '../src/lib/totp.js';

let env: TestEnv;
beforeAll(async () => { env = await setup({ ADMIN_MFA: 'true' }); });

async function newAdmin(role = 'super_admin') {
  const email = `${uniq('mfa')}@test.dev`;
  const { rows } = await env.db.query(`INSERT INTO users (email, password_hash, full_name, role, admin_role, email_verified) VALUES ($1,$2,'Mfa Admin','admin',$3,true) RETURNING id`, [email, await bcrypt.hash('AdminPass12345', 4), role]);
  return { id: rows[0].id as string, email };
}
const login = (email: string) => request(env.app).post('/api/auth/login').send({ email, password: 'AdminPass12345' });
const verify = (mfaToken: string, code: string) => request(env.app).post('/api/auth/mfa/verify').send({ mfaToken, code });
const now = () => env.ctx.now().getTime();
const codeNow = (secret: string, shift = 0) => totpCode(secret, stepAt(now()) + shift);

/** sign in fully (set up on the first time) and return the session token and the secret */
async function signIn(email: string, secret?: string) {
  const r1 = (await login(email).expect(200)).body;
  const s = secret ?? r1.secret;
  const r2 = await verify(r1.mfaToken, codeNow(s)).expect(200);
  return { token: r2.body.token as string, secret: s };
}

describe('TOTP codes', () => {
  it('matches the RFC 6238 test vector and base32 round-trips', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082'); // RFC 6238, T=59 s, last 6 digits of 94287082
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
  });
  it('accepts one step of clock drift, refuses older steps and reused steps', () => {
    const s = base32Encode(Buffer.from('abcdefghijabcdefghij')); const t = 1_700_000_000_000; const st = stepAt(t);
    expect(verifyTotp(s, totpCode(s, st), t)).toBe(st);
    expect(verifyTotp(s, totpCode(s, st - 1), t)).toBe(st - 1);
    expect(verifyTotp(s, totpCode(s, st - 2), t)).toBeNull();
    expect(verifyTotp(s, totpCode(s, st), t, st)).toBeNull(); // already used
  });
});

describe('admin two-step sign-in', () => {
  it('first sign-in: no session from the password alone; a QR secret is shown and the first code turns 2FA on', async () => {
    const a = await newAdmin();
    const r = (await login(a.email).expect(200)).body;
    expect(r.token).toBeUndefined(); expect(r.mfaSetupRequired).toBe(true);
    expect(r.otpauthUrl).toMatch(/^otpauth:\/\/totp\/PlaynX%3A.+\?secret=[A-Z2-7]{32}&issuer=PlaynX/);
    // the secret is stored encrypted, not in plain text
    const row = (await env.db.query('SELECT totp_secret_enc, totp_enabled_at FROM users WHERE id=$1', [a.id])).rows[0];
    expect(row.totp_secret_enc).not.toContain(r.secret); expect(openSecret(row.totp_secret_enc, env.ctx.cfg.JWT_SECRET)).toBe(r.secret); expect(row.totp_enabled_at).toBeNull();
    // logging in again before finishing shows the same QR
    expect((await login(a.email).expect(200)).body.secret).toBe(r.secret);
    const ok = await verify(r.mfaToken, codeNow(r.secret)).expect(200);
    expect(ok.body.user.role).toBe('admin');
    await request(env.app).get('/api/admin/team').set({ Authorization: `Bearer ${ok.body.token}` }).expect(200);
    expect(env.emails.some((m) => m.to === a.email && m.subject === 'Two-step sign-in is on')).toBe(true);
    // from now on: a code is asked, no QR
    const next = (await login(a.email).expect(200)).body;
    expect(next.mfaRequired).toBe(true); expect(next.secret).toBeUndefined(); expect(next.otpauthUrl).toBeUndefined();
  });

  it('the code step cannot be skipped: the ticket is not a session, wrong and reused codes fail', async () => {
    const a = await newAdmin(); const { secret } = await signIn(a.email);
    const t = (await login(a.email).expect(200)).body.mfaToken;
    await request(env.app).get('/api/admin/team').set({ Authorization: `Bearer ${t}` }).expect(401); // not a session token
    await verify(t, '000000').expect(401);
    env.clock.offsetMs += 31_000; // next step, so the earlier code is spent
    const good = codeNow(secret);
    await verify(t, good).expect(200);
    await verify(t, good).expect(401); // the same code twice
  });

  it('locks for 15 minutes after five wrong codes', async () => {
    const a = await newAdmin(); const { secret } = await signIn(a.email);
    const t = (await login(a.email).expect(200)).body.mfaToken;
    for (let i = 0; i < 4; i++) expect((await verify(t, '111111').expect(401)).body.error.code).toBe('mfa_invalid');
    expect((await verify(t, '111111').expect(401)).body.error.code).toBe('mfa_locked');
    env.clock.offsetMs += 31_000;
    expect((await verify(t, codeNow(secret)).expect(429)).body.error.code).toBe('mfa_locked');
    env.clock.offsetMs += 15 * 60_000;
    const t2 = (await login(a.email).expect(200)).body.mfaToken;
    await verify(t2, codeNow(secret)).expect(200);
  });

  it('admins cannot use Google sign-in to skip the code', async () => {
    const a = await newAdmin();
    const r = await request(env.app).post('/api/auth/google').send({ credential: `good:${a.email}` }).expect(403);
    expect(r.body.error.code).toBe('admin_password_only');
  });

  it('another admin can reset a lost authenticator; the admin sets it up again', async () => {
    const boss = await newAdmin(); const { token } = await signIn(boss.email);
    const a = await newAdmin('support'); await signIn(a.email);
    await request(env.app).post(`/api/admin/team/${boss.id}/reset-mfa`).set({ Authorization: `Bearer ${token}` }).expect(403); // not yourself
    const team = (await request(env.app).get('/api/admin/team').set({ Authorization: `Bearer ${token}` }).expect(200)).body.admins;
    expect(team.find((x: any) => x.id === a.id).mfa_enabled).toBe(true);
    await request(env.app).post(`/api/admin/team/${a.id}/reset-mfa`).set({ Authorization: `Bearer ${token}` }).expect(200);
    const again = (await login(a.email).expect(200)).body;
    expect(again.mfaSetupRequired).toBe(true);
  });

  it('customers and owners sign in as before', async () => {
    const email = `${uniq('cust')}@test.dev`;
    await env.db.query(`INSERT INTO users (email, password_hash, full_name, role, email_verified) VALUES ($1,$2,'Cust','customer',true)`, [email, await bcrypt.hash('AdminPass12345', 4)]);
    const r = (await login(email).expect(200)).body;
    expect(r.token).toBeTruthy(); expect(r.mfaRequired).toBeUndefined();
  });
});
