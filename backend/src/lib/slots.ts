import type { Queryable } from '../db.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { priceFor, round2, toMin, type PriceRule } from './pricing.js';
import { getSetting } from './settings.js';

export interface AreaContext {
  area: { id: string; venue_id: string; name: string; slot_minutes: number; min_duration_minutes: number; max_duration_minutes: number; is_active: boolean; advance_booking_days: number | null; instant_booking: boolean };
  venue: { id: string; owner_id: string; name: string; timezone: string; status: string; cancellation_hours: number; discount_percent: number };
  rules: PriceRule[];
  /** slot prices the owner set for chosen dates */
  dateSlots: { price_date: string; start_time: string; end_time: string; price_per_hour: number }[];
  adjustments: { label: string; start_date: string; end_date: string; percent: number }[];
}

/** `forOwner` skips the "is it live" checks, so an owner can price-check an area before it is published. */
export async function loadAreaContext(q: Queryable, areaId: string, sportId: number, forOwner = false): Promise<AreaContext> {
  const a = await q.query(
    `SELECT a.*, v.owner_id, v.name AS venue_name, v.timezone, v.status AS venue_status, v.cancellation_hours, v.discount_percent
       FROM playing_areas a JOIN venues v ON v.id = a.venue_id WHERE a.id = $1`, [areaId]);
  if (!a.rows[0]) throw notFound('Playing area not found');
  const r = a.rows[0];
  if (r.deletion_status) throw new HttpError(409, r.deletion_status === 'deleted' ? 'This playing area has been deleted.' : 'This playing area is being removed and cannot be booked.', 'area_deleting'); // owners and staff too
  if (!forOwner && (!r.is_active || r.venue_status !== 'approved' || r.approval_status === 'pending' || r.approval_status === 'rejected')) throw new HttpError(409, 'This area is not open for booking', 'area_unavailable');
  const s = await q.query('SELECT 1 FROM playing_area_sports WHERE playing_area_id=$1 AND sport_id=$2', [areaId, sportId]);
  if (!s.rows[0]) throw badRequest('This sport is not offered on the selected area', 'sport_not_offered');
  const rules = await q.query('SELECT sport_id, day_type, day_of_week, start_time::text, end_time::text, price_per_hour FROM pricing_rules WHERE area_id=$1 AND price_per_hour > 0', [areaId]); // a ₹0 price is a price not set: the slot cannot be booked
  const dateSlots = await q.query(`SELECT price_date::text AS price_date, start_time::text AS start_time, end_time::text AS end_time, price_per_hour::float8 AS price_per_hour FROM pricing_date_slots WHERE playing_area_id=$1 AND status='ACTIVE' AND price_per_hour > 0 AND price_date >= (now() - interval '2 days')::date`, [areaId]);
  const adj = await q.query(`SELECT label, start_date::text, end_date::text, percent FROM price_adjustments WHERE venue_id=$1 AND end_date >= (now() - interval '2 days')::date ORDER BY start_date`, [r.venue_id]);
  return {
    area: { id: r.id, venue_id: r.venue_id, name: r.name, slot_minutes: r.slot_minutes, min_duration_minutes: r.min_duration_minutes, max_duration_minutes: r.max_duration_minutes, is_active: r.is_active, advance_booking_days: r.advance_booking_days ?? null, instant_booking: r.instant_booking !== false },
    venue: { id: r.venue_id, owner_id: r.owner_id, name: r.venue_name, timezone: r.timezone, status: r.venue_status, cancellation_hours: r.cancellation_hours, discount_percent: Number(r.discount_percent ?? 0) },
    rules: rules.rows, dateSlots: dateSlots.rows, adjustments: adj.rows,
  };
}

export function assertDuration(ctx: AreaContext, durationMin: number) {
  const { slot_minutes: step, min_duration_minutes: min, max_duration_minutes: max } = ctx.area;
  if (durationMin % step !== 0) throw badRequest(`Duration must be a multiple of ${step} minutes`, 'bad_duration');
  if (durationMin < min || durationMin > max) throw badRequest(`Duration must be between ${min} and ${max} minutes`, 'bad_duration');
}

/** Local calendar info for an instant in the venue's timezone. */
async function localInfo(q: Queryable, instantIso: string, tz: string) {
  const { rows } = await q.query(
    `SELECT (($1::timestamptz) AT TIME ZONE $2)::date::text AS d,
            to_char(($1::timestamptz) AT TIME ZONE $2, 'HH24:MI') AS t,
            extract(dow FROM ($1::timestamptz) AT TIME ZONE $2)::int AS dow`, [instantIso, tz]);
  return rows[0] as { d: string; t: string; dow: number };
}

async function openingFor(q: Queryable, areaId: string, dow: number, date?: string) {
  if (date) { // date-wise hours (a holiday, an event) are used instead of the day-wise hours on that date
    const ex = (await q.query(`SELECT closed, open_time::text AS open_time, close_time::text AS close_time FROM playing_area_hour_exceptions WHERE playing_area_id=$1 AND exception_date=$2::date`, [areaId, date])).rows[0];
    if (ex) return { open_time: ex.open_time ?? '00:00:00', close_time: ex.close_time ?? '00:00:00', is_closed: !!ex.closed } as { open_time: string; close_time: string; is_closed: boolean };
  }
  const { rows } = await q.query(
    `SELECT open_time::text AS open_time, close_time::text AS close_time, is_closed FROM playing_area_hours WHERE playing_area_id=$1 AND day_of_week=$2`, [areaId, dow]);
  return rows[0] as { open_time: string; close_time: string; is_closed: boolean } | undefined;
}

