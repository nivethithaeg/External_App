import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
import { runMaintenance } from '../src/lib/bookings.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
beforeEach(() => { env.clock.offsetMs = 0; });
const hour = 3600000;
const paid = async (c: any, day: number, hhmm: string) => { const r = await startBooking(env, c, fx, ist(dateIn(day), hhmm)); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id); return r.booking.body.bookingId as string; };
const move = (c: any, id: string, day: number, hhmm: string) => request(env.app).post(`/api/bookings/${id}/reschedule`).set(c.auth).send({ startsAt: ist(dateIn(day), hhmm) });
const row = async (id: string) => (await env.db.query('SELECT lower(during) AS s, reschedule_count, previous_starts_at, qr_token, reference, status FROM bookings WHERE id=$1', [id])).rows[0];

describe('rescheduling a booking', () => {
  it('moves a paid booking to another free slot at the same price, keeping its reference and QR pass, and tells both sides', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 10, '10:00');
    const before = await row(id);
    const r = await move(c, id, 11, '12:00').expect(200);
    expect(r.body).toMatchObject({ bookingId: id, reference: before.reference });
    const after = await row(id);
    expect(new Date(after.s).toISOString()).toBe(new Date(ist(dateIn(11), '12:00')).toISOString()); expect(after.reschedule_count).toBe(1);
    expect(new Date(after.previous_starts_at).toISOString()).toBe(new Date(ist(dateIn(10), '10:00')).toISOString());
    expect(after.qr_token).toBe(before.qr_token); expect(after.status).toBe('confirmed');
    const note = (uid: string, type: string) => env.db.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND type=$2`, [uid, type]);
    expect((await note(c.id, 'booking_rescheduled')).rows).toHaveLength(1); expect((await note(fx.owner.id, 'owner_booking_rescheduled')).rows).toHaveLength(1);
    // the old slot is free again, the new one is taken
    const slots = async (day: number) => ((await request(env.app).get(`/api/areas/${fx.area.id}/slots`).query({ date: dateIn(day), sportId: fx.football.id, duration: 60 }).expect(200)).body.slots as any[]);
    const at = (list: any[], hhmm: string, day: number) => list.find((s) => new Date(s.startsAt).toISOString() === new Date(ist(dateIn(day), hhmm)).toISOString());
    expect(at(await slots(10), '10:00', 10).available).toBe(true); expect(at(await slots(11), '12:00', 11).available).toBe(false);
  });

  it('only once, and only with the booking\'s owner', async () => {
    const c = await registerUser(env, 'customer'); const other = await registerUser(env, 'customer'); const id = await paid(c, 12, '10:00');
    await move(other, id, 13, '10:00').expect(403);
    await move(c, id, 13, '10:00').expect(200);
    const again = await move(c, id, 14, '10:00').expect(409); expect(again.body.error.code).toBe('already_rescheduled');
  });

  it('refuses a slot with a different price, a slot someone else holds, the same time, and a past time', async () => {
    const c = await registerUser(env, 'customer'); const rival = await registerUser(env, 'customer'); const id = await paid(c, 15, '10:00');
    expect((await move(c, id, 15, '18:00').expect(409)).body.error.code).toBe('price_differs'); // evening costs more than the morning
    await paid(rival, 16, '11:00');
    expect((await move(c, id, 16, '11:00').expect(409)).body.error.code).toBe('slot_unavailable');
    expect((await move(c, id, 15, '10:00').expect(400)).body.error.code).toBe('same_slot');
    expect((await move(c, id, -1, '10:00').expect(400)).body.error.code).toBe('past');
    await request(env.app).post(`/api/bookings/${id}/reschedule`).set(c.auth).send({ startsAt: 'tomorrow' }).expect(400);
    expect((await row(id)).reschedule_count).toBe(0); // none of the refusals changed the booking
  });

  it('is not allowed once the cancellation window has started, for unpaid or cancelled bookings', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 20, '10:00');
    env.clock.offsetMs = new Date(ist(dateIn(20), '10:00')).getTime() - 2 * hour - Date.now(); // 2 hours before the game
    expect((await move(c, id, 21, '10:00').expect(409)).body.error.code).toBe('too_late');
    env.clock.offsetMs = 0;
    const unpaid = await startBooking(env, c, fx, ist(dateIn(22), '10:00')); // pending
    expect((await move(c, unpaid.booking.body.bookingId, 23, '10:00').expect(409)).body.error.code).toBe('not_reschedulable');
    const gone = await paid(c, 24, '10:00'); await request(env.app).post(`/api/bookings/${gone}/cancel`).set(c.auth).send({}).expect(200);
    expect((await move(c, gone, 25, '10:00').expect(409)).body.error.code).toBe('not_reschedulable');
  });

  it('gives the moved game its own reminders', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 30, '10:00');
    env.clock.offsetMs = new Date(ist(dateIn(30), '10:00')).getTime() - 23 * hour - Date.now(); await runMaintenance(env.ctx);
    expect((await env.db.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='booking_reminder'`, [c.id])).rows).toHaveLength(1);
    env.clock.offsetMs = 0; await move(c, id, 32, '10:00').expect(200);
    expect((await env.db.query('SELECT reminder_24h_at FROM bookings WHERE id=$1', [id])).rows[0].reminder_24h_at).toBeNull(); // reminders start over for the new time
  });
});
