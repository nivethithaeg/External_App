import type { Ctx } from '../types.js';
import type { Queryable } from '../db.js';
import type { JusgoChange } from './jusgo.js';

/*
 * JusGo -> PlaynX details. A venue linked with JusGo is managed in JusGo (PlaynX refuses those edits for a linked owner), so what PlaynX shows
 * follows JusGo: venue details, playing area details, opening hours and special days, slot settings, sports and prices. Applied from each
 * change, and every minute from GET /v1/venues so a change that never arrived still lands. Blocked times reach PlaynX as busy times
 * (see jusgoBookings.ts).
 */

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const hhmm = (t: unknown) => (typeof t === 'string' && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null);
const lower = (v: unknown, allowed: string[]) => { const x = typeof v === 'string' ? v.toLowerCase() : ''; return allowed.includes(x) ? x : undefined; };
const ENVIRONMENT: Record<string, string> = { TURF: 'indoor', OPEN_GROUND: 'outdoor' };

/** UPDATE only the columns given (undefined ones are skipped) and only when something differs. */
async function patchRow(q: Queryable, table: 'venues' | 'playing_areas', id: string, patch: Record<string, unknown>) {
  const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!cols.length) return 0;
  const set = cols.map((k, i) => `${k}=$${i + 2}`).join(', ');
  const differs = cols.map((k, i) => `${k} IS DISTINCT FROM $${i + 2}`).join(' OR ');
  return (await q.query(`UPDATE ${table} SET ${set} WHERE id=$1 AND (${differs})`, [id, ...cols.map((k) => patch[k])])).rowCount ?? 0;
}

const areasOf = async (q: Queryable, venueId: string) => (await q.query('SELECT id FROM playing_areas WHERE venue_id=$1', [venueId])).rows.map((r: any) => r.id as string);

/** JusGo's weekly hours (a day missing = closed) replace the playing area's. day_of_week 0 = Sunday, the same as PlaynX. */
async function setHours(q: Queryable, areaId: string, hours: any[]) {
  if (!Array.isArray(hours)) return;
  await q.query('DELETE FROM playing_area_hours WHERE playing_area_id=$1', [areaId]);
  for (let d = 0; d < 7; d++) {
    const h = hours.find((x) => Number(x?.day_of_week) === d && hhmm(x.open_time) && hhmm(x.close_time));
    await q.query('INSERT INTO playing_area_hours (playing_area_id, day_of_week, open_time, close_time, is_closed) VALUES ($1,$2,$3,$4,$5)',
      [areaId, d, h ? hhmm(h.open_time) : '00:00', h ? (hhmm(h.close_time) === '00:00' ? '23:59' : hhmm(h.close_time)) : '23:59', !h]); // a closed day still needs open < close
  }
}
async function setExceptions(q: Queryable, areaId: string, list: any[]) {
  if (!Array.isArray(list)) return;
  const venue = (await q.query('SELECT venue_id FROM playing_areas WHERE id=$1', [areaId])).rows[0]?.venue_id;
  await q.query('DELETE FROM playing_area_hour_exceptions WHERE playing_area_id=$1', [areaId]);
  for (const x of list) if (typeof x?.date === 'string')
    await q.query('INSERT INTO playing_area_hour_exceptions (playing_area_id, venue_id, exception_date, closed, open_time, close_time, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [areaId, venue, x.date, !!x.closed, x.closed ? null : hhmm(x.open_time), x.closed ? null : hhmm(x.close_time), str(x.reason, 200) ?? null]);
}
/** Sports by name (JusGo's "football" is PlaynX's "Football"); names PlaynX does not know are skipped. */
async function setAreaSports(q: Queryable, areaId: string, names: unknown) {
  if (!Array.isArray(names)) return;
  const ids = (await q.query('SELECT id FROM sports WHERE lower(name) = ANY($1) OR lower(slug) = ANY($1)', [names.map((n) => String(n).toLowerCase())])).rows.map((r: any) => r.id);
  if (!ids.length) return;
  const have = (await q.query('SELECT sport_id FROM playing_area_sports WHERE playing_area_id=$1 ORDER BY sport_id', [areaId])).rows.map((r: any) => r.sport_id);
  if (JSON.stringify(have) === JSON.stringify([...ids].sort((a, b) => a - b))) return;
  await q.query('DELETE FROM playing_area_sports WHERE playing_area_id=$1', [areaId]);
  await q.query('INSERT INTO playing_area_sports (playing_area_id, sport_id) SELECT $1, unnest($2::int[])', [areaId, ids]);
  await q.query('INSERT INTO venue_sports (venue_id, sport_id) SELECT a.venue_id, unnest($2::int[]) FROM playing_areas a WHERE a.id=$1 ON CONFLICT DO NOTHING', [areaId, ids]);
}
async function setVenueSports(q: Queryable, venueId: string, names: unknown) {
  if (!Array.isArray(names)) return;
  const ids = (await q.query('SELECT id FROM sports WHERE lower(name) = ANY($1) OR lower(slug) = ANY($1)', [names.map((n) => String(n).toLowerCase())])).rows.map((r: any) => r.id);
  if (ids.length) await q.query('INSERT INTO venue_sports (venue_id, sport_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING', [venueId, ids]);
}
/** JusGo's price for PlaynX on one court: the hourly price, plus rules for some days and hours. Replaces the weekly prices when different. */
async function setPricing(q: Queryable, areaId: string, p: any) {
  const base = num(p?.pricePerHour);
  if (!base || base <= 0) return;
  const want: [number | null, string, string, number][] = [[null, '00:00', '24:00', base]];
  if (!p.separatePrice) for (const r of Array.isArray(p.rules) ? p.rules : []) {
    const price = num(r?.pricePerHour); const s = hhmm(r?.start); const e = r?.end === '24:00' ? '24:00' : hhmm(r?.end);
    if (!price || !s || !e) continue;
    for (const d of Array.isArray(r.days) && r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6]) want.push([Number(d), s, e, price]);
  }
  const key = (x: any[]) => x.map((r) => r.join('|')).sort().join(';');
  const have = (await q.query(`SELECT day_of_week, to_char(start_time,'HH24:MI') AS s, CASE WHEN end_time='24:00' THEN '24:00' ELSE to_char(end_time,'HH24:MI') END AS e, price_per_hour::float8 AS p
      FROM pricing_rules WHERE area_id=$1`, [areaId])).rows.map((r: any) => [r.day_of_week, r.s, r.e, r.p]);
  if (key(have) === key(want)) return;
  await q.query('DELETE FROM pricing_rules WHERE area_id=$1', [areaId]);
  for (const [d, s, e, price] of want)
    await q.query(`INSERT INTO pricing_rules (area_id, sport_id, day_type, day_of_week, start_time, end_time, price_per_hour) VALUES ($1,NULL,'all',$2,$3,$4,$5)`, [areaId, d, s, e, price]);
}

