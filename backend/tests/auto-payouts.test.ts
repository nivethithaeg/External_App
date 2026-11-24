import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
import { runAutoPayouts, settlePayout } from '../src/lib/payouts.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
const hour = 3600000;
const sent: any[] = []; let failNext = false; let seq = 0; let lastId = '';
beforeAll(async () => {
  env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin);
  await env.db.query(`UPDATE owner_profiles SET bank_verified=true, bank_account_name='Arjun', bank_account_number='123456789012', bank_ifsc='HDFC0001234' WHERE user_id=$1`, [fx.owner.id]);
  env.ctx.payouts = { enabled: () => true, async send(r) { if (failNext) { failNext = false; throw new Error('bank down'); } sent.push(r); lastId = `pout_${++seq}`; return { id: lastId, status: 'queued', fundAccountId: 'fa_1' }; } };
});
beforeEach(() => { env.clock.offsetMs = 0; sent.length = 0; });

/** a played booking whose 48-hour hold has passed: its owner share is released */
const releasedBooking = async (day: number, at = '10:00') => {
  const c = await registerUser(env, 'customer'); const date = dateIn(day);
  const r = await startBooking(env, c, fx, ist(date, at)); if (!r.booking) throw new Error('lock failed: ' + JSON.stringify(r.lock.body)); const id = r.booking.body.bookingId;
  await pay(env, c, id, r.booking.body.order.id);
  await env.db.query(`UPDATE bookings SET status='completed' WHERE id=$1`, [id]);
  env.clock.offsetMs = new Date(ist(date, at)).getTime() + hour + 49 * hour - Date.now();
  return Number((await env.db.query('SELECT owner_amount FROM bookings WHERE id=$1', [id])).rows[0].owner_amount);
};
const create = (amount: number) => request(env.app).post('/api/admin/payouts').set(admin.auth).send({ ownerId: fx.owner.id, amount, periodStart: dateIn(-30), periodEnd: dateIn(60) });
const row = async (id: string) => (await env.db.query('SELECT status, gateway_payout_id, reference, failure_reason, auto FROM owner_payouts WHERE id=$1', [id])).rows[0];

