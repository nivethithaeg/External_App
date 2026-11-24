import type { Queryable } from '../db.js';
import { priceFor, round2, toMin, type PriceRule } from './pricing.js';

/** What one playing area's day looks like: how many slots, how many a customer can still book, how many have no price. */
export interface AreaDay {
  areaId: string; areaName: string; venueId: string; venueName: string; dayOffset: number; date: string;
  total: number; open: number; unpriced: number;
  /** start of each slot a customer can book now (priced, free, still to come), in minutes after midnight in the venue's time */
  freeStarts: number[];
}

/**
 * The slots of every playing area of one owner for today (+ the next days asked), worked out with a handful of queries for all
 * areas at once. It follows the same rules as the customer's slot list (listSlots): the opening hours of the day (a date's own
 * hours win), slot length and shortest booking, prices (a date's own price wins, ₹0 is no price, special-date changes apply),
 * and what is booked, held or blocked. The database is far away, so one query per area per day would be slow.
 */
export async function ownerAreaDays(q: Queryable, ownerId: string, opts: { onlyLive: boolean; days: number[] }): Promise<AreaDay[]> {
  return areaDays(q, { owner: ownerId, onlyLive: opts.onlyLive, days: opts.days });
}

/** The same, for the venues a customer searches: their live playing areas on one date, optionally only those offering one sport. */
export async function venueAreaDays(q: Queryable, venueIds: string[], date: string, sportSlug?: string): Promise<AreaDay[]> {
  if (!venueIds.length) return [];
  return areaDays(q, { venues: venueIds, onlyLive: true, dates: [date], sportSlug });
}

