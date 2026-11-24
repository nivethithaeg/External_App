import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
const mk = (b: object = {}, who: any = fx.owner) => request(env.app).post('/api/owner/staff').set(who.auth).send({ fullName: 'Gate Keeper', email: `gate${Math.random().toString(36).slice(2, 8)}@x.co`, password: 'GatePass#2026', ...b });
const login = async (email: string, password = 'GatePass#2026') => { const r = await request(env.app).post('/api/auth/login').send({ email, password }).expect(200); return { auth: { Authorization: `Bearer ${r.body.token}` }, user: r.body.user }; };
const codeOf = async (id: string) => (await env.db.query('SELECT reference FROM bookings WHERE id=$1', [id])).rows[0].reference as string;

describe('staff reset their own password', () => {
  it('a staff member who forgot the password gets an emailed code and can sign in with the new one (no owner needed)', async () => {
    const email = `reset${Math.random().toString(36).slice(2, 7)}@x.co`;
    await mk({ email }).expect(201);
    env.clock.offsetMs = 120_000;
    try {
      await request(env.app).post('/api/auth/forgot-password').send({ email }).expect(200);
      const mail = env.emails.filter((m) => m.to === email).at(-1)!;
      const code = /(\d{6})/.exec(mail.html.replace(/<[^>]+>/g, ' '))![1];
      await request(env.app).post('/api/auth/reset-password').send({ email, code, newPassword: 'FreshPass#2027' }).expect(200);
      await request(env.app).post('/api/auth/login').send({ email, password: 'GatePass#2026' }).expect(401);
      const again = await login(email, 'FreshPass#2027'); expect(again.user.role).toBe('staff');
    } finally { env.clock.offsetMs = 0; }
  });
});

describe('owner creates and manages staff logins', () => {
  it('creates a staff login that can sign in, lists it, and is limited to the owner\'s own staff', async () => {
    const made = await mk({ email: 'gate1@x.co' }).expect(201);
    expect(made.body.staff).toMatchObject({ email: 'gate1@x.co', full_name: 'Gate Keeper', is_active: true });
    const s = await login('gate1@x.co'); expect(s.user.role).toBe('staff');
    const list = (await request(env.app).get('/api/owner/staff').set(fx.owner.auth).expect(200)).body;
    expect(list.staff.map((x: any) => x.email)).toContain('gate1@x.co'); expect(list.max).toBe(10);
    expect(JSON.stringify(list)).not.toContain('password');
    const other = await registerUser(env, 'owner'); await approveOwner(env, admin, other);
    expect((await request(env.app).get('/api/owner/staff').set(other.auth).expect(200)).body.staff).toHaveLength(0);
    await request(env.app).patch(`/api/owner/staff/${made.body.staff.id}`).set(other.auth).send({ isActive: false }).expect(404); // not their staff
  });

  it('checks the details: strong password, a new email, a customer cannot create staff, and there is a limit', async () => {
    await mk({ password: 'short' }).expect(400); await mk({ email: 'not-an-email' }).expect(400); await mk({ fullName: 'x' }).expect(400);
    await mk({ email: 'gate1@x.co' }).expect(409); // already used
    const c = await registerUser(env, 'customer'); await request(env.app).post('/api/owner/staff').set(c.auth).send({ fullName: 'A B', email: 'a@x.co', password: 'GatePass#2026' }).expect(403);
    const o = await registerUser(env, 'owner'); await approveOwner(env, admin, o);
    for (let i = 0; i < 10; i++) await mk({}, o).expect(201);
    expect((await mk({}, o).expect(409)).body.error.code).toBe('staff_limit');
  });

  it('switching someone off ends their session at once; a new password locks the old one out; removing deletes the login', async () => {
    const m = (await mk({ email: 'gate2@x.co' }).expect(201)).body.staff; const s = await login('gate2@x.co');
    await request(env.app).get('/api/staff/overview').set(s.auth).expect(200);
    await request(env.app).patch(`/api/owner/staff/${m.id}`).set(fx.owner.auth).send({ isActive: false }).expect(200);
    await request(env.app).get('/api/staff/overview').set(s.auth).expect(401); // the old token stops working
    await request(env.app).post('/api/auth/login').send({ email: 'gate2@x.co', password: 'GatePass#2026' }).expect(403); // and they cannot sign in
    await request(env.app).patch(`/api/owner/staff/${m.id}`).set(fx.owner.auth).send({ isActive: true, }).expect(200);
    await request(env.app).patch(`/api/owner/staff/${m.id}`).set(fx.owner.auth).send({ password: 'NewGatePass#1' }).expect(200);
    await request(env.app).post('/api/auth/login').send({ email: 'gate2@x.co', password: 'GatePass#2026' }).expect(401);
    await login('gate2@x.co', 'NewGatePass#1');
    await request(env.app).patch(`/api/owner/staff/${m.id}`).set(fx.owner.auth).send({}).expect(400);
    await request(env.app).delete(`/api/owner/staff/${m.id}`).set(fx.owner.auth).expect(204);
    await request(env.app).post('/api/auth/login').send({ email: 'gate2@x.co', password: 'NewGatePass#1' }).expect(401);
  });
});

