import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { registerUser, setup, uniq, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
const digits = (s: string) => /(\d{6})/.exec(s.replace(/<[^>]+>/g, ' '))![1];
const lastSms = (to: string) => env.sms.filter((m) => m.to === to).at(-1)!;
const lastMail = (to: string) => env.emails.filter((e) => e.to === to).at(-1)!;
const mobile = () => String(6000000000 + Math.floor(Math.random() * 999999999));

describe('customer signup with mobile', () => {
  it('stores the mobile in one canonical form so 10-digit and +91 spellings cannot both register', async () => {
    const m = mobile();
    const a = await request(env.app).post('/api/auth/register').send({ email: `${uniq('n')}@test.dev`, password: 'Secret123x', confirmPassword: 'Secret123x', fullName: 'Asha Rao', phone: m }).expect(201);
    expect(a.body.user.phone).toBe('+91' + m);
    const dup = await request(env.app).post('/api/auth/register').send({ email: `${uniq('n')}@test.dev`, password: 'Secret123x', fullName: 'Asha Rao', phone: '+91' + m }).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'phone_taken', details: { field: 'phone' } });
  });
  it('rejects mismatched confirm password and keeps only known preferred sports', async () => {
    const bad = await request(env.app).post('/api/auth/register').send({ email: `${uniq('n')}@test.dev`, password: 'Secret123x', confirmPassword: 'Secret123y', fullName: 'Asha Rao', phone: mobile() }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/do not match/);
    const email = `${uniq('n')}@test.dev`;
    const ok = await request(env.app).post('/api/auth/register').send({ email, password: 'Secret123x', fullName: 'Asha Rao', phone: mobile(), preferredSports: ['football', 'not-a-sport'], city: 'Chennai' }).expect(201);
    const prof = await request(env.app).get('/api/me/profile').set({ Authorization: `Bearer ${ok.body.token}` }).expect(200);
    expect(prof.body.profile).toMatchObject({ city: 'Chennai', preferred_sports: ['football'] });
  });
  it('sends a mobile OTP by SMS and verifies it; the code is never in the API response', async () => {
    const phone = '+91' + mobile();
    const res = await request(env.app).post('/api/auth/register').send({ email: `${uniq('n')}@test.dev`, password: 'Secret123x', fullName: 'Asha Rao', phone }).expect(201);
    expect(Object.keys(res.body).sort()).toEqual(['token', 'user']); expect(JSON.stringify(res.body)).not.toContain(digits(lastSms(phone).message));
    const auth = { Authorization: `Bearer ${res.body.token}` };
    const code = digits(lastSms(phone).message);
    const wrong = code === '000000' ? '111111' : '000000';
    await request(env.app).post('/api/auth/otp/verify').set(auth).send({ channel: 'phone', code: wrong }).expect(400);
    const ok = await request(env.app).post('/api/auth/otp/verify').set(auth).send({ channel: 'phone', code }).expect(200);
    expect(ok.body.user.phoneVerified).toBe(true);
  });
  it('rate-limits OTP resends and expires codes', async () => {
    const u = await registerUser(env, 'customer', { verified: false });
    const again = await request(env.app).post('/api/auth/otp/send').set(u.auth).send({ channel: 'email' });
    expect(again.status).toBe(429); expect(again.body.error.code).toBe('otp_cooldown');
    const code = digits(lastMail(u.email).html);
    env.clock.offsetMs = 11 * 60_000;
    try { const r = await request(env.app).post('/api/auth/otp/verify').set(u.auth).send({ channel: 'email', code }).expect(400); expect(r.body.error.code).toBe('otp_expired'); }
    finally { env.clock.offsetMs = 0; }
  });
});

describe('login with mobile or email', () => {
  it('accepts the registered mobile in either spelling and gives one error for any wrong credential', async () => {
    const m = mobile();
    const email = `${uniq('l')}@test.dev`;
    await request(env.app).post('/api/auth/register').send({ email, password: 'Secret123x', fullName: 'Asha Rao', phone: m }).expect(201);
    await request(env.app).post('/api/auth/login').send({ email: m, password: 'Secret123x' }).expect(200);
    await request(env.app).post('/api/auth/login').send({ email: '+91' + m, password: 'Secret123x' }).expect(200);
    await request(env.app).post('/api/auth/login').send({ email: email.toUpperCase(), password: 'Secret123x' }).expect(200);
    const wrongPw = await request(env.app).post('/api/auth/login').send({ email: m, password: 'Nope12345' }).expect(401);
    const noUser = await request(env.app).post('/api/auth/login').send({ email: '9999999999', password: 'Nope12345' }).expect(401);
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });
});

