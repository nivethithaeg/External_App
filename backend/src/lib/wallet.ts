import type { Queryable } from '../db.js';
import { round2 } from './pricing.js';

/** Wallet credit lasts this long from the day it is added. */
export const WALLET_MONTHS = 12;
export type WalletSource = 'refund' | 'admin' | 'release';

/** What the customer can spend now: every credit that has not expired and has money left. */
export async function walletBalance(q: Queryable, userId: string, now: Date): Promise<number> {
  const { rows } = await q.query(`SELECT COALESCE(sum(remaining),0)::float8 AS n FROM wallet_lots WHERE user_id=$1 AND remaining > 0 AND expires_at > $2::timestamptz`, [userId, now.toISOString()]);
  return round2(rows[0].n);
}

export async function walletCredit(q: Queryable, i: { userId: string; amount: number; source: WalletSource; note: string; bookingId?: string | null; createdBy?: string | null; now: Date; kind?: 'refund' | 'admin_credit' | 'booking_release' }) {
  const amount = round2(i.amount); if (!(amount > 0)) return;
  const expires = new Date(i.now); expires.setUTCMonth(expires.getUTCMonth() + WALLET_MONTHS);
  await q.query(`INSERT INTO wallet_lots (user_id, amount, remaining, source, note, booking_id, created_at, expires_at) VALUES ($1,$2,$2,$3,$4,$5,$6,$7)`, [i.userId, amount, i.source, i.note, i.bookingId ?? null, i.now.toISOString(), expires.toISOString()]);
  await q.query(`INSERT INTO wallet_ledger (user_id, delta, kind, booking_id, note, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [i.userId, amount, i.kind ?? (i.source === 'admin' ? 'admin_credit' : i.source === 'release' ? 'booking_release' : 'refund'), i.bookingId ?? null, i.note, i.createdBy ?? null, i.now.toISOString()]);
}

/**
 * Takes money out of the wallet, from the credits that expire soonest first. All or nothing: returns false (and changes nothing) when the
 * balance is not enough. Call it inside the same transaction as whatever it pays for.
 */
export async function walletDebit(q: Queryable, i: { userId: string; amount: number; kind: 'booking_payment' | 'admin_debit'; note: string; bookingId?: string | null; createdBy?: string | null; now: Date }): Promise<boolean> {
  const amount = round2(i.amount); if (!(amount > 0)) return true;
  const lots = (await q.query(`SELECT id, remaining::float8 AS remaining FROM wallet_lots WHERE user_id=$1 AND remaining > 0 AND expires_at > $2::timestamptz ORDER BY expires_at, created_at FOR UPDATE`, [i.userId, i.now.toISOString()])).rows as { id: string; remaining: number }[];
  if (round2(lots.reduce((n, l) => n + l.remaining, 0)) < amount) return false;
  let left = amount;
  for (const l of lots) {
    if (left <= 0) break;
    const take = round2(Math.min(l.remaining, left));
    await q.query('UPDATE wallet_lots SET remaining = remaining - $2 WHERE id=$1', [l.id, take]); left = round2(left - take);
  }
  await q.query(`INSERT INTO wallet_ledger (user_id, delta, kind, booking_id, note, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [i.userId, -amount, i.kind, i.bookingId ?? null, i.note, i.createdBy ?? null, i.now.toISOString()]);
  return true;
}

/** Hands back the wallet part of a booking that never completed (unpaid, expired or abandoned). Safe to call twice: the second call does nothing. */
export async function releaseWalletFor(q: Queryable, bookingId: string, now: Date) {
  const r = await q.query(`UPDATE bookings SET wallet_released=true WHERE id=$1 AND wallet_amount > 0 AND NOT wallet_released RETURNING customer_id, wallet_amount::float8 AS amt, reference`, [bookingId]);
  if (r.rows[0]) await walletCredit(q, { userId: r.rows[0].customer_id, amount: r.rows[0].amt, source: 'release', note: `Booking ${r.rows[0].reference} was not completed`, bookingId, now });
}
