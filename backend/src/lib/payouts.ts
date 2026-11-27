import type { Config } from '../config.js';
import type { Ctx } from '../types.js';
import { HttpError, conflict, notFound } from '../errors.js';
import { escrowByOwner, emptyEscrow, holdHours } from './escrow.js';
import { getSetting } from './settings.js';

export interface PayoutRequest { payoutId: string; ownerId: string; name: string; accountNumber: string; ifsc: string; amountInr: number; fundAccountId?: string | null }
export interface PayoutProvider {
  /** False until the bank account for payouts is configured; everything then stays manual. */
  enabled(): boolean;
  /** a test provider: nothing is sent to a bank, the payout is recorded as paid at once and marked as a test */
  test?: boolean;
  send(r: PayoutRequest): Promise<{ id: string; status: string; fundAccountId: string }>;
}

/** RazorpayX payouts (https://razorpay.com/docs/x/payouts). Uses the same API keys as payments plus the business account number. */
export function createRazorpayXPayouts(cfg: Config): PayoutProvider {
  const auth = 'Basic ' + Buffer.from(`${cfg.RAZORPAY_KEY_ID}:${cfg.RAZORPAY_KEY_SECRET}`).toString('base64');
  const call = async (path: string, body: unknown, idempotencyKey?: string) => {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth, ...(idempotencyKey ? { 'X-Payout-Idempotency': idempotencyKey } : {}) }, body: JSON.stringify(body) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, json?.error?.description ?? 'The bank transfer service returned an error', 'payout_gateway_error');
    return json;
  };
  return {
    enabled: () => !!(cfg.RAZORPAY_KEY_ID && cfg.RAZORPAY_KEY_SECRET && cfg.RAZORPAYX_ACCOUNT_NUMBER),
    async send(r) {
      let fund = r.fundAccountId ?? null;
      if (!fund) {
        const contact = await call('/contacts', { name: r.name, type: 'vendor', reference_id: r.ownerId });
        fund = (await call('/fund_accounts', { contact_id: contact.id, account_type: 'bank_account', bank_account: { name: r.name, ifsc: r.ifsc, account_number: r.accountNumber } })).id as string;
      }
      const p = await call('/payouts', { account_number: cfg.RAZORPAYX_ACCOUNT_NUMBER, fund_account_id: fund, amount: Math.round(r.amountInr * 100), currency: 'INR', mode: 'IMPS', purpose: 'payout', queue_if_low_balance: true, reference_id: r.payoutId, narration: 'PlaynX payout' }, r.payoutId);
      return { id: p.id as string, status: p.status as string, fundAccountId: fund };
    },
  };
}

/** Test payouts (PAYOUTS_TEST_MODE, never in production): no bank is called; each payout is settled at once as a test. */
export function createTestPayouts(): PayoutProvider {
  return { enabled: () => true, test: true, async send(r) { return { id: `test_${r.payoutId}`, status: 'processed', fundAccountId: 'test' }; } };
}

/** What can be paid to this owner right now: released money (after the hold and with no open complaint) minus payouts already made or on their way. */
export async function payableNow(ctx: Ctx, ownerId: string) {
  const e = (await escrowByOwner(ctx.db, ctx.now(), ownerId)).get(ownerId) ?? emptyEscrow;
  const paid = Number((await ctx.db.query(`SELECT COALESCE(sum(amount),0) AS s FROM owner_payouts WHERE owner_id=$1 AND status<>'failed'`, [ownerId])).rows[0].s);
  return Math.max(0, Math.round((e.released - paid) * 100) / 100);
}

