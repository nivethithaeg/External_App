import type { Queryable } from '../db.js';
import { getSetting } from './settings.js';

/** Hours after a game ends before its money can be paid out to the venue owner (admin setting, default 48). */
export const holdHours = (q: Queryable) => getSetting<number>(q, 'payout_hold_hours', 48);

export interface Escrow { released: number; holding: number; disputed: number }

/**
 * What the platform holds for each owner. Customers pay KickOff first; the owner's share is only released
 *  - after the game is over and the hold period has passed, and
 *  - while the customer has no open complaint (support ticket) on that booking.
 * `released` is what may be paid out, `holding` is waiting out the hold period, `disputed` is frozen by a complaint.
 * Walk-in (offline) bookings never pass through KickOff, so they are never part of this.
 */
export async function escrowByOwner(q: Queryable, now: Date, ownerId?: string): Promise<Map<string, Escrow>> {
  const hours = await holdHours(q);
  const { rows } = await q.query(
    `SELECT v.owner_id,
       COALESCE(sum(b.owner_amount) FILTER (WHERE NOT b.disputed AND upper(b.during) + make_interval(hours => $2::int) <= $1::timestamptz), 0)::float8 AS released,
       COALESCE(sum(b.owner_amount) FILTER (WHERE NOT b.disputed AND upper(b.during) + make_interval(hours => $2::int) >  $1::timestamptz), 0)::float8 AS holding,
       COALESCE(sum(b.owner_amount) FILTER (WHERE b.disputed), 0)::float8 AS disputed
     FROM (SELECT b.*, EXISTS (SELECT 1 FROM support_tickets t WHERE t.booking_id=b.id AND t.user_id=b.customer_id AND t.status IN ('open','in_progress')) AS disputed
             FROM bookings b WHERE b.status='completed' AND b.source='online') b
     JOIN venues v ON v.id=b.venue_id
     WHERE ($3::uuid IS NULL OR v.owner_id=$3::uuid)
     GROUP BY v.owner_id`, [now.toISOString(), hours, ownerId ?? null]);
  return new Map(rows.map((r: any) => [r.owner_id, { released: r.released, holding: r.holding, disputed: r.disputed }]));
}

export const emptyEscrow: Escrow = { released: 0, holding: 0, disputed: 0 };

export type ReleaseState = 'released' | 'holding' | 'complaint' | 'none';
/** When a booking's money reaches the owner and where it stands now; `none` for bookings that never earn (cancelled, refunded, unpaid). */
export function releaseOf(endsAt: string | Date, now: Date, hours: number, status: string, disputed: boolean): { releaseAt: string | null; state: ReleaseState } {
  if (!['confirmed', 'completed'].includes(status)) return { releaseAt: null, state: 'none' };
  const at = new Date(new Date(endsAt).getTime() + hours * 3600000);
  if (disputed) return { releaseAt: at.toISOString(), state: 'complaint' };
  return { releaseAt: at.toISOString(), state: at <= now ? 'released' : 'holding' };
}
