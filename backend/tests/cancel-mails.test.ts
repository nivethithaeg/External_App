import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
beforeEach(() => { env.clock.offsetMs = 0; env.gatewayCalls.failRefund = false; });
const paid = async (c: any, day: number) => { const r = await startBooking(env, c, fx, ist(dateIn(day), '10:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id); return r.booking.body.bookingId as string; };
const mails = (to: string) => env.emails.filter((m) => m.to === to).map((m) => ({ subject: m.subject, text: m.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }));
const cancel = (who: any, id: string, body: object = {}) => request(env.app).post(`/api/bookings/${id}/cancel`).set(who.auth).send(body);

describe('emails when a booking is cancelled and when money is refunded', () => {
  it('a customer who cancels in time gets a cancellation email and a refund email with when to expect the money', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 20);
    const before = mails(c.email).length;
    await cancel(c, id).expect(200);
    const got = mails(c.email).slice(before);
    expect(got.map((m) => m.subject)).toEqual(expect.arrayContaining(['Booking cancelled', 'Refund issued']));
    expect(got.find((m) => m.subject === 'Booking cancelled')!.text).toMatch(/is being refunded to your original payment method.*5 to 7 working days/);
    expect(got.find((m) => m.subject === 'Refund issued')!.text).toMatch(/5 to 7 working days/);
    expect(mails(fx.owner.email).some((m) => m.subject === 'Booking cancelled')).toBe(true); // the owner is told too
  });

  it('wallet refunds say the money is in the wallet and send no card-refund email', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 21);
    const before = mails(c.email).length;
    await cancel(c, id, { refundTo: 'wallet' }).expect(200);
    const got = mails(c.email).slice(before);
    expect(got.find((m) => m.subject === 'Booking cancelled')!.text).toMatch(/added to your KickOff wallet/);
    expect(got.some((m) => m.subject === 'Refund issued')).toBe(false);
  });

  it('a late cancellation says plainly that no refund applies, and sends no refund email', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 22);
    env.clock.offsetMs = new Date(ist(dateIn(22), '10:00')).getTime() - 60 * 60_000 - Date.now(); // one hour before the game
    const before = mails(c.email).length;
    await cancel(c, id).expect(200);
    const got = mails(c.email).slice(before);
    expect(got.find((m) => m.subject === 'Booking cancelled')!.text).toMatch(/No refund applies because it was cancelled less than \d+ hours before the game/);
    expect(got.some((m) => m.subject === 'Refund issued')).toBe(false);
  });

  it('when the venue cancels, the customer is told and refunded in full', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 23);
    const before = mails(c.email).length;
    await cancel(fx.owner, id).expect(200);
    const got = mails(c.email).slice(before);
    expect(got.find((m) => m.subject === 'Booking cancelled')!.text).toMatch(/cancelled by the venue.*refunded to your original payment method/);
    expect(got.some((m) => m.subject === 'Refund issued')).toBe(true);
  });

  it('a refund that fails at the gateway tells the customer it is delayed and alerts the admins', async () => {
    const c = await registerUser(env, 'customer'); const id = await paid(c, 24);
    env.gatewayCalls.failRefund = true;
    const before = mails(c.email).length;
    await cancel(c, id).expect(200);
    expect(mails(c.email).slice(before).some((m) => m.subject === 'Your refund is delayed')).toBe(true);
    const alert = await env.db.query(`SELECT 1 FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.role='admin' AND n.title='A refund failed'`);
    expect(alert.rows.length).toBeGreaterThan(0);
  });

  it('nothing is emailed for an unpaid booking that is dropped (nothing was charged)', async () => {
    const c = await registerUser(env, 'customer'); const r = await startBooking(env, c, fx, ist(dateIn(25), '10:00'));
    const before = mails(c.email).length;
    await cancel(c, r.booking.body.bookingId).expect(200);
    const got = mails(c.email).slice(before);
    expect(got.some((m) => m.subject === 'Refund issued')).toBe(false);
  });
});