/** The special-date price change in force on a local date, if any (for example +20% for Diwali). */
export function adjustmentOn(ctx: AreaContext, date: string): { label: string; percent: number } | null {
  const a = ctx.adjustments.find((x) => x.start_date <= date && date <= x.end_date);
  return a ? { label: a.label, percent: a.percent } : null;
}
const adjusted = (price: number, adj: { percent: number } | null) => (adj ? round2((price * (100 + adj.percent)) / 100) : price);

/** The weekly rules plus the prices set for this particular date (those win). */
export function rulesOn(ctx: AreaContext, date: string): PriceRule[] {
  const own = ctx.dateSlots.filter((x) => x.price_date === date);
  return own.length ? [...ctx.rules, ...own.map((x) => ({ sport_id: null, day_type: 'all' as const, day_of_week: null, start_time: x.start_time, end_time: x.end_time, price_per_hour: x.price_per_hour, priority: 1 }))] : ctx.rules;
}

export interface Quote { startsAt: Date; endsAt: Date; price: number }

/** Validates that [start, start+duration) lies on the slot grid, inside operating hours, and is priced. Does NOT check conflicts. */
export async function quote(q: Queryable, ctx: AreaContext, sportId: number, startIso: string, durationMin: number): Promise<Quote> {
  assertDuration(ctx, durationMin);
  const loc = await localInfo(q, startIso, ctx.venue.timezone);
  const open = await openingFor(q, ctx.area.id, loc.dow, loc.d);
  if (!open || open.is_closed) throw badRequest('Venue is closed on this day', 'closed');
  const startMin = toMin(loc.t), openMin = toMin(open.open_time), closeMin = toMin(open.close_time);
  if (startMin < openMin || startMin + durationMin > closeMin) throw badRequest('Selected time is outside operating hours', 'outside_hours');
  if ((startMin - openMin) % ctx.area.slot_minutes !== 0) throw badRequest('Start time is not on the slot grid', 'bad_start');
  const base = priceFor(rulesOn(ctx, loc.d), loc.dow, sportId, startMin, durationMin, ctx.area.slot_minutes);
  if (base === null) throw badRequest('No price is configured for this time', 'unpriced');
  const price = adjusted(base, adjustmentOn(ctx, loc.d));
  const startsAt = new Date(startIso);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMin * 60000), price };
}

export interface SlotView { startsAt: string; endsAt: string; price: number | null; available: boolean; reason?: 'past' | 'booked' | 'held' | 'blocked' | 'unpriced' }

export async function listSlots(q: Queryable, ctx: AreaContext, sportId: number, date: string, durationMin: number, now: Date, forUserId?: string): Promise<SlotView[]> {
  assertDuration(ctx, durationMin);
  const maxDays = await getSetting<number>(q, 'max_advance_booking_days', 60);
  const dow = (await q.query(`SELECT extract(dow FROM $1::date)::int AS dow`, [date])).rows[0].dow as number;
  const open = await openingFor(q, ctx.area.id, dow, date);
  if (!open || open.is_closed) return [];
  const tz = ctx.venue.timezone;
  const base = (await q.query(`SELECT (($1::date + $2::time) AT TIME ZONE $3) AS at`, [date, open.open_time, tz])).rows[0].at as Date;
  const openMin = toMin(open.open_time), closeMin = toMin(open.close_time), step = ctx.area.slot_minutes;
  if (base.getTime() - now.getTime() > maxDays * 86400000) return [];

  const dayStart = base, dayEnd = new Date(base.getTime() + (closeMin - openMin) * 60000);
  const busy = await q.query(
    `SELECT lower(during) AS s, upper(during) AS e, CASE WHEN status='pending' AND customer_id = $5 THEN 'mine' ELSE status::text END AS kind FROM bookings
       WHERE area_id=$1 AND status IN ('pending','confirmed','completed','blocked') AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)')
         AND (status <> 'pending' OR expires_at > $4::timestamptz)   -- an unpaid hold that has run out no longer blocks, even before the clean-up job runs
     UNION ALL
     SELECT lower(during), upper(during), CASE WHEN user_id = $5 THEN 'mine' ELSE 'held' END FROM slot_locks
       WHERE area_id=$1 AND expires_at > $4::timestamptz AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)')`,
    [ctx.area.id, dayStart.toISOString(), dayEnd.toISOString(), now.toISOString(), forUserId ?? null]);
  const busyRanges = busy.rows.map((b: any) => ({ s: new Date(b.s).getTime(), e: new Date(b.e).getTime(), kind: b.kind as string }));

  const out: SlotView[] = [];
  for (let m = openMin; m + durationMin <= closeMin; m += step) {
    const s = new Date(base.getTime() + (m - openMin) * 60000), e = new Date(s.getTime() + durationMin * 60000);
    const basePrice = priceFor(rulesOn(ctx, date), dow, sportId, m, durationMin, step);
    const price = basePrice === null ? null : adjusted(basePrice, adjustmentOn(ctx, date));
    const hit = busyRanges.find((b) => b.s < e.getTime() && b.e > s.getTime());
    let available = true; let reason: SlotView['reason'];
    if (s.getTime() <= now.getTime()) { available = false; reason = 'past'; }
    else if (price === null) { available = false; reason = 'unpriced'; }
    else if (hit && hit.kind !== 'mine') { available = false; reason = hit.kind === 'blocked' ? 'blocked' : hit.kind === 'held' || hit.kind === 'pending' ? 'held' : 'booked'; }
    out.push({ startsAt: s.toISOString(), endsAt: e.toISOString(), price, available, reason });
  }
  return out;
}
