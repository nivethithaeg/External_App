import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, type TestEnv } from './helpers.js';
import { runMaintenance } from '../src/lib/bookings.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fin = await createAdmin(env, 'finance'); fx = await createApprovedVenue(env, admin); });
beforeEach(() => { env.clock.offsetMs = 0; });
const credit = (uid: string, amount: number, reason = 'Goodwill credit', who: any = fin) => request(env.app).post(`/api/admin/users/${uid}/wallet`).set(who.auth).send({ amount, reason });
const wallet = async (c: any) => (await request(env.app).get('/api/me/wallet').set(c.auth).expect(200)).body;
const lock = (c: any, day: number, hhmm: string) => request(env.app).post('/api/slots/lock').set(c.auth).send({ areaId: fx.area.id, sportId: fx.football.id, startsAt: ist(dateIn(day), hhmm), durationMinutes: 60 });
const bk = async (c: any, day: number, hhmm: string, useWallet?: boolean) => { const l = await lock(c, day, hhmm); expect(l.status).toBe(201); const r = await request(env.app).post('/api/bookings').set(c.auth).send({ lockId: l.body.lockId, useWallet }); expect(r.status).toBe(201); return r.body; };
const row = async (id: string) => (await env.db.query('SELECT status, total, wallet_amount, wallet_released FROM bookings WHERE id=$1', [id])).rows[0];