/** A court's details from GET /v1/venues or a playing_area.updated change (JusGo names) onto the PlaynX playing area. */
async function applyCourt(q: Queryable, areaId: string, f: Record<string, any>) {
  const active = typeof f.is_active === 'boolean' ? f.is_active : typeof f.status === 'string' ? f.status === 'ACTIVE' : undefined;
  const slots = f.slot_configuration ?? {};
  await patchRow(q, 'playing_areas', areaId, {
    name: str(f.name, 100), capacity: f.capacity === null ? null : num(f.capacity), surface: str(f.surface_type ?? f.surfaceType, 80),
    roof_type: lower(f.roof_type ?? f.roofType, ['open', 'closed', 'covered', 'retractable']), turf_shape: lower(f.turf_shape ?? f.turfShape, ['round', 'rectangle']),
    environment: ENVIRONMENT[String(f.ground_type ?? f.groundType)], is_active: active,
    slot_minutes: num(slots.duration_in_minutes), min_duration_minutes: num(slots.min_duration_minutes), max_duration_minutes: num(slots.max_duration_minutes),
    advance_booking_days: num(slots.advance_booking_limit_hours) ? Math.max(1, Math.round(slots.advance_booking_limit_hours / 24)) : undefined,
    instant_booking: typeof slots.instant_booking === 'boolean' ? slots.instant_booking : undefined,
  });
  if ('sport_types' in f || 'sportTypes' in f) await setAreaSports(q, areaId, f.sport_types ?? f.sportTypes);
  if ('operating_hours' in f) await setHours(q, areaId, f.operating_hours);
  if ('hour_exceptions' in f) await setExceptions(q, areaId, f.hour_exceptions);
  if (f.pricing) await setPricing(q, areaId, f.pricing);
}
/** A venue's details (JusGo names) onto the PlaynX venue; its hours and special days go to each of its playing areas. */
async function applyVenue(q: Queryable, venueId: string, f: Record<string, any>) {
  const a = f.address ?? {};
  const contact = typeof f.contact === 'string' ? f.contact : f.contact?.phone;
  await patchRow(q, 'venues', venueId, {
    name: str(f.venue_name ?? f.name, 120), description: f.description === null ? null : str(f.description, 2000),
    address: str(f.address_line1 ?? a.line1, 300), address_line2: f.address_line2 === null || a.line2 === null ? null : str(f.address_line2 ?? a.line2, 300),
    city: str(f.city ?? a.city, 80), state: str(f.state ?? a.state, 80), pincode: str(f.postal_code ?? a.postalCode, 10),
    lat: num(f.latitude), lng: num(f.longitude), map_url: str(f.map_url, 500), timezone: str(f.timezone, 60), contact_phone: str(contact, 20),
  });
  const active = typeof f.is_active === 'boolean' ? f.is_active : typeof f.status === 'string' ? f.status === 'ACTIVE' : undefined;
  if (active === false) await q.query(`UPDATE venues SET status='ready' WHERE id=$1 AND status='approved'`, [venueId]); // switched off on JusGo: hidden here
  if (active === true) await q.query(`UPDATE venues SET status='approved' WHERE id=$1 AND status='ready'`, [venueId]);
  if ('sports' in f) await setVenueSports(q, venueId, f.sports);
  if ('operating_hours' in f) for (const id of await areasOf(q, venueId)) await setHours(q, id, f.operating_hours);
  if ('hour_exceptions' in f) for (const id of await areasOf(q, venueId)) await setExceptions(q, id, f.hour_exceptions);
}

