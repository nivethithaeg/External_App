import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

const book = async (c: any, day: number, hhmm: string) => { const r = await startBooking(env, c, fx, ist(dateIn(day), hhmm)); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id); return r.booking.body.bookingId as string; };

describe('owner go-live checklist', () => {
  it('lists what is left, in order, and marks a finished venue complete', async () => {
    const fresh = await registerUser(env, 'owner'); await approveOwner(env, admin, fresh);
    const empty = (await request(env.app).get('/api/owner/checklist').set(fresh.auth).expect(200)).body;
    expect(empty.venue).toBeNull(); expect(empty.items.map((i: any) => i.id)).toEqual(['verified', 'bank', 'venue']);
    expect(empty.items.find((i: any) => i.id === 'venue')).toMatchObject({ done: false, link: '/owner/venues/new' }); expect(empty.complete).toBe(false);
    await request(env.app).post('/api/owner/venues').set(fresh.auth).send({ pincode: '560001', name: 'Fresh Arena', address: '1 New Road', city: 'Bengaluru', lat: 12.9, lng: 77.5 }).expect(201);
    const c = (await request(env.app).get('/api/owner/checklist').set(fresh.auth).expect(200)).body;
    expect(c.venue.name).toBe('Fresh Arena'); expect(c.items.find((i: any) => i.id === 'venue').done).toBe(true);
    for (const id of ['photos', 'bill', 'area', 'prices', 'submit', 'live']) expect(c.items.find((i: any) => i.id === id)).toMatchObject({ done: false });
    expect(c.done).toBeLessThan(c.total);
    const done = (await request(env.app).get('/api/owner/checklist').set(fx.owner.auth).expect(200)).body; // the approved venue from the fixture
    expect(done.items.find((i: any) => i.id === 'live').done).toBe(true); expect(done.items.find((i: any) => i.id === 'prices').done).toBe(true);
  });
});

describe('owner repeat-customer report', () => {
  it('counts customers, who came back, and ranks the best ones', async () => {
    const a = await registerUser(env, 'customer'); const b = await registerUser(env, 'customer');
    await book(a, 30, '10:00'); await book(a, 31, '10:00'); await book(a, 32, '10:00'); await book(b, 33, '10:00');
    const r = (await request(env.app).get('/api/owner/reports/customers').set(fx.owner.auth).expect(200)).body;
    expect(r.customers).toBeGreaterThanOrEqual(2); expect(r.repeatCustomers).toBeGreaterThanOrEqual(1);
    expect(r.top[0].bookings).toBeGreaterThanOrEqual(3); expect(r.repeatRate).toBeGreaterThan(0);
    const other = await registerUser(env, 'owner'); await approveOwner(env, admin, other);
    expect((await request(env.app).get('/api/owner/reports/customers').set(other.auth).expect(200)).body).toMatchObject({ customers: 0, repeatCustomers: 0, repeatRate: 0 }); // only their own venues
  });
});

describe('admin commission by venue', () => {
  it('shows bookings, gross, commission and the effective rate per venue, and a CSV', async () => {
    const q = { from: dateIn(-1), to: dateIn(60) };
    const rows = (await request(env.app).get('/api/admin/reports/commission-by-venue').query(q).set(admin.auth).expect(200)).body.rows as any[];
    const mine = rows.find((r) => r.id === fx.venue.id)!;
    expect(mine.bookings).toBeGreaterThanOrEqual(4); expect(mine.effective_rate).toBe(10); expect(mine.commission).toBeCloseTo(mine.gross * 0.1, 1);
    const csv = await request(env.app).get('/api/admin/reports/commission-by-venue').query({ ...q, format: 'csv' }).set(admin.auth).expect(200);
    expect(csv.headers['content-type']).toMatch(/csv/); expect(csv.text).toContain('Green Arena');
    await request(env.app).get('/api/admin/reports/commission-by-venue').query({ from: 'x', to: 'y' }).set(admin.auth).expect(400);
    await request(env.app).get('/api/admin/reports/commission-by-venue').query(q).set(fx.owner.auth).expect(403);
  });
});

describe('who cancelled a booking', () => {
  it('records whether the customer or the venue cancelled', async () => {
    const c = await registerUser(env, 'customer');
    const byCustomer = await book(c, 44, '12:00'); await request(env.app).post(`/api/bookings/${byCustomer}/cancel`).set(c.auth).send({}).expect(200);
    const byVenue = await book(c, 45, '12:00'); await request(env.app).post(`/api/owner/bookings/${byVenue}/cancel`).set(fx.owner.auth).send({ reason: 'Ground flooded' }).expect(200);
    const who = async (id: string) => (await env.db.query(`SELECT cancelled_by FROM bookings WHERE id=$1`, [id])).rows[0].cancelled_by;
    expect(await who(byCustomer)).toBe('customer'); expect(await who(byVenue)).toBe('venue');
  });
});