describe('forgot password by mobile', () => {
  it('texts a code, resets the password, signs out old sessions and rejects reuse of the code', async () => {
    const m = mobile(); const phone = '+91' + m;
    const reg = await request(env.app).post('/api/auth/register').send({ email: `${uniq('f')}@test.dev`, password: 'Secret123x', fullName: 'Asha Rao', phone }).expect(201);
    env.clock.offsetMs = 60_000;
    try {
      await request(env.app).post('/api/auth/forgot-password').send({ email: m }).expect(200);
      const code = digits(lastSms(phone).message);
      await request(env.app).post('/api/auth/reset-password').send({ email: m, code, newPassword: 'Another123', confirmPassword: 'Different1' }).expect(400);
      await request(env.app).post('/api/auth/reset-password').send({ email: m, code, newPassword: 'Another123', confirmPassword: 'Another123' }).expect(200);
      await request(env.app).post('/api/auth/reset-password').send({ email: m, code, newPassword: 'Another456' }).expect(400);
    } finally { env.clock.offsetMs = 0; }
    await request(env.app).get('/api/auth/me').set({ Authorization: `Bearer ${reg.body.token}` }).expect(401); // old session revoked
    await request(env.app).post('/api/auth/login').send({ email: m, password: 'Another123' }).expect(200);
  });
});

describe('profile changes', () => {
  it('requires re-verification when the mobile or email changes, and refuses numbers/emails owned by others', async () => {
    const a = await registerUser(env, 'customer'); const b = await registerUser(env, 'customer');
    await request(env.app).put('/api/me/profile').set(a.auth).send({ phone: '+919123456780' }).expect(200);
    await request(env.app).put('/api/me/profile').set(a.auth).send({ phone: '9123456780' }).expect(200); // same number, other spelling: no change
    await request(env.app).put('/api/me/profile').set(b.auth).send({ phone: '9123456780' }).expect(409);
    await request(env.app).put('/api/me/profile').set(b.auth).send({ email: a.email.toUpperCase() }).expect(409);
    const r = await request(env.app).put('/api/me/profile').set(a.auth).send({ email: `${uniq('new')}@test.dev`, gender: 'female', birthDate: '1995-04-02', preferredSports: ['cricket'], city: 'Pune' }).expect(200);
    expect(r.body.user).toMatchObject({ emailVerified: false, phoneVerified: false });
    const p = await request(env.app).get('/api/me/profile').set(a.auth).expect(200);
    expect(p.body.profile).toMatchObject({ gender: 'female', city: 'Pune', preferred_sports: ['cricket'] });
    expect(JSON.stringify(p.body)).not.toMatch(/password|aadhaar|pan/i);
  });
  it('lets a customer upload a profile picture but only real images, and not owners', async () => {
    const c = await registerUser(env, 'customer'); const o = await registerUser(env, 'owner');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const ok = await request(env.app).post('/api/me/profile/avatar').set(c.auth).attach('file', png, 'a.png').expect(200);
    expect(ok.body.avatarUrl).toMatch(/^https:/);
    await request(env.app).post('/api/me/profile/avatar').set(c.auth).attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'a.png', contentType: 'image/png' }).expect(400);
    await request(env.app).post('/api/me/profile/avatar').set(o.auth).attach('file', png, 'a.png').expect(403);
  });
});

describe('customer route protection', () => {
  it('blocks anonymous and cross-role access to customer data and customers from owner/admin APIs', async () => {
    const c = await registerUser(env, 'customer'); const o = await registerUser(env, 'owner');
    await request(env.app).get('/api/bookings').expect(401);
    await request(env.app).get('/api/me/profile').expect(401);
    await request(env.app).get('/api/bookings').set(c.auth).expect(200);
    await request(env.app).get('/api/owner/venues').set(c.auth).expect(403);
    await request(env.app).get('/api/admin/users').set(c.auth).expect(403);
    await request(env.app).get('/api/bookings').set(o.auth).expect(403);
  });
  it('requires a verified email to hold a slot, and anonymous users cannot', async () => {
    const u = await registerUser(env, 'customer', { verified: false });
    const body = { areaId: '00000000-0000-4000-8000-000000000000', sportId: 1, startsAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 60 };
    await request(env.app).post('/api/slots/lock').send(body).expect(401);
    const r = await request(env.app).post('/api/slots/lock').set(u.auth).send(body).expect(403);
    expect(r.body.error.code).toBe('email_unverified');
  });
  it('a Google-created customer has no mobile, cannot hold a slot until adding one, and can then verify it', async () => {
    const email = `${uniq('g')}@test.dev`;
    const g = await request(env.app).post('/api/auth/google').send({ credential: `good:${email}`, create: true }).expect(200);
    const auth = { Authorization: `Bearer ${g.body.token}` };
    expect(g.body.user).toMatchObject({ phone: null, emailVerified: false }); // Google proves the address, but the account still confirms it with a code
    const body = { areaId: '00000000-0000-4000-8000-000000000000', sportId: 1, startsAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 60 };
    expect((await request(env.app).post('/api/slots/lock').set(auth).send(body).expect(403)).body.error.code).toBe('phone_missing');
    const phone = mobile();
    const up = await request(env.app).put('/api/me/profile').set(auth).send({ phone, city: 'Pune' }).expect(200);
    expect(up.body.user).toMatchObject({ phone: '+91' + phone, phoneVerified: false });
    await request(env.app).post('/api/auth/otp/send').set(auth).send({ channel: 'phone' }).expect(200);
    const ok = await request(env.app).post('/api/auth/otp/verify').set(auth).send({ channel: 'phone', code: digits(lastSms('+91' + phone).message) }).expect(200);
    expect(ok.body.user.phoneVerified).toBe(true);
    expect((await request(env.app).post('/api/slots/lock').set(auth).send(body)).body.error?.code).not.toBe('phone_missing');
  });
});
