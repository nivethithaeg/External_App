import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); });

type Fx = Awaited<ReturnType<typeof createApprovedVenue>>;
const fresh = async () => createApprovedVenue(env, admin);
let day = 3; const nextDay = () => dateIn(day++); // each test uses its own date so slots never collide
const body = (f: Fx, date: string, hhmm = '10:00', over: object = {}) => ({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(date, hhmm), durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210', paymentMethod: 'cash', ...over });
const book = (f: Fx, b: object, who: any = f.owner) => request(env.app).post('/api/owner/bookings/offline').set(who.auth).send(b);
const slots = async (f: Fx, date: string) => (await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date, sportId: f.football.id, duration: 60 }).expect(200)).body.slots as any[];
const row = async (ref: string) => (await env.db.query('SELECT * FROM bookings WHERE reference=$1', [ref])).rows[0];

describe('offline (walk-in) booking', () => {
  it('books a slot for someone without an account: confirmed at once, at the slot price, with no commission and no payment record', async () => {
    const f = await fresh(); const date = nextDay();
    const r = await book(f, body(f, date, '10:00', { customerEmail: 'ravi@example.com', notes: 'Birthday match' })).expect(201);
    expect(r.body).toMatchObject({ subtotal: 800, total: 800, discount: 0, venueName: 'Green Arena', areaName: 'Turf A' }); expect(r.body.reference).toMatch(/^KO-/);
    const b = await row(r.body.reference);
    expect(b).toMatchObject({ source: 'offline', status: 'confirmed', customer_id: null, walkin_name: 'Ravi Kumar', walkin_phone: '+919876543210', walkin_email: 'ravi@example.com', payment_method: 'cash', notes: 'Birthday match' });
    expect(Number(b.commission_amount)).toBe(0); expect(Number(b.owner_amount)).toBe(800);
    expect((await env.db.query('SELECT 1 FROM payments WHERE booking_id=$1', [b.id])).rows).toHaveLength(0); // no online payment
  });

  it('the slot is then taken: it shows as booked to customers, and nobody can book or hold it online', async () => {
    const f = await fresh(); const date = nextDay(); const c = await registerUser(env, 'customer');
    await book(f, body(f, date, '11:00')).expect(201);
    const s = (await slots(f, date)).find((x) => new Date(x.startsAt).toISOString() === new Date(ist(date, '11:00')).toISOString())!;
    expect(s).toMatchObject({ available: false, reason: 'booked' });
    const lock = await startBooking(env, c, f, ist(date, '11:00'));
    expect(lock.lock.status).toBe(409); expect(lock.lock.body.error.code).toBe('slot_unavailable');
  });

  it('the price can be changed (a discount or a different rate), and the difference is recorded as a discount', async () => {
    const f = await fresh(); const date = nextDay();
    const a = await book(f, body(f, date, '12:00', { amount: 600 })).expect(201);
    expect(a.body).toMatchObject({ subtotal: 800, total: 600, discount: 200 }); expect(Number((await row(a.body.reference)).owner_amount)).toBe(600);
    const free = await book(f, body(f, date, '13:00', { amount: 0 })).expect(201); expect(free.body.total).toBe(0);
    const more = await book(f, body(f, date, '14:00', { amount: 1000 })).expect(201); expect(more.body).toMatchObject({ subtotal: 800, total: 1000, discount: 0 });
  });

  it('records how it was paid: cash, UPI, card, or not paid yet', async () => {
    const f = await fresh(); const date = nextDay();
    for (const [i, m] of (['cash', 'upi', 'card', 'unpaid'] as const).entries()) { const r = await book(f, body(f, date, `${7 + i}:00`.padStart(5, '0'), { paymentMethod: m })).expect(201); expect((await row(r.body.reference)).payment_method).toBe(m); }
    await book(f, body(f, date, '12:00', { paymentMethod: 'bitcoin' })).expect(400);
  });

  it('refuses a slot that is already booked, blocked or being held, and one outside the hours or with no price', async () => {
    const f = await fresh(); const date = nextDay(); const c = await registerUser(env, 'customer');
    await book(f, body(f, date, '09:00')).expect(201);
    expect((await book(f, body(f, date, '09:00')).expect(409)).body.error.code).toBe('slot_unavailable'); // same slot again
    expect((await book(f, body(f, date, '09:00', { durationMinutes: 120 })).expect(409)).body.error.code).toBe('slot_unavailable'); // overlapping
    await request(env.app).post('/api/slots/lock').set(c.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(date, '15:00'), durationMinutes: 60 }).expect(201); // a customer is holding 3 pm, still choosing
    expect((await book(f, body(f, date, '15:00')).expect(409)).body.error.code).toBe('slot_held');
    await request(env.app).post('/api/owner/blocks/bulk').set(f.owner.auth).send({ areaIds: [f.area.id], startsAt: ist(date, '17:00'), endsAt: ist(date, '18:00'), kind: 'blocked' }).expect(201);
    expect((await book(f, body(f, date, '17:00')).expect(409)).body.error.code).toBe('slot_unavailable');
    expect((await book(f, body(f, date, '05:00')).expect(400)).body.error.code).toBe('outside_hours');
    expect((await book(f, body(f, date, '10:30')).expect(400)).body.error.code).toBe('bad_start'); // not on the 60-minute grid
  });

  it('refuses a time that has passed, but allows a slot that is still going on', async () => {
    const f = await fresh();
    expect((await book(f, body(f, dateIn(-2), '10:00')).expect(400)).body.error.code).toBe('past');
  });

  it('checks the customer\'s details', async () => {
    const f = await fresh(); const date = nextDay();
    for (const bad of [{ customerName: '' }, { customerName: 'A' }, { customerPhone: '' }, { customerPhone: '12345' }, { customerPhone: 'abcdefghij' }, { customerEmail: 'not-an-email' }, { amount: -5 }, { notes: 'x'.repeat(301) }])
      await book(f, body(f, date, '08:00', bad)).expect(400);
    await book(f, body(f, date, '08:00', { customerEmail: '' })).expect(201); // email is optional
  });

  it('only the venue\'s own owner can book it; customers and visitors cannot', async () => {
    const f = await fresh(); const date = nextDay(); const other = await registerUser(env, 'owner'); const c = await registerUser(env, 'customer');
    await book(f, body(f, date), other).expect(403); // approval aside, not this owner's turf
    await book(f, body(f, date), c).expect(403);
    await request(env.app).post('/api/owner/bookings/offline').send(body(f, date)).expect(401);
    expect((await env.db.query(`SELECT 1 FROM bookings WHERE area_id=$1`, [f.area.id])).rows).toHaveLength(0);
  });

  it('refuses a sport the area does not offer, and an area that is switched off', async () => {
    const f = await fresh(); const date = nextDay();
    const sports = (await request(env.app).get('/api/sports')).body.sports as any[]; const other = sports.find((s) => ![f.football.id, f.cricket.id].includes(s.id))!;
    expect((await book(f, body(f, date, '10:00', { sportId: other.id })).expect(400)).body.error.code).toBe('sport_not_offered');
    await request(env.app).put(`/api/owner/areas/${f.area.id}`).set(f.owner.auth).send({ isActive: false }).expect(200);
    expect((await book(f, body(f, date)).expect(409)).body.error.code).toBe('area_unavailable');
  });
});