describe('sending owner payouts through the bank', () => {
  it('sends a pending payout once, marks it processing, then paid when the bank confirms; a retry cannot pay twice', async () => {
    const amount = await releasedBooking(5);
    const id = (await create(amount).expect(201)).body.payout.id;
    const out = (await request(env.app).post(`/api/admin/payouts/${id}/send`).set(admin.auth).expect(200)).body;
    expect(out.gatewayPayoutId).toBe(lastId); expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ payoutId: id, amountInr: amount, accountNumber: '123456789012', ifsc: 'HDFC0001234' });
    expect(await row(id)).toMatchObject({ status: 'processing', gateway_payout_id: lastId });
    expect((await request(env.app).post(`/api/admin/payouts/${id}/send`).set(admin.auth).expect(409)).body.error.code).toBe('payout_not_pending');
    expect(sent).toHaveLength(1);
    await settlePayout(env.ctx, lastId, { ok: true, utr: 'UTR123' }); await settlePayout(env.ctx, lastId, { ok: true, utr: 'UTR123' });
    expect(await row(id)).toMatchObject({ status: 'paid', reference: 'UTR123' });
    expect((await env.db.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND title='Payout sent'`, [fx.owner.id])).rows).toHaveLength(1);
  });

  it('a failed bank transfer is recorded and the money becomes payable again; a send that errors can be retried', async () => {
    const amount = await releasedBooking(6);
    const total = amount; // the earlier test's payout is paid, so only this booking is payable now
    const id = (await create(total).expect(201)).body.payout.id;
    failNext = true;
    await request(env.app).post(`/api/admin/payouts/${id}/send`).set(admin.auth).expect(500);
    expect(await row(id)).toMatchObject({ status: 'pending', gateway_payout_id: null });
    await request(env.app).post(`/api/admin/payouts/${id}/send`).set(admin.auth).expect(200);
    await settlePayout(env.ctx, lastId, { ok: false, reason: 'Invalid account' });
    expect(await row(id)).toMatchObject({ status: 'failed', failure_reason: 'Invalid account' });
    const bal = ((await request(env.app).get('/api/admin/payouts').set(admin.auth).expect(200)).body.balances as any[]).find((b) => b.owner_id === fx.owner.id);
    expect(bal.payable).toBe(total);
  });

  it('the webhook settles a payout', async () => {
    const amount = await releasedBooking(7); const id = (await create(amount).expect(201)).body.payout.id;
    await request(env.app).post(`/api/admin/payouts/${id}/send`).set(admin.auth).expect(200);
    await settlePayout(env.ctx, lastId, { ok: true, utr: 'U9' });
    expect((await row(id)).status).toBe('paid');
  });

  it('automatic payouts are on by default, an admin can switch them off, and they pay released balances above the minimum', async () => {
    const amount = await releasedBooking(8);
    await request(env.app).put('/api/admin/settings').set(admin.auth).send({ autoPayouts: false }).expect(200);
    expect(await runAutoPayouts(env.ctx)).toBe(0); // switched off by the admin
    await request(env.app).put('/api/admin/settings').set(admin.auth).send({ autoPayouts: true, autoPayoutMin: 100 }).expect(200);
    expect(await runAutoPayouts(env.ctx)).toBe(1); expect(sent).toHaveLength(1); expect(sent[0].amountInr).toBeGreaterThanOrEqual(amount); // also includes the earlier payout that failed
    expect(await runAutoPayouts(env.ctx)).toBe(0); // already on its way: never paid twice
    const r = (await env.db.query(`SELECT status, auto FROM owner_payouts WHERE gateway_payout_id=$1`, [lastId])).rows[0];
    expect(r).toMatchObject({ status: 'processing', auto: true });
  });

  it('is unavailable (and nothing changes) when no bank account is configured', async () => {
    const amount = await releasedBooking(9); const id = (await create(amount).expect(201)).body.payout.id;
    const keep = env.ctx.payouts; env.ctx.payouts = { enabled: () => false, send: async () => { throw new Error('no'); } };
    try { expect((await request(env.app).post(`/api/admin/payouts/${id}/send`).set(admin.auth).expect(503)).body.error.code).toBe('payouts_unavailable'); }
    finally { env.ctx.payouts = keep; }
    expect((await row(id)).status).toBe('pending');
  });
});

describe('test payouts (no RazorpayX account)', () => {
  it('after the hold with no complaint, ready money is paid out automatically and marked as a test', async () => {
    const real = env.ctx.payouts;
    const { createTestPayouts } = await import('../src/lib/payouts.js');
    env.ctx.payouts = createTestPayouts();
    try {
      await env.db.query(`UPDATE platform_settings SET value='false'::jsonb WHERE key='auto_payouts'`); // a test provider does not need the admin switch
      const amount = await releasedBooking(11);
      const { payableNow } = await import('../src/lib/payouts.js');
      const owed = await payableNow(env.ctx, fx.owner.id);
      expect(owed).toBeGreaterThan(0);
      expect(await runAutoPayouts(env.ctx)).toBe(1);
      const p = (await env.db.query(`SELECT status, is_test, reference, amount::float8 AS amount FROM owner_payouts WHERE owner_id=$1 AND is_test ORDER BY created_at DESC LIMIT 1`, [fx.owner.id])).rows[0];
      expect(p).toMatchObject({ status: 'paid', is_test: true, reference: 'TEST - no real transfer' }); expect(p.amount).toBeCloseTo(owed, 2); void amount;
      const s = (await request(env.app).get('/api/owner/settlements').set(fx.owner.auth).expect(200)).body.summary;
      expect(s.testPaid).toBeGreaterThan(0); expect(await payableNow(env.ctx, fx.owner.id)).toBe(0);
      expect(await runAutoPayouts(env.ctx)).toBe(0); // nothing left to pay
    } finally { env.ctx.payouts = real; }
  });
});
