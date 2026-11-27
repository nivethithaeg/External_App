import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => {
  env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin);
  await env.db.query('UPDATE owner_profiles SET bank_verified=true WHERE user_id=$1', [fx.owner.id]);
});
const hour = 3600000;
const balance = async () => ((await request(env.app).get('/api/admin/payouts').set(admin.auth).expect(200)).body.balances as any[]).find((b) => b.owner_id === fx.owner.id);
const settle = async () => (await request(env.app).get('/api/owner/settlements').set(fx.owner.auth).expect(200)).body.summary;
const payout = (amount: number) => request(env.app).post('/api/admin/payouts').set(admin.auth).send({ ownerId: fx.owner.id, amount, periodStart: dateIn(-30), periodEnd: dateIn(30) });

describe('customer money is held by PlaynX before it reaches the owner', () => {
  beforeEach(() => { env.clock.offsetMs = 0; });
  it('releases the owner share only 48 hours after the game, and not at all while the customer has an open complaint', async () => {
    const c = await registerUser(env, 'customer'); const date = dateIn(4);
    const r = await startBooking(env, c, fx, ist(date, '10:00')); const id = r.booking.body.bookingId;
    await pay(env, c, id, r.booking.body.order.id);
    const owner = Number((await env.db.query('SELECT owner_amount FROM bookings WHERE id=$1', [id])).rows[0].owner_amount);
    const end = new Date(ist(date, '11:00')).getTime();

    // before the game: nothing is owed yet
    expect(await balance()).toBeUndefined();
    // game played, but still inside the 48 hour hold: PlaynX keeps the money
    await env.db.query(`UPDATE bookings SET status='completed' WHERE id=$1`, [id]);
    env.clock.offsetMs = end + 47 * hour - Date.now();
    expect(await balance()).toMatchObject({ payable: 0, holding: owner, disputed: 0 });
    expect(await settle()).toMatchObject({ available: 0, holding: owner, holdHours: 48 });
    const early = await payout(owner).expect(409); expect(early.body.error.code).toBe('not_released');

    // the customer raises a complaint about this booking: after 48 hours the money still stays with PlaynX
    const t = await request(env.app).post('/api/me/tickets').set(c.auth).send({ subject: 'Turf was not as described', message: 'The ground was waterlogged.', bookingId: id }).expect(201);
    env.clock.offsetMs = end + 49 * hour - Date.now();
    expect(await balance()).toMatchObject({ payable: 0, holding: 0, disputed: owner });
    expect((await settle()).disputed).toBe(owner);
    await payout(owner).expect(409);

    // once the complaint is resolved, the money is released to the owner
    await request(env.app).post(`/api/admin/tickets/${t.body.ticket.id}/reply`).set(admin.auth).send({ message: 'Sorted with the venue.', status: 'resolved' }).expect(201);
    expect(await balance()).toMatchObject({ payable: owner, holding: 0, disputed: 0 });
    expect((await settle()).available).toBe(owner);
    await payout(owner + 1).expect(409); // never more than what is released
    await payout(owner).expect(201);
    expect(await balance()).toBeUndefined();
  });

  it('with no complaint, the money is released exactly when the 48 hours are over', async () => {
    const c = await registerUser(env, 'customer'); const date = dateIn(5);
    const r = await startBooking(env, c, fx, ist(date, '10:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    await env.db.query(`UPDATE bookings SET status='completed' WHERE id=$1`, [r.booking.body.bookingId]);
    const end = new Date(ist(date, '11:00')).getTime();
    env.clock.offsetMs = end + 48 * hour + 60000 - Date.now();
    expect((await balance()).payable).toBeGreaterThan(0);
  });

  it('the hold period is an admin setting', async () => {
    expect((await request(env.app).get('/api/admin/settings').set(admin.auth).expect(200)).body.payoutHoldHours).toBe(48);
    await request(env.app).put('/api/admin/settings').set(admin.auth).send({ payoutHoldHours: 24 }).expect(200);
    expect((await request(env.app).get('/api/admin/settings').set(admin.auth).expect(200)).body.payoutHoldHours).toBe(24);
  });
});