/** Hands one pending payout to the bank. It stays 'processing' until the bank's webhook says it was paid or failed. */
export async function sendPayout(ctx: Ctx, payoutId: string, auto = false) {
  if (!ctx.payouts?.enabled()) throw new HttpError(503, 'Bank payouts are not set up. Mark the payout as paid by hand instead.', 'payouts_unavailable');
  const p = (await ctx.db.query(
    `SELECT p.id, p.owner_id, p.amount::float8 AS amount, p.status, p.gateway_payout_id, o.bank_verified, o.bank_account_name, o.bank_account_number, o.bank_ifsc, o.gateway_fund_account_id
       FROM owner_payouts p JOIN owner_profiles o ON o.user_id=p.owner_id WHERE p.id=$1`, [payoutId])).rows[0];
  if (!p) throw notFound('Payout not found');
  if (p.status !== 'pending' || p.gateway_payout_id) throw conflict('This payout was already sent or settled', 'payout_not_pending');
  if (!p.bank_verified || !p.bank_account_number || !p.bank_ifsc) throw conflict("The owner's bank account is not verified", 'bank_unverified');
  // claim it first so two clicks (or the scheduler and an admin) cannot both send it
  const claim = await ctx.db.query(`UPDATE owner_payouts SET status='processing', auto=$2 WHERE id=$1 AND status='pending' RETURNING id`, [payoutId, auto]);
  if (!claim.rowCount) throw conflict('This payout is already being sent', 'payout_not_pending');
  try {
    const out = await ctx.payouts.send({ payoutId, ownerId: p.owner_id, name: p.bank_account_name ?? 'Owner', accountNumber: p.bank_account_number, ifsc: p.bank_ifsc, amountInr: p.amount, fundAccountId: p.gateway_fund_account_id });
    await ctx.db.query('UPDATE owner_payouts SET gateway_payout_id=$2 WHERE id=$1', [payoutId, out.id]);
    await ctx.db.query('UPDATE owner_profiles SET gateway_fund_account_id=$2 WHERE user_id=$1', [p.owner_id, out.fundAccountId]);
    return { gatewayPayoutId: out.id, status: out.status };
  } catch (e) {
    await ctx.db.query(`UPDATE owner_payouts SET status='pending', auto=false WHERE id=$1 AND gateway_payout_id IS NULL`, [payoutId]); // nothing was sent: safe to try again
    throw e;
  }
}

/** The bank's verdict on a payout (from the webhook). Safe to call twice. */
export async function settlePayout(ctx: Ctx, gatewayPayoutId: string, outcome: { ok: true; utr?: string | null } | { ok: false; reason: string }) {
  const r = outcome.ok
    ? await ctx.db.query(`UPDATE owner_payouts SET status='paid', paid_at=now(), reference=COALESCE($2,reference) WHERE gateway_payout_id=$1 AND status IN ('processing','pending') RETURNING owner_id, amount`, [gatewayPayoutId, outcome.utr ?? null])
    : await ctx.db.query(`UPDATE owner_payouts SET status='failed', failure_reason=$2 WHERE gateway_payout_id=$1 AND status IN ('processing','pending') RETURNING owner_id, amount`, [gatewayPayoutId, outcome.reason.slice(0, 300)]);
  const row = r.rows[0];
  if (!row) return;
  await ctx.notifier.notify(row.owner_id, { title: outcome.ok ? 'Payout sent' : 'Payout failed', type: 'payout', email: true,
    body: outcome.ok ? `Your payout of ₹${row.amount} has been sent to your bank account.` : `Your payout of ₹${row.amount} could not be completed (${outcome.reason}). PlaynX will retry.` });
}

/** Optional scheduled job: pays every owner whose released balance reaches the minimum. Off unless an admin turns it on and the bank account is set up. */
export async function runAutoPayouts(ctx: Ctx) {
  // a test provider always pays out automatically; a real one only when an admin has switched auto payouts on
  if (!ctx.payouts?.enabled() || (!ctx.payouts.test && !(await getSetting<boolean>(ctx.db, 'auto_payouts', true)))) return 0;
  const min = await getSetting<number>(ctx.db, 'auto_payout_min', 500);
  const owners = (await ctx.db.query(`SELECT user_id FROM owner_profiles WHERE bank_verified AND bank_account_number IS NOT NULL`)).rows as { user_id: string }[];
  const today = ctx.now().toISOString().slice(0, 10); let sent = 0;
  void holdHours;
  for (const o of owners) {
    try {
      const amount = await payableNow(ctx, o.user_id);
      if (amount < min) continue;
      const row = (await ctx.db.query(`INSERT INTO owner_payouts (owner_id, amount, period_start, period_end, auto, is_test) VALUES ($1,$2,$3,$3,true,$4) RETURNING id`, [o.user_id, amount, today, !!ctx.payouts.test])).rows[0];
      const out = await sendPayout(ctx, row.id, true); sent++;
      if (ctx.payouts.test) await settlePayout(ctx, out.gatewayPayoutId, { ok: true, utr: 'TEST - no real transfer' }); // a test: paid at once, nothing reached a bank
    } catch (e) { console.error('[auto-payout]', o.user_id, (e as Error).message); }
  }
  return sent;
}
