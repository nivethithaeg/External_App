import type { Queryable } from '../db.js';
import { rateAt, toMin, type PriceRule } from './pricing.js';

/**
 * The lowest hourly price a customer can really book in each playing area: over every open hour of the week, for every
 * sport the area offers, the price that slot would cost. A price that no open slot ever uses (for example a default price
 * fully replaced by a sport's own prices) is not counted. ₹0 means no price and is left out.
 */
export async function areaFromPrices(q: Queryable, areaIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!areaIds.length) return out;
  const [areas, hours, sports, rules] = await Promise.all([
    q.query(`SELECT id, slot_minutes FROM playing_areas WHERE id = ANY($1::uuid[])`, [areaIds]),
    q.query(`SELECT playing_area_id AS id, day_of_week, open_time::text AS o, close_time::text AS c FROM playing_area_hours WHERE playing_area_id = ANY($1::uuid[]) AND NOT is_closed`, [areaIds]),
    q.query(`SELECT playing_area_id AS id, sport_id FROM playing_area_sports WHERE playing_area_id = ANY($1::uuid[])`, [areaIds]),
    q.query(`SELECT area_id AS id, sport_id, day_type, day_of_week, start_time::text AS start_time, end_time::text AS end_time, price_per_hour::float8 AS price_per_hour
               FROM pricing_rules WHERE area_id = ANY($1::uuid[]) AND price_per_hour > 0`, [areaIds]),
  ]);
  const group = <T extends { id: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r.id, [...(m.get(r.id) ?? []), r]); return m; };
  const hBy = group(hours.rows as any[]), sBy = group(sports.rows as any[]), rBy = group(rules.rows as any[]);
  for (const a of areas.rows as { id: string; slot_minutes: number }[]) {
    const rs = (rBy.get(a.id) ?? []) as unknown as PriceRule[]; const sp = (sBy.get(a.id) ?? []).map((x: any) => x.sport_id as number);
    let best = Infinity;
    for (const h of hBy.get(a.id) ?? [] as any[]) {
      const open = toMin(h.o), close = toMin(h.c) || (String(h.c).startsWith('24') ? 1440 : 0);
      for (let m = open; m + a.slot_minutes <= close; m += a.slot_minutes)
        for (const s of sp) { const r = rateAt(rs, h.day_of_week, s, m); if (r != null && Number(r) > 0 && Number(r) < best) best = Number(r); }
    }
    if (best < Infinity) out.set(a.id, best);
  }
  return out;
}