describe('admin wallet credits', () => {
  it('credits and debits a customer with a reason, in the ledger, and only finance may', async () => {
    const c = await registerUser(env, 'customer');
    expect((await credit(c.id, 500).expect(200)).body.balance).toBe(500);
    expect((await credit(c.id, -150, 'Reversed a duplicate credit').expect(200)).body.balance).toBe(350);
    const w = await wallet(c); expect(w).toMatchObject({ balance: 350, expiryMonths: 12 }); expect(w.entries.map((e: any) => e.delta)).toEqual([-150, 500]);
    expect((await credit(c.id, -1000, 'Too much').expect(409)).body.error.code).toBe('insufficient_wallet');
    for (const bad of [{ amount: 0 }, { amount: 60000 }, { reason: 'x' }]) await request(env.app).post(`/api/admin/users/${c.id}/wallet`).set(fin.auth).send({ amount: 10, reason: 'Fine reason', ...bad }).expect(400);
    await credit(c.id, 10, 'Support credit', (await createAdmin(env, 'support'))).expect(403);
    await request(env.app).post(`/api/admin/users/${fx.owner.id}/wallet`).set(fin.auth).send({ amount: 10, reason: 'Not a customer' }).expect(404);
    const view = (await request(env.app).get(`/api/admin/users/${c.id}/wallet`).set(fin.auth).expect(200)).body; expect(view.balance).toBe(350);
    expect((await env.db.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='wallet'`, [c.id])).rows).toHaveLength(1);
  });

  it('credit expires after 12 months and then cannot be spent', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 400).expect(200);
    env.clock.offsetMs = 13 * 31 * 86400000; // about 13 months on
    expect((await wallet(c)).balance).toBe(0);
    expect(await bk(c, 13 * 31 + 5, '10:00', true)).toMatchObject({ walletUsed: 0, cardDue: 800 }); // a booking made then gets no wallet part
    env.clock.offsetMs = 0;
  });
});

describe('paying a booking with the wallet', () => {
  it('uses the wallet first and charges the card only for the rest', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 300).expect(200);
    const r = (await bk(c, 10, '10:00', true)); // 800
    expect(r).toMatchObject({ total: 800, walletUsed: 300, cardDue: 500 }); expect(r.order.amount).toBe(500);
    expect((await env.db.query('SELECT amount FROM payments WHERE booking_id=$1', [r.bookingId])).rows[0].amount).toBe(500);
    expect((await wallet(c)).balance).toBe(0); // taken at once
    await pay(env, c, r.bookingId, r.order.id);
    expect(await row(r.bookingId)).toMatchObject({ status: 'confirmed', wallet_amount: 300, wallet_released: false });
  });

  it('covers the whole booking with no card payment at all when the balance is enough', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 1000).expect(200);
    const r = (await bk(c, 11, '10:00', true));
    expect(r).toMatchObject({ total: 800, walletUsed: 800, cardDue: 0, order: null }); expect((await row(r.bookingId)).status).toBe('confirmed');
    expect((await wallet(c)).balance).toBe(200);
  });

  it('does nothing unless asked, and never spends more than the balance or the total', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 5000).expect(200);
    const plain = (await bk(c, 12, '10:00')); expect(plain).toMatchObject({ walletUsed: 0, cardDue: 800 }); expect((await wallet(c)).balance).toBe(5000);
    await request(env.app).post(`/api/bookings/${plain.bookingId}/payment-failed`).set(c.auth).expect(200);
    const all = (await bk(c, 13, '10:00', true)); expect(all.walletUsed).toBe(800); expect((await wallet(c)).balance).toBe(4200);
    const none = await registerUser(env, 'customer'); expect((await bk(none, 14, '10:00', true))).toMatchObject({ walletUsed: 0, cardDue: 800 }); // empty wallet
  });

  it('gives the wallet part back when the payment fails, is abandoned, or the hold runs out, exactly once', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 300).expect(200);
    const a = (await bk(c, 15, '10:00', true)); expect((await wallet(c)).balance).toBe(0);
    await request(env.app).post(`/api/bookings/${a.bookingId}/payment-failed`).set(c.auth).expect(200);
    expect((await wallet(c)).balance).toBe(300); expect((await row(a.bookingId)).wallet_released).toBe(true);
    await request(env.app).post(`/api/bookings/${a.bookingId}/payment-failed`).set(c.auth).expect(200); expect((await wallet(c)).balance).toBe(300); // not twice
    const b = (await bk(c, 16, '10:00', true)); expect((await wallet(c)).balance).toBe(0);
    env.clock.offsetMs = 20 * 60000; await runMaintenance(env.ctx); await runMaintenance(env.ctx); // the hold lapses
    expect((await row(b.bookingId)).status).toBe('expired'); expect((await wallet(c)).balance).toBe(300);
  });

  it('takes the wallet part again if the card payment arrives after the hold lapsed, or refunds the card if the wallet money is gone', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 300).expect(200);
    const b = (await bk(c, 17, '10:00', true));
    env.clock.offsetMs = 20 * 60000; await runMaintenance(env.ctx); expect((await wallet(c)).balance).toBe(300);
    await pay(env, c, b.bookingId, b.order.id); // late payment, slot still free: the booking comes back
    expect(await row(b.bookingId)).toMatchObject({ status: 'confirmed', wallet_released: false }); expect((await wallet(c)).balance).toBe(0);
    const d = (await bk(c, 18, '10:00', true)); // wallet is empty now, so this is a full card booking with no wallet part
    expect(d.walletUsed).toBe(0); await request(env.app).post(`/api/bookings/${d.bookingId}/payment-failed`).set(c.auth).expect(200);
    // second customer: wallet money spent elsewhere before a late payment lands
    const e = await registerUser(env, 'customer'); await credit(e.id, 300).expect(200);
    const f = (await bk(e, 19, '10:00', true));
    env.clock.offsetMs += 20 * 60000; await runMaintenance(env.ctx); expect((await wallet(e)).balance).toBe(300);
    const spent = (await bk(e, 20, '10:00', true)); expect(spent.walletUsed).toBe(300); expect((await wallet(e)).balance).toBe(0); // spends the returned money
    await pay(env, e, f.bookingId, f.order.id);
    expect((await row(f.bookingId)).status).not.toBe('confirmed'); // cannot be revived: the wallet part is gone, so the card payment is refunded
    const refunds = (await env.db.query('SELECT amount, status FROM refunds WHERE booking_id=$1', [f.bookingId])).rows; expect(refunds).toHaveLength(1); expect(Number(refunds[0].amount)).toBe(500);
  });
});

describe('cancelling a booking paid with the wallet', () => {
  it('returns the wallet part to the wallet and the card part to the card by default', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 300).expect(200);
    const b = (await bk(c, 25, '10:00', true)); await pay(env, c, b.bookingId, b.order.id);
    const r = (await request(env.app).post(`/api/bookings/${b.bookingId}/cancel`).set(c.auth).send({}).expect(200)).body;
    expect(r).toMatchObject({ refundAmount: 800, toWallet: 300 }); expect((await wallet(c)).balance).toBe(300);
    const ref = (await env.db.query('SELECT amount, status FROM refunds WHERE booking_id=$1', [b.bookingId])).rows; expect(ref).toHaveLength(1); expect(Number(ref[0].amount)).toBe(500); // only the card part goes to the gateway
  });

  it('keeps the card part as wallet credit when the customer chooses, with no gateway refund', async () => {
    const c = await registerUser(env, 'customer'); const b = (await bk(c, 26, '10:00')); await pay(env, c, b.bookingId, b.order.id);
    const calls = env.gatewayCalls.refunds.length;
    const r = (await request(env.app).post(`/api/bookings/${b.bookingId}/cancel`).set(c.auth).send({ refundTo: 'wallet' }).expect(200)).body;
    expect(r).toMatchObject({ refundAmount: 800, toWallet: 800 }); expect((await wallet(c)).balance).toBe(800);
    expect((await env.db.query('SELECT 1 FROM refunds WHERE booking_id=$1', [b.bookingId])).rows).toHaveLength(0); expect(env.gatewayCalls.refunds.length).toBe(calls);
    expect((await wallet(c)).entries[0]).toMatchObject({ kind: 'refund', delta: 800 });
    await request(env.app).post(`/api/bookings/${b.bookingId}/cancel`).set(c.auth).send({ refundTo: 'cheque' }).expect(400);
  });

  it('refunds nothing for a late cancellation, and a venue cancelling always refunds the original method', async () => {
    const c = await registerUser(env, 'customer'); await credit(c.id, 300).expect(200);
    const late = (await bk(c, 27, '10:00', true)); await pay(env, c, late.bookingId, late.order.id);
    env.clock.offsetMs = new Date(ist(dateIn(27), '10:00')).getTime() - 3600000 - Date.now(); // an hour before: inside the window
    expect((await request(env.app).post(`/api/bookings/${late.bookingId}/cancel`).set(c.auth).send({ refundTo: 'wallet' }).expect(200)).body).toMatchObject({ refundAmount: 0, toWallet: 0 });
    env.clock.offsetMs = 0; expect((await wallet(c)).balance).toBe(0);
    const v = (await bk(c, 28, '10:00')); await pay(env, c, v.bookingId, v.order.id);
    const r = (await request(env.app).post(`/api/owner/bookings/${v.bookingId}/cancel`).set(fx.owner.auth).send({ reason: 'Ground flooded', refundTo: 'wallet' }).expect(200)).body;
    expect(r.toWallet).toBe(0); expect(Number((await env.db.query('SELECT amount FROM refunds WHERE booking_id=$1', [v.bookingId])).rows[0].amount)).toBe(800);
  });
});