/** One venue.*, playing_area.* or pricing.* change. Returns false when it is not for a paired PlaynX venue or court. */
export async function applyJusgoDetailChange(ctx: Ctx, c: JusgoChange): Promise<boolean> {
  const nv: Record<string, any> = {};
  for (const k of c.changedFields ?? []) nv[k] = c.newValues?.[k];
  if (c.type.startsWith('venue.')) {
    if (!isUuid(c.externalVenueId)) return false;
    if (c.type === 'venue.deleted') { nv.is_active = false; await ctx.db.query('UPDATE playing_areas SET is_active=false WHERE venue_id=$1', [c.externalVenueId]); }
    await ctx.db.tx((q) => applyVenue(q, c.externalVenueId!, nv));
    return true;
  }
  if (!isUuid(c.externalPlayingAreaId)) return false;
  const areaId = c.externalPlayingAreaId;
  if (c.type.startsWith('playing_area.')) {
    if (c.type === 'playing_area.deleted') nv.is_active = false;
    await ctx.db.tx((q) => applyCourt(q, areaId, nv));
    return true;
  }
  if (c.type === 'pricing.updated' && c.playingAreaId && ctx.jusgo) {
    const { pricing } = await ctx.jusgo.pricing(c.playingAreaId);
    await ctx.db.tx((q) => setPricing(q, areaId, pricing));
    return true;
  }
  if (c.type === 'pricing.date_updated') {
    for (const e of Array.isArray(c.newValues?.entries) ? c.newValues!.entries : []) {
      const s = hhmm(e?.start); const en = e?.end === '24:00' ? '24:00' : hhmm(e?.end);
      if (typeof e?.date !== 'string' || !s || !en) continue;
      await ctx.db.query(`UPDATE pricing_date_slots SET status=$5, ended_at=now(), updated_at=now() WHERE playing_area_id=$1 AND price_date=$2 AND start_time=$3::time AND end_time=$4::time AND status='ACTIVE'`,
        [areaId, e.date, s, en, e.action === 'removed' ? 'REMOVED' : 'SUPERSEDED']);
      if (e.action !== 'removed' && num(e.price_per_hour))
        await ctx.db.query('INSERT INTO pricing_date_slots (playing_area_id, price_date, start_time, end_time, price_per_hour) VALUES ($1,$2,$3,$4,$5)', [areaId, e.date, s, en, e.price_per_hour]);
    }
    return true;
  }
  return false;
}

/** Every minute: the details in GET /v1/venues (venue, address, courts, sports, prices) onto PlaynX. */
export async function applyJusgoCatalog(ctx: Ctx, venues: any[]) {
  for (const v of venues ?? []) {
    if (isUuid(v.externalId)) await ctx.db.tx((q) => applyVenue(q, v.externalId, v));
    for (const pa of v.playingAreas ?? []) if (isUuid(pa.externalId)) await ctx.db.tx((q) => applyCourt(q, pa.externalId, pa));
  }
}