async function areaDays(q: Queryable, sel: { owner?: string; venues?: string[]; onlyLive: boolean; days?: number[]; dates?: string[]; sportSlug?: string }): Promise<AreaDay[]> {
  const opts = sel;
  const live = opts.onlyLive ? `v.status='approved' AND a.approval_status='approved'` : `v.status NOT IN ('rejected','suspended') AND a.approval_status <> 'rejected'`;
  // every area and day with its opening hours already resolved, and the instant the day opens in the venue's time zone
  const days = (await q.query(
    `WITH ar AS (
       SELECT a.id, a.name, a.venue_id, v.name AS venue_name, v.timezone, a.slot_minutes, a.min_duration_minutes,
              COALESCE((SELECT ps.sport_id FROM playing_area_sports ps JOIN sports sp ON sp.id=ps.sport_id WHERE ps.playing_area_id=a.id AND sp.slug=$4), (SELECT sport_id FROM playing_area_sports ps WHERE ps.playing_area_id=a.id ORDER BY sport_id LIMIT 1)) AS sport_id
         FROM playing_areas a JOIN venues v ON v.id=a.venue_id
        WHERE ${sel.owner ? 'v.owner_id=$1' : 'v.id = ANY($1::uuid[])'} AND a.is_active AND ${live}
          AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM playing_area_sports ps JOIN sports sp ON sp.id=ps.sport_id WHERE ps.playing_area_id=a.id AND sp.slug=$4))),
     dd AS (SELECT ar.*, k, CASE WHEN $3::date[] IS NULL THEN (now() AT TIME ZONE ar.timezone)::date + k ELSE ($3::date[])[k + 1] END AS d
              FROM ar CROSS JOIN unnest(CASE WHEN $3::date[] IS NULL THEN $2::int[] ELSE ARRAY(SELECT generate_series(0, cardinality($3::date[]) - 1)) END) AS k)
     SELECT dd.id, dd.name, dd.venue_id, dd.venue_name, dd.timezone, dd.slot_minutes, dd.min_duration_minutes, dd.sport_id, dd.k, dd.d::text AS d,
            extract(dow FROM dd.d)::int AS dow,
            COALESCE(ex.closed, h.is_closed, true) AS closed,
            COALESCE(CASE WHEN ex.playing_area_id IS NOT NULL THEN COALESCE(ex.open_time, '00:00') END, h.open_time)::text AS open_time,
            COALESCE(CASE WHEN ex.playing_area_id IS NOT NULL THEN COALESCE(ex.close_time, '00:00') END, h.close_time)::text AS close_time,
            ((dd.d + COALESCE(CASE WHEN ex.playing_area_id IS NOT NULL THEN COALESCE(ex.open_time, '00:00') END, h.open_time, '00:00')) AT TIME ZONE dd.timezone) AS base_at
       FROM dd
       LEFT JOIN playing_area_hour_exceptions ex ON ex.playing_area_id=dd.id AND ex.exception_date=dd.d
       LEFT JOIN playing_area_hours h ON h.playing_area_id=dd.id AND h.day_of_week=extract(dow FROM dd.d)::int`,
    [sel.owner ?? sel.venues, sel.days ?? [0], sel.dates ?? null, sel.sportSlug ?? null])).rows;
  if (!days.length) return [];
  const ids = [...new Set(days.map((x: any) => x.id as string))]; const venues = [...new Set(days.map((x: any) => x.venue_id as string))];
  // bookings and holds over the days asked for (a day is at most 24 hours from its opening)
  const bases = days.map((x: any) => new Date(x.base_at).getTime()).filter((n: number) => !Number.isNaN(n));
  const span = { from: new Date(Math.min(...bases, Date.now()) - 86400000).toISOString(), to: new Date(Math.max(...bases, Date.now()) + 2 * 86400000).toISOString() };
  const [rules, dateSlots, adj, busy] = await Promise.all([
    q.query(`SELECT area_id, sport_id, day_type, day_of_week, start_time::text, end_time::text, price_per_hour::float8 AS price_per_hour FROM pricing_rules WHERE area_id = ANY($1::uuid[]) AND price_per_hour > 0`, [ids]),
    q.query(`SELECT playing_area_id AS area_id, price_date::text AS price_date, start_time::text AS start_time, end_time::text AS end_time, price_per_hour::float8 AS price_per_hour FROM pricing_date_slots
              WHERE playing_area_id = ANY($1::uuid[]) AND status='ACTIVE' AND price_per_hour > 0 AND price_date >= (now() - interval '2 days')::date`, [ids]),
    q.query(`SELECT venue_id, start_date::text AS start_date, end_date::text AS end_date, percent::float8 AS percent FROM price_adjustments WHERE venue_id = ANY($1::uuid[]) AND end_date >= (now() - interval '2 days')::date`, [venues]),
    q.query(`SELECT area_id, lower(during) AS s, upper(during) AS e FROM bookings
              WHERE area_id = ANY($1::uuid[]) AND status IN ('pending','confirmed','completed','blocked') AND (status <> 'pending' OR expires_at > now())
                AND during && tstzrange($2::timestamptz, $3::timestamptz)
             UNION ALL
             SELECT area_id, lower(during), upper(during) FROM slot_locks WHERE area_id = ANY($1::uuid[]) AND expires_at > now()`, [ids, span.from, span.to]),
  ]);
  const by = <T extends { area_id?: string; venue_id?: string }>(rows: T[], key: 'area_id' | 'venue_id') => { const m = new Map<string, T[]>(); for (const r of rows) { const k = (r as any)[key]; m.set(k, [...(m.get(k) ?? []), r]); } return m; };
  const rulesBy = by(rules.rows, 'area_id'), datesBy = by(dateSlots.rows, 'area_id'), adjBy = by(adj.rows, 'venue_id'), busyBy = by(busy.rows, 'area_id');
  const now = Date.now();
  return days.map((x: any): AreaDay => {
    const out: AreaDay = { areaId: x.id, areaName: x.name, venueId: x.venue_id, venueName: x.venue_name, dayOffset: x.k, date: x.d, total: 0, open: 0, unpriced: 0, freeStarts: [] };
    if (x.closed || !x.open_time || !x.close_time || !x.sport_id) return out;
    const step = x.slot_minutes as number, dur = x.min_duration_minutes as number;
    const openMin = toMin(x.open_time), closeMin = toMin(x.close_time) || (x.close_time.startsWith('24') ? 1440 : 0);
    const own = (datesBy.get(x.id) ?? []).filter((r: any) => r.price_date === x.d);
    const dayRules: PriceRule[] = [...(rulesBy.get(x.id) ?? []) as any[], ...own.map((r: any) => ({ sport_id: null, day_type: 'all' as const, day_of_week: null, start_time: r.start_time, end_time: r.end_time, price_per_hour: r.price_per_hour, priority: 1 }))];
    const change = (adjBy.get(x.venue_id) ?? []).find((r: any) => r.start_date <= x.d && x.d <= r.end_date) as any;
    const ranges = (busyBy.get(x.id) ?? []).map((b: any) => ({ s: new Date(b.s).getTime(), e: new Date(b.e).getTime() }));
    const base = new Date(x.base_at).getTime();
    for (let m = openMin; m + dur <= closeMin; m += step) {
      out.total++;
      const s = base + (m - openMin) * 60000, e = s + dur * 60000;
      if (s <= now) continue; // already started or over
      let price = priceFor(dayRules, x.dow, x.sport_id, m, dur, step);
      if (price !== null && change) price = round2((price * (100 + change.percent)) / 100);
      if (price === null) { out.unpriced++; continue; }
      if (!ranges.some((b) => b.s < e && b.e > s)) { out.open++; out.freeStarts.push(m); }
    }
    return out;
  });
}
