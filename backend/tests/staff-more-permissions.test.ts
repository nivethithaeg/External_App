import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, ist, setup, type TestEnv } from './helpers.js';
const dayAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let env: TestEnv;
beforeAll(async () => { env = await setup(); });

/** An approved venue, an owner, and a staff login with the given permissions. */
async function fixture(permissions: string[], email: string) {
  const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
  await request(env.app).post('/api/owner/staff').set(own).send({ fullName: 'Gate Staff', email, password: 'GatePassword1', permissions }).expect(201);
  const login = (await request(env.app).post('/api/auth/login').send({ email, password: 'GatePassword1' }).expect(200)).body;
  return { f, own, staff: { Authorization: `Bearer ${login.token}` }, staffId: login.user.id as string };
}

describe('staff: block slots, view customers, record event payments', () => {
  it('the owner sees the three new permissions, and staff without them are refused', async () => {
    const { own, staff } = await fixture(['CHECK_IN'], 'p0@test.dev');
    const ids = (await request(env.app).get('/api/owner/staff').set(own).expect(200)).body.permissions.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['BLOCK_SLOTS', 'CUSTOMER_VIEW', 'PAYMENT_RECORD']));
    for (const path of ['/api/staff/blocks', '/api/staff/customers', '/api/staff/event-payments']) await request(env.app).get(path).set(staff).expect(403);
  });

  it('blocks a slot for a reason and opens it again; an owner event cannot be removed this way', async () => {
    const { f, own, staff } = await fixture(['BLOCK_SLOTS'], 'p1@test.dev');
    const day = dayAhead(4);
    const opts = (await request(env.app).get('/api/staff/blocks').set(staff).expect(200)).body;
    expect(opts.areas.map((a: any) => a.id)).toContain(f.area.id);
    await request(env.app).post('/api/staff/blocks').set(staff).send({ areaId: f.area.id, startsAt: ist(day, '10:00'), endsAt: ist(day, '12:00') }).expect(400); // a reason is needed
    const made = (await request(env.app).post('/api/staff/blocks').set(staff).send({ areaId: f.area.id, startsAt: ist(day, '10:00'), endsAt: ist(day, '12:00'), reason: 'Rain' }).expect(201)).body.block;
    await request(env.app).post('/api/staff/blocks').set(staff).send({ areaId: f.area.id, startsAt: ist(day, '11:00'), endsAt: ist(day, '13:00'), reason: 'Again' }).expect(409);
    const slots = (await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date: day, sportId: f.football.id })).body.slots;
    expect(slots.find((s: any) => s.startsAt === new Date(ist(day, '10:00')).toISOString()).reason).toBe('blocked');
    expect((await request(env.app).get('/api/staff/blocks').set(staff).expect(200)).body.blocks.map((b: any) => b.reason)).toEqual(['Rain']);
    await request(env.app).delete(`/api/staff/blocks/${made.id}`).set(staff).expect(204);
    // an event the owner added stays: staff cannot remove it
    const ev = (await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ areaIds: [f.area.id], startsAt: ist(day, '15:00'), endsAt: ist(day, '16:00'), reason: 'Cup final', customerName: 'Erode FC', customerPhone: '9876500011', amount: 2000, paymentMethod: 'unpaid' }).expect(201)).body;
    const evId = (await env.db.query(`SELECT id FROM bookings WHERE area_id=$1 AND event_kind IS NOT NULL`, [f.area.id])).rows[0].id;
    expect(ev).toBeTruthy();
    await request(env.app).delete(`/api/staff/blocks/${evId}`).set(staff).expect(404);
  });

  it('lists customers with name and mobile only, no amounts', async () => {
    const { f, own, staff } = await fixture(['CUSTOMER_VIEW'], 'p2@test.dev');
    await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ areaIds: [f.area.id], startsAt: ist(dayAhead(5), '15:00'), endsAt: ist(dayAhead(5), '16:00'), reason: 'Coaching', customerName: 'Sunrise Academy', customerPhone: '9876500022', amount: 1500, paymentMethod: 'cash', eventKind: 'academic' }).expect(201);
    const list = (await request(env.app).get('/api/staff/customers').set(staff).expect(200)).body.customers;
    const c = list.find((x: any) => x.name === 'Sunrise Academy');
    expect(c).toMatchObject({ mobile: '+919876500022', bookings: 1 });
    for (const k of ['spent', 'total', 'paid', 'refs']) expect(c).not.toHaveProperty(k);
    expect((await request(env.app).get('/api/staff/customers?search=sunrise').set(staff).expect(200)).body.customers).toHaveLength(1);
  });

  it('records cash, UPI or card for a venue event, never more than is pending and never a discount', async () => {
    const { f, own, staff } = await fixture(['PAYMENT_RECORD'], 'p3@test.dev');
    await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ areaIds: [f.area.id], startsAt: ist(dayAhead(6), '15:00'), endsAt: ist(dayAhead(6), '16:00'), reason: 'Corporate match', customerName: 'Acme Ltd', customerPhone: '9876500033', amount: 3000, amountPaid: 1000, paymentMethod: 'cash' }).expect(201);
    const ev = (await request(env.app).get('/api/staff/event-payments').set(staff).expect(200)).body.events;
    expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ name: 'Acme Ltd', total: 3000, paid: 1000, pending: 2000 });
    await request(env.app).post(`/api/staff/event-payments/${ev[0].id}`).set(staff).send({ amount: 500 }).expect(400); // the mode is needed
    await request(env.app).post(`/api/staff/event-payments/${ev[0].id}`).set(staff).send({ amount: 2500, mode: 'upi' }).expect(400); // more than pending
    expect((await request(env.app).post(`/api/staff/event-payments/${ev[0].id}`).set(staff).send({ amount: 2000, mode: 'upi', discount: 500 }).expect(200)).body).toMatchObject({ paid: 3000, pending: 0 });
    expect((await request(env.app).get('/api/staff/event-payments').set(staff).expect(200)).body.events).toHaveLength(0); // fully paid: off the list
  });
});