describe('what staff can do, and cannot', () => {
  it('sees today\'s bookings without any money, verifies a QR pass and checks the player in exactly once', async () => {
    const c = await registerUser(env, 'customer');
    const soon = new Date(Date.now() + 3600000); // a booking later today is hard to guarantee, so move one to now
    const r = await startBooking(env, c, fx, ist(dateIn(7), '10:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    await env.db.query(`UPDATE bookings SET during=tstzrange(now() + interval '10 minutes', now() + interval '70 minutes') WHERE id=$1`, [r.booking.body.bookingId]); void soon;
    const staff = await login((await mk({ email: 'gate3@x.co' }).expect(201)).body.staff.email);
    const today = (await request(env.app).get('/api/staff/overview').set(staff.auth).expect(200)).body;
    const mine = today.bookings.find((b: any) => b.id === r.booking.body.bookingId); // may be tomorrow in IST late at night; the booking is still located by id below
    const code = await codeOf(r.booking.body.bookingId);
    if (mine) { expect(mine.checked_in_at).toBeNull(); expect(JSON.stringify(today)).not.toMatch(/total|amount|commission|price|payment/i); }
    const v = await request(env.app).post('/api/staff/verify').set(staff.auth).send({ reference: code }).expect(200);
    expect(v.body.valid).toBe(true); expect(v.body.booking).toMatchObject({ area_name: 'Turf A', customer_name: expect.any(String) }); expect(JSON.stringify(v.body)).not.toMatch(/total|amount|commission|price/i);
    expect((await env.db.query('SELECT checked_in_at FROM bookings WHERE id=$1', [r.booking.body.bookingId])).rows[0].checked_in_at).toBeNull(); // verify records nothing
    const a = await request(env.app).post('/api/staff/check-in').set(staff.auth).send({ reference: code }).expect(200); expect(a.body).toMatchObject({ checkedIn: true, alreadyCheckedIn: false });
    const b = await request(env.app).post('/api/staff/check-in').set(staff.auth).send({ reference: code }).expect(200); expect(b.body).toMatchObject({ checkedIn: true, alreadyCheckedIn: true });
    const row = (await env.db.query('SELECT checked_in_by FROM bookings WHERE id=$1', [r.booking.body.bookingId])).rows[0]; expect(row.checked_in_by).toBe(staff.user.id);
    await request(env.app).post('/api/staff/check-in').set(staff.auth).send({ reference: 'KO-NOPE123' }).expect(404);
    await request(env.app).post('/api/staff/check-in').set(staff.auth).send({ reference: 'x' }).expect(400);
  });

  it('cannot reach owner, admin or customer areas, other owners\' bookings, or an ended / cancelled booking', async () => {
    const staff = await login((await mk({ email: 'gate4@x.co' }).expect(201)).body.staff.email);
    for (const [m, u] of [['get', '/api/owner/overview'], ['get', '/api/owner/settlements'], ['get', '/api/owner/transactions'], ['get', '/api/owner/staff'], ['get', '/api/admin/dashboard'], ['get', '/api/bookings'], ['post', '/api/owner/bookings/verify']] as const) {
      const res = await (request(env.app) as any)[m](u).set(staff.auth).send({ reference: 'KO-ABC1234' }); expect([401, 403]).toContain(res.status);
    }
    const otherOwner = await registerUser(env, 'owner'); await approveOwner(env, admin, otherOwner); const otherFx = await createApprovedVenue(env, admin, otherOwner);
    const c = await registerUser(env, 'customer'); const r = await request(env.app).post('/api/slots/lock').set(c.auth).send({ areaId: otherFx.area.id, sportId: otherFx.football.id, startsAt: ist(dateIn(9), '10:00'), durationMinutes: 60 });
    const bk = await request(env.app).post('/api/bookings').set(c.auth).send({ lockId: r.body.lockId }); await pay(env, c, bk.body.bookingId, bk.body.order.id);
    await request(env.app).post('/api/staff/verify').set(staff.auth).send({ reference: await codeOf(bk.body.bookingId) }).expect(404); // another owner's booking
    const mine = await startBooking(env, c, fx, ist(dateIn(9), '12:00')); await pay(env, c, mine.booking.body.bookingId, mine.booking.body.order.id);
    await request(env.app).post(`/api/bookings/${mine.booking.body.bookingId}/cancel`).set(c.auth).send({}).expect(200);
    expect((await request(env.app).post('/api/staff/check-in').set(staff.auth).send({ reference: await codeOf(mine.booking.body.bookingId) }).expect(409)).body.error.code).toBe('not_valid');
    await request(env.app).get('/api/staff/overview').expect(401);
    await request(env.app).get('/api/staff/overview').set(fx.owner.auth).expect(403); // an owner is not staff
  });
});
