import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
import { walkIn } from './walkin.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); });
type Fx = Awaited<ReturnType<typeof createApprovedVenue>>;
const offline = (f: Fx, date: string) => walkIn(env, f.owner.auth)
  .send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(date, '10:00'), durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210', paymentMethod: 'cash' });
const area = async (id: string) => (await env.db.query('SELECT * FROM playing_areas WHERE id=$1', [id])).rows[0];

describe('deleting a playing area needs admin approval', () => {
  it('the request greys it out and closes it for every kind of booking at once; the bookings stay', async () => {
    const f = await createApprovedVenue(env, admin);
    const c = await registerUser(env, 'customer');
    const { booking } = await startBooking(env, c, f, ist(dateIn(4), '18:00'));
    expect(booking.status).toBe(201);
    const before = env.emails.length;
    const r = await request(env.app).delete(`/api/owner/areas/${f.area.id}`).set(f.owner.auth).send({ reason: 'Converting it to parking' }).expect(202);
    expect(r.body).toEqual({ deletionStatus: 'pending', upcomingBookings: 1 });
    const a = await area(f.area.id);
    expect(a).toMatchObject({ deletion_status: 'pending', is_active: false, active_before_delete: true, deletion_reason: 'Converting it to parking' });
    expect(env.emails.slice(before).some((m) => m.subject === 'Playing area deletion requested' && m.to === admin.email)).toBe(true);

    // closed for customers, for walk-ins and for edits; asking twice is refused
    expect((await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date: dateIn(6), sportId: f.football.id, duration: 60 })).status).toBe(409);
    expect((await offline(f, dateIn(7))).status).toBe(409);
    await request(env.app).put(`/api/owner/areas/${f.area.id}`).set(f.owner.auth).send({ name: 'Renamed' }).expect(409);
    await request(env.app).delete(`/api/owner/areas/${f.area.id}`).set(f.owner.auth).expect(409);
    // the existing booking is still there
    expect((await env.db.query(`SELECT count(*)::int AS n FROM bookings WHERE area_id=$1 AND status <> 'blocked'`, [f.area.id])).rows[0].n).toBe(1);

    // the admin sees it with its bookings and approves: deleted, but the row and its bookings stay
    const list = (await request(env.app).get('/api/admin/areas?deletion=pending').set(admin.auth).expect(200)).body.areas;
    expect(list.find((x: any) => x.id === f.area.id)).toMatchObject({ deletionStatus: 'pending', deletionReason: 'Converting it to parking', upcomingBookings: 1, totalBookings: 1 });
    await request(env.app).post(`/api/admin/areas/${f.area.id}/deletion`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    expect(await area(f.area.id)).toMatchObject({ deletion_status: 'deleted', is_active: false });
    expect((await env.db.query(`SELECT count(*)::int AS n FROM bookings WHERE area_id=$1`, [f.area.id])).rows[0].n).toBe(1);
    expect((await offline(f, dateIn(8))).status).toBe(409);
    await request(env.app).post(`/api/owner/areas/${f.area.id}/cancel-deletion`).set(f.owner.auth).expect(409); // too late
    const ov = (await request(env.app).get('/api/owner/overview').set(f.owner.auth).expect(200)).body;
    expect(ov.counts.areas).toBe(0); // a deleted area is not counted
  });

  it('turned down by the admin: back open for booking, with the reason', async () => {
    const f = await createApprovedVenue(env, admin);
    await request(env.app).delete(`/api/owner/areas/${f.area.id}`).set(f.owner.auth).expect(202);
    await request(env.app).post(`/api/admin/areas/${f.area.id}/deletion`).set(admin.auth).send({ decision: 'reject' }).expect(400); // a reason is needed
    await request(env.app).post(`/api/admin/areas/${f.area.id}/deletion`).set(admin.auth).send({ decision: 'reject', note: 'It has bookings next week' }).expect(200);
    expect(await area(f.area.id)).toMatchObject({ deletion_status: null, is_active: true, deletion_note: 'It has bookings next week' });
    expect((await offline(f, dateIn(9))).status).toBe(201);
  });

  it('the owner can take the request back before the admin decides; an inactive area stays inactive', async () => {
    const f = await createApprovedVenue(env, admin);
    await request(env.app).put(`/api/owner/areas/${f.area.id}`).set(f.owner.auth).send({ isActive: false }).expect(200);
    await request(env.app).delete(`/api/owner/areas/${f.area.id}`).set(f.owner.auth).expect(202);
    await request(env.app).post(`/api/owner/areas/${f.area.id}/cancel-deletion`).set(f.owner.auth).expect(200);
    expect(await area(f.area.id)).toMatchObject({ deletion_status: null, is_active: false });
    await request(env.app).post(`/api/admin/areas/${f.area.id}/deletion`).set(admin.auth).send({ decision: 'approve' }).expect(404); // nothing to decide
  });

  it('another owner cannot delete it', async () => {
    const f = await createApprovedVenue(env, admin); const other = await registerUser(env, 'owner');
    expect((await request(env.app).delete(`/api/owner/areas/${f.area.id}`).set(other.auth)).status).toBeGreaterThanOrEqual(403);
  });
});
