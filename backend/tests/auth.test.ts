import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, registerUser, setup, uniq, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
const otpFrom = (html: string) => /(\d{6})/.exec(html.replace(/<[^>]+>/g, ' '))![1];
const lastMail = (to: string) => env.emails.filter((e) => e.to === to).at(-1)!;

describe('registration & login', () => {
  it('registers a customer, hashes the password and never returns the hash', async () => {
    const email = `${uniq('c')}@test.dev`;
    const res = await request(env.app).post('/api/auth/register').send({ email, password: 'Secret123x', fullName: 'Ravi K', phone: '+919876543210' }).expect(201);
    expect(res.body.user).toMatchObject({ email, role: 'customer', emailVerified: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const row = (await env.db.query('SELECT password_hash FROM users WHERE email=$1', [email])).rows[0];
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row.password_hash).not.toContain('Secret123x');
  });
  it('rejects weak passwords, bad emails and duplicate accounts', async () => {
    const email = `${uniq('d')}@test.dev`;
    await request(env.app).post('/api/auth/register').send({ email, password: 'short1', fullName: 'Ab' }).expect(400);
    await request(env.app).post('/api/auth/register').send({ email, password: 'onlyletters', fullName: 'Ab Cd' }).expect(400);
    await request(env.app).post('/api/auth/register').send({ email: 'nope', password: 'Secret123x', fullName: 'Ab Cd' }).expect(400);
    await request(env.app).post('/api/auth/register').send({ email, password: 'Secret123x', fullName: 'Ab Cd' }).expect(400); // customers must give a mobile number
    await request(env.app).post('/api/auth/register').send({ email, password: 'Secret123x', fullName: 'Ab Cd', phone: '+919000011100' }).expect(201);
    const dupEmail = await request(env.app).post('/api/auth/register').send({ email: email.toUpperCase(), password: 'Secret123x', fullName: 'Ab Cd', phone: '+919000011101' }).expect(409);
    expect(dupEmail.body.error).toMatchObject({ code: 'email_taken', details: { field: 'email' } }); expect(dupEmail.body.error.message).toMatch(/email address already exists/);
    const p = '+919000011122';
    await request(env.app).post('/api/auth/register').send({ email: `${uniq('ph')}@test.dev`, password: 'Secret123x', fullName: 'Ab Cd', phone: p }).expect(201);
    const dupPhone = await request(env.app).post('/api/auth/register').send({ email: `${uniq('ph')}@test.dev`, password: 'Secret123x', fullName: 'Ab Cd', phone: p }).expect(409);
    expect(dupPhone.body.error).toMatchObject({ code: 'phone_taken', details: { field: 'phone' } });
  });
  it('cannot self-register as admin', async () => {
    const res = await request(env.app).post('/api/auth/register').send({ email: `${uniq('a')}@test.dev`, password: 'Secret123x', fullName: 'Evil Admin', role: 'admin' });
    expect(res.status).toBe(400);
  });
  it('logs in with correct credentials only, with a uniform error', async () => {
    const u = await registerUser(env, 'customer');
    await request(env.app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rdTest' }).expect(200);
    const bad = await request(env.app).post('/api/auth/login').send({ email: u.email, password: 'wrong' });
    const none = await request(env.app).post('/api/auth/login').send({ email: 'ghost@test.dev', password: 'wrong' });
    expect([bad.status, none.status]).toEqual([401, 401]);
    expect(bad.body.error.message).toBe(none.body.error.message);
  });
  it('rejects missing, malformed, tampered and disabled-user tokens', async () => {
    const u = await registerUser(env, 'customer');
    await request(env.app).get('/api/auth/me').expect(401);
    await request(env.app).get('/api/auth/me').set('Authorization', 'Bearer garbage').expect(401);
    await request(env.app).get('/api/auth/me').set('Authorization', `Bearer ${u.token.slice(0, -3)}abc`).expect(401);
    await request(env.app).get('/api/auth/me').set(u.auth).expect(200);
    await env.db.query('UPDATE users SET is_active=false WHERE id=$1', [u.id]);
    await request(env.app).get('/api/auth/me').set(u.auth).expect(401);
    await request(env.app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rdTest' }).expect(403);
  });
});

describe('OTP verification & password reset', () => {
  it('verifies email with the emailed code; wrong codes fail and a code is single-use', async () => {
    const u = await registerUser(env, 'customer', { verified: false });
    const code = otpFrom(lastMail(u.email).html);
    const wrong = code === '000000' ? '111111' : '000000';
    await request(env.app).post('/api/auth/otp/verify').set(u.auth).send({ channel: 'email', code: wrong }).expect(400);
    const ok = await request(env.app).post('/api/auth/otp/verify').set(u.auth).send({ channel: 'email', code }).expect(200);
    expect(ok.body.user.emailVerified).toBe(true);
    await request(env.app).post('/api/auth/otp/verify').set(u.auth).send({ channel: 'email', code }).expect(400);
  });
  it('locks the code after too many wrong attempts', async () => {
    const u = await registerUser(env, 'customer', { verified: false });
    const code = otpFrom(lastMail(u.email).html);
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await request(env.app).post('/api/auth/otp/verify').set(u.auth).send({ channel: 'email', code: wrong }).expect(400);
    await request(env.app).post('/api/auth/otp/verify').set(u.auth).send({ channel: 'email', code }).expect(429);
  });
  it('supports forgot/reset password, without revealing whether an account exists', async () => {
    const u = await registerUser(env, 'customer');
    env.clock.offsetMs = 60_000; // clear the 30s OTP resend cooldown from signup
    try {
      await request(env.app).post('/api/auth/forgot-password').send({ email: u.email }).expect(200);
      const unknown = await request(env.app).post('/api/auth/forgot-password').send({ email: 'nobody@test.dev' }).expect(200);
      expect(unknown.body).toEqual({ sent: true });
      const code = otpFrom(lastMail(u.email).html);
      await request(env.app).post('/api/auth/reset-password').send({ email: u.email, code, newPassword: 'BrandNew123' }).expect(200);
    } finally { env.clock.offsetMs = 0; }
    await request(env.app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rdTest' }).expect(401);
    await request(env.app).post('/api/auth/login').send({ email: u.email, password: 'BrandNew123' }).expect(200);
  });
});

describe('role-based access control', () => {
  it('keeps portals separate', async () => {
    const c = await registerUser(env, 'customer'), o = await registerUser(env, 'owner'), a = await createAdmin(env);
    await request(env.app).get('/api/owner/venues').set(c.auth).expect(403);
    await request(env.app).get('/api/admin/users').set(c.auth).expect(403);
    await request(env.app).get('/api/admin/users').set(o.auth).expect(403);
    await request(env.app).get('/api/owner/venues').set(a.auth).expect(403);
    await request(env.app).get('/api/bookings').set(o.auth).expect(403);
    await request(env.app).get('/api/admin/users').expect(401);
    await request(env.app).get('/api/admin/users').set(a.auth).expect(200);
  });
  it('enforces admin sub-roles', async () => {
    const fin = await createAdmin(env, 'finance'), sup = await createAdmin(env, 'support'), ops = await createAdmin(env, 'operations');
    await request(env.app).get('/api/admin/payments').set(fin.auth).expect(200);
    await request(env.app).get('/api/admin/payments').set(sup.auth).expect(403);
    await request(env.app).get('/api/admin/tickets').set(sup.auth).expect(200);
    await request(env.app).get('/api/admin/users').set(sup.auth).expect(200); // read-only
    const target = await registerUser(env, 'customer');
    await request(env.app).patch(`/api/admin/users/${target.id}`).set(sup.auth).send({ isActive: false }).expect(403);
    await request(env.app).patch(`/api/admin/users/${target.id}`).set(ops.auth).send({ isActive: false }).expect(200);
    await request(env.app).get('/api/admin/audit-logs').set(ops.auth).expect(403);
    await request(env.app).put('/api/admin/settings').set(ops.auth).send({ commissionPercent: 5 }).expect(403);
  });
  it('writes audit log entries for sensitive admin actions', async () => {
    const a = await createAdmin(env), t = await registerUser(env, 'customer');
    await request(env.app).patch(`/api/admin/users/${t.id}`).set(a.auth).send({ isActive: false }).expect(200);
    const logs = await request(env.app).get('/api/admin/audit-logs?entity=user').set(a.auth).expect(200);
    expect(logs.body.logs.some((l: any) => l.action === 'user.disable' && l.entity_id === t.id && l.actor_id === a.id)).toBe(true);
  });
  it("owners cannot touch another owner's venue", async () => {
    const fx = await createApprovedVenue(env, await createAdmin(env));
    const other = await registerUser(env, 'owner'); await approveOwner(env, await createAdmin(env), other);
    await request(env.app).put(`/api/owner/venues/${fx.venue.id}`).set(other.auth).send({ name: 'Hijacked' }).expect(403);
    await request(env.app).put(`/api/owner/areas/${fx.area.id}/pricing`).set(other.auth).send({ rules: [{ startTime: '06:00', endTime: '07:00', pricePerHour: 1 }] }).expect(403);
  });
  it('venues need an approved owner and admin approval is gated on reviewed documents', async () => {
    const a = await createAdmin(env);
    const o = await registerUser(env, 'owner');
    const blocked = await request(env.app).post('/api/owner/venues').set(o.auth).send({ pincode: '560001', name: 'Gate Venue', address: '9 Gate Street', city: 'Pune', lat: 18.5, lng: 73.8 }).expect(403);
    expect(blocked.body.error.code).toBe('owner_not_approved');
    await approveOwner(env, a, o);
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ pincode: '560001', name: 'Gate Venue', address: '9 Gate Street', city: 'Pune', lat: 18.5, lng: 73.8 }).expect(201)).body.venue;
    const sub = await request(env.app).post(`/api/owner/venues/${v.id}/submit`).set(o.auth).expect(400);
    expect(sub.body.error.code).toBe('incomplete_venue');
    await request(env.app).post(`/api/admin/venues/${v.id}/decision`).set(a.auth).send({ decision: 'approve' }).expect(409); // still a draft: nothing submitted for review
  });
});

describe('uploads & input safety', () => {
  it('rejects files whose content does not match an allowed type, regardless of declared mimetype', async () => {
    const o = await registerUser(env, 'owner'); await approveOwner(env, await createAdmin(env), o);
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ pincode: '560001', name: 'Up Venue', address: '5 Test Street', city: 'Pune', lat: 18.5, lng: 73.8 }).expect(201)).body.venue;
    const bad = await request(env.app).post(`/api/owner/venues/${v.id}/media`).set(o.auth).attach('file', Buffer.from('<script>alert(1)</script> padding padding'), { filename: 'x.png', contentType: 'image/png' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('bad_file_type');
    await request(env.app).post(`/api/owner/venues/${v.id}/media`).set(o.auth).expect(400);
  });
  it('treats SQL metacharacters in search as plain text', async () => {
    const res = await request(env.app).get(`/api/venues?q=${encodeURIComponent("'; DROP TABLE users; --")}`).expect(200);
    expect(res.body.venues).toEqual([]);
    expect((await env.db.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBeGreaterThan(0);
  });
  it('returns structured validation errors and 404 for unknown routes', async () => {
    const res = await request(env.app).post('/api/auth/login').send({}).expect(400);
    expect(res.body.error.code).toBe('validation_error');
    await request(env.app).get('/api/nope').expect(404);
    await request(env.app).get('/api/venues/not-a-uuid').expect(400);
  });
});

describe('Google sign-in', () => {
  const g = (body: object) => request(env.app).post('/api/auth/google').send(body);
  it('creates a customer on first sign-in that must still confirm the email with a code, and logs the same user in afterwards', async () => {
    const email = `${uniq('g')}@gmail.test`;
    const first = await g({ credential: `good:${email}`, create: true }).expect(200);
    expect(first.body.user).toMatchObject({ email, role: 'customer', emailVerified: false });
    const code = otpFrom(lastMail(email).html);
    await request(env.app).post('/api/auth/otp/verify').set({ Authorization: `Bearer ${first.body.token}` }).send({ channel: 'email', code }).expect(200);
    expect((await g({ credential: `good:${email}` }).expect(200)).body.user.emailVerified).toBe(true);
    const again = await g({ credential: `good:${email}` }).expect(200);
    expect(again.body.user.id).toBe(first.body.user.id);
  });
  it('rejects invalid tokens and does not create accounts when create is false', async () => {
    await g({ credential: 'forged-token-value' }).expect(401);
    const res = await g({ credential: `good:${uniq('n')}@gmail.test` }).expect(404);
    expect(res.body.error.code).toBe('no_account');
  });
  it('creates a new owner without asking for a business name, and links to existing accounts by verified email', async () => {
    const bare = await g({ credential: `good:${uniq('o')}@gmail.test`, create: true, role: 'owner' }).expect(200);
    expect(bare.body.user.role).toBe('owner');
    expect((await env.db.query('SELECT business_name FROM owner_profiles WHERE user_id=$1', [bare.body.user.id])).rows[0].business_name).toBe('Google User'); // the name Google gave; the application asks for the real one
    const ok = await g({ credential: `good:${uniq('o')}@gmail.test`, create: true, role: 'owner', businessName: 'Gee Sports' }).expect(200);
    expect(ok.body.user.role).toBe('owner');
    const existing = await registerUser(env, 'customer', { verified: false });
    const linked = await g({ credential: `good:${existing.email}` }).expect(200);
    expect(linked.body.user.id).toBe(existing.id);
    expect(linked.body.user.emailVerified).toBe(false); // signing in with Google never skips the code
  });
  it('a new owner is not emailed a code at sign-up; they ask for it on the verification step, and a second Google sign-in never verifies them', async () => {
    const email = `${uniq('g')}@gmail.test`;
    await g({ credential: `good:${email}`, create: true, role: 'owner', businessName: 'Gee Sports' }).expect(200);
    expect((await g({ credential: `good:${email}` }).expect(200)).body.user.emailVerified).toBe(false);
    expect(env.emails.some((m) => m.to === email)).toBe(false); // nothing was emailed at sign-up
  });
});

describe('Google accounts choose a password', () => {
  const g = (body: object) => request(env.app).post('/api/auth/google').send(body);
  it('starts without a password, sets one once, then can sign in with email and password', async () => {
    const email = `${uniq('gp')}@gmail.test`;
    const first = await g({ credential: `good:${email}`, create: true, role: 'owner' }).expect(200);
    expect(first.body.user.credentialSet).toBe(false);
    const auth = { Authorization: `Bearer ${first.body.token}` };
    await request(env.app).post('/api/auth/login').send({ email, password: 'Passw0rdNew1' }).expect(401); // nobody knows the random one
    await request(env.app).post('/api/auth/set-password').set(auth).send({ newPassword: 'short', confirmPassword: 'short' }).expect(400);
    await request(env.app).post('/api/auth/set-password').set(auth).send({ newPassword: 'Passw0rdNew1', confirmPassword: 'Different1' }).expect(400);
    await request(env.app).post('/api/auth/set-password').set(auth).send({ newPassword: 'Passw0rdNew1', confirmPassword: 'Passw0rdNew1' }).expect(200);
    await request(env.app).post('/api/auth/set-password').set(auth).send({ newPassword: 'Passw0rdNew2', confirmPassword: 'Passw0rdNew2' }).expect(409); // only once
    const login = await request(env.app).post('/api/auth/login').send({ email, password: 'Passw0rdNew1' }).expect(200);
    expect(login.body.user.credentialSet).toBe(true);
    expect((await g({ credential: `good:${email}` }).expect(200)).body.user.credentialSet).toBe(true); // Google sign-in does not undo it
  });
  it('the personal-details step is not complete until the Google account has a password', async () => {
    const email = `${uniq('gq')}@gmail.test`;
    const first = await g({ credential: `good:${email}`, create: true, role: 'owner' }).expect(200);
    const auth = { Authorization: `Bearer ${first.body.token}` };
    const body = { legalName: 'Arjun Mehta', dob: '1990-05-17', phone: '9876543210', addressLine1: '12 Park Road, Indiranagar', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', country: 'India' };
    await request(env.app).put('/api/owner/application/personal').set(auth).send(body).expect(200);
    let a = (await request(env.app).get('/api/owner/application').set(auth).expect(200)).body;
    expect(a.personal).toMatchObject({ done: false, passwordSet: false });
    await request(env.app).post('/api/auth/set-password').set(auth).send({ newPassword: 'Passw0rdNew1', confirmPassword: 'Passw0rdNew1' }).expect(200);
    a = (await request(env.app).get('/api/owner/application').set(auth).expect(200)).body;
    expect(a.personal).toMatchObject({ done: true, passwordSet: true });
  });
});