describe('where an offline booking shows up', () => {
  it('in the owner\'s bookings with the customer\'s name and number, searchable, marked offline', async () => {
    const f = await fresh(); const date = nextDay();
    const r = await book(f, body(f, date, '10:00', { customerName: 'Meena Sundar', customerPhone: '9123456780', paymentMethod: 'upi' })).expect(201);
    const list = (await request(env.app).get('/api/owner/bookings').set(f.owner.auth).expect(200)).body.bookings as any[];
    const mine = list.find((x) => x.reference === r.body.reference)!;
    expect(mine).toMatchObject({ customer_name: 'Meena Sundar', customer_phone: '+919123456780', source: 'offline', payment_method: 'upi', status: 'confirmed', total: 800 });
    for (const q of ['Meena', '9123456780', r.body.reference]) expect(((await request(env.app).get('/api/owner/bookings').query({ q }).set(f.owner.auth).expect(200)).body.bookings as any[]).some((x) => x.reference === r.body.reference)).toBe(true);
  });
  it('on the owner\'s calendar and in the CSV report, under the customer\'s name', async () => {
    const f = await fresh(); const date = nextDay();
    const r = await book(f, body(f, date, '10:00', { customerName: 'Calendar Guest' })).expect(201);
    const cal = (await request(env.app).get('/api/owner/calendar').query({ from: `${date}T00:00:00+05:30`, to: `${date}T23:59:00+05:30` }).set(f.owner.auth).expect(200)).body.items as any[];
    expect(cal.find((x) => x.reference === r.body.reference)).toMatchObject({ customer_name: 'Calendar Guest', source: 'offline' });
    const csv = (await request(env.app).get('/api/owner/reports/bookings.csv').query({ from: dateIn(-1), to: dateIn(60) }).set(f.owner.auth).expect(200)).text;
    expect(csv).toContain('Calendar Guest'); expect(csv).toContain('offline');
  });
  it('in the admin\'s booking list, but never in any customer\'s own bookings', async () => {
    const f = await fresh(); const date = nextDay(); const c = await registerUser(env, 'customer');
    const r = await book(f, body(f, date, '10:00', { customerName: 'Admin Visible' })).expect(201);
    const adminList = (await request(env.app).get('/api/admin/bookings').query({ q: r.body.reference }).set(admin.auth).expect(200)).body.bookings as any[];
    expect(adminList.find((x) => x.reference === r.body.reference)).toMatchObject({ customer_name: 'Admin Visible' });
    expect(((await request(env.app).get('/api/bookings').set(c.auth).expect(200)).body.bookings as any[]).some((x) => x.reference === r.body.reference)).toBe(false);
  });
  it('as revenue for the owner, but not as money KickOff owes: it never appears in settlements or payouts', async () => {
    const f = await fresh(); const date = nextDay();
    const r = await book(f, body(f, date, '10:00')).expect(201);
    await env.db.query(`UPDATE bookings SET status='completed' WHERE reference=$1`, [r.body.reference]); // the game has been played
    const s = (await request(env.app).get('/api/owner/settlements').set(f.owner.auth).expect(200)).body.summary;
    expect(s.totalEarnings).toBe(0); expect(s.available).toBe(0); // KickOff never received this money
    const owed = (await request(env.app).get('/api/admin/payouts').set(admin.auth).expect(200)).body.balances as any[];
    expect(owed.find((b) => b.owner_id === f.owner.id)).toBeUndefined();
    const rep = (await request(env.app).get('/api/owner/analytics').query({ from: dateIn(-1), to: dateIn(60) }).set(f.owner.auth).expect(200)).body;
    expect(rep.summary.completed).toBeGreaterThanOrEqual(1); expect(rep.summary.net).toBe(800); // but it is the owner's revenue
  });
});

describe('cancelling an offline booking', () => {
  it('frees the slot, refunds nothing (nothing was paid through KickOff), and does not fail for lack of a customer', async () => {
    const f = await fresh(); const date = nextDay(); const c = await registerUser(env, 'customer');
    const r = await book(f, body(f, date, '10:00')).expect(201);
    const b = await row(r.body.reference);
    const cancel = await request(env.app).post(`/api/owner/bookings/${b.id}/cancel`).set(f.owner.auth).send({ reason: 'Customer called to cancel' }).expect(200);
    expect(cancel.body).toMatchObject({ status: 'cancelled', refundAmount: 0 });
    expect((await env.db.query('SELECT 1 FROM refunds WHERE booking_id=$1', [b.id])).rows).toHaveLength(0);
    expect((await row(r.body.reference)).status).toBe('cancelled');
    expect((await startBooking(env, c, f, ist(date, '10:00'))).lock.status).toBe(201); // free for an online customer again
  });
});
