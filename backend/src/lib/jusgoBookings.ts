import crypto from 'node:crypto';
import type { Ctx } from '../types.js';
import type { JusgoChange } from './jusgo.js';

/*
 * JusGo -> PlaynX: a booking made anywhere else on JusGo (walk-in, phone, another app) closes the same slot on PlaynX, so it is never sold twice.
 * Each JusGo booking that holds a slot (HELD or CONFIRMED) becomes a PlaynX block on the paired playing area; when it is cancelled, expires or
 * is deleted, the block goes. Changes arrive from GET /v1/changes (polled every few seconds) or the webhook, in the same shape.
 * Only booking.* changes are used: venue, court and price changes on JusGo do not change PlaynX.
 * The blocks are plain blocks, so the booking feed PlaynX gives JusGo never sends them back.
 */

const HOLDS_SLOT = new Set(['HELD', 'CONFIRMED']);
const FREES_SLOT = new Set(['CANCELLED', 'EXPIRED']);
const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export type ApplyResult = 'blocked' | 'moved' | 'freed' | 'duplicate' | 'ignored' | 'unmapped' | 'conflict';

async function removeBlock(ctx: Ctx, jusgoId: string): Promise<ApplyResult> {
  const m = (await ctx.db.query(
    `DELETE FROM bookings b USING jusgo_slot_blocks j WHERE j.jusgo_booking_id=$1 AND b.id=j.booking_id RETURNING b.venue_id, b.area_id`, [jusgoId])).rows[0];
  if (!m) return 'ignored';
  ctx.realtime.toVenue(m.venue_id, 'slots:changed', { areaId: m.area_id });
  return 'freed';
}

/** Put the slot on the PlaynX playing area (a new block, or the existing one moved). */
async function holdSlot(ctx: Ctx, jusgoId: string, areaId: string, start: string, end: string, channel: string | undefined): Promise<ApplyResult> {
  const area = (await ctx.db.query('SELECT a.id, a.venue_id FROM playing_areas a WHERE a.id=$1', [areaId])).rows[0];
  if (!area) return 'unmapped';
  const existing = (await ctx.db.query('SELECT booking_id FROM jusgo_slot_blocks WHERE jusgo_booking_id=$1', [jusgoId])).rows[0];
  try {
    if (existing) {
      await ctx.db.query(`UPDATE bookings SET venue_id=$2, area_id=$3, during=tstzrange($4::timestamptz,$5::timestamptz,'[)') WHERE id=$1`, [existing.booking_id, area.venue_id, area.id, start, end]);
      await ctx.db.query('UPDATE jusgo_slot_blocks SET updated_at=now() WHERE jusgo_booking_id=$1', [jusgoId]);
    } else {
      await ctx.db.tx(async (q) => {
        const b = (await q.query(
          `INSERT INTO bookings (reference, venue_id, area_id, during, status, notes, block_kind) VALUES ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz,'[)'),'blocked',$6,'blocked') RETURNING id`,
          [`JSG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, area.venue_id, area.id, start, end, `Booked on JusGo${channel ? ` (${channel.replace(/_/g, ' ')})` : ''}`])).rows[0];
        await q.query('INSERT INTO jusgo_slot_blocks (jusgo_booking_id, booking_id) VALUES ($1,$2)', [jusgoId, b.id]);
      });
    }
  } catch (e: any) {
    if (e?.code === '23P01') { // the slot is already taken on PlaynX: sold in both places at once
      console.warn(`[jusgo] booking ${jusgoId} overlaps a PlaynX booking on area ${areaId} ${start}..${end}; left for the owner to sort out`);
      return 'conflict';
    }
    throw e;
  }
  ctx.realtime.toVenue(area.venue_id, 'slots:changed', { areaId: area.id });
  return existing ? 'moved' : 'blocked';
}

/** Apply one change from JusGo, once (by its eventId). */
export async function applyJusgoChange(ctx: Ctx, c: JusgoChange): Promise<ApplyResult> {
  if (!c?.eventId || !String(c.type ?? '').startsWith('booking.')) return 'ignored';
  if ((await ctx.db.query('SELECT 1 FROM jusgo_webhook_deliveries WHERE delivery_id=$1', [c.eventId])).rows[0]) return 'duplicate';
  const out = await apply(ctx, c);
  await ctx.db.query('INSERT INTO jusgo_webhook_deliveries (delivery_id, event) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.eventId, c.type]);
  return out;
}

async function apply(ctx: Ctx, c: JusgoChange): Promise<ApplyResult> {
  const nv = c.newValues ?? {};
  const b = c.booking ?? nv.booking ?? null;
  const jusgoId = String(b?.id ?? c.entityId ?? '');
  if (!jusgoId) return 'ignored';
  if (b?.is_yours) return 'ignored'; // a PlaynX booking JusGo took from our feed: it is already on PlaynX
  if (c.type === 'booking.deleted') return removeBlock(ctx, jusgoId);
  const status = String(b?.status ?? nv.status ?? '').toUpperCase();
  if (FREES_SLOT.has(status) || c.type === 'booking.cancelled' || c.type === 'booking.expired') return removeBlock(ctx, jusgoId);
  if (c.type === 'booking.completed' || c.type === 'booking.no_show') return 'ignored'; // played: the slot is in the past

  // the PlaynX playing area: JusGo sends our own id once the court is paired with ours (Venues -> Your own IDs, or our catalog)
  const areaId = c.externalPlayingAreaId ?? b?.external_playing_area_id ?? null;
  if (!isUuid(areaId)) return 'unmapped';
  const current = (await ctx.db.query(
    `SELECT lower(b.during) AS s, upper(b.during) AS e FROM jusgo_slot_blocks j JOIN bookings b ON b.id=j.booking_id WHERE j.jusgo_booking_id=$1`, [jusgoId])).rows[0];
  const start = b?.start ?? nv.start ?? (current ? new Date(current.s).toISOString() : null);
  const end = b?.end ?? nv.end ?? (current ? new Date(current.e).toISOString() : null);
  if (!start || !end) return 'ignored';
  if (b && !HOLDS_SLOT.has(status) && !current) return 'ignored'; // something we never blocked and that does not hold a slot
  return holdSlot(ctx, jusgoId, areaId, start, end, b?.channel);
}

/** A webhook body (snake_case) in the GET /v1/changes shape, as JusGo's own docs do it. */
export function changeFromWebhook(event: any): JusgoChange {
  const d = event?.data ?? {};
  const ids = d.booking ?? d;
  return {
    eventId: String(event?.id ?? ''), type: String(event?.type ?? ''), entityType: event?.entity_type ?? null, entityId: event?.entity_id ?? null,
    venueId: ids.venue_id ?? null, playingAreaId: ids.playing_area_id ?? null, externalVenueId: ids.external_venue_id ?? null,
    externalPlayingAreaId: ids.external_playing_area_id ?? null, createdAt: event?.created_at ?? null,
    changedFields: d.changed_fields ?? [], previousValues: d.previous_values ?? {}, newValues: d.new_values ?? {}, booking: d.booking ?? null,
  };
}

/** Read every change JusGo has for us and apply it. Returns how many changes came. Safe to call often: one run at a time. */
let running = false;
export async function pollJusgoChanges(ctx: Ctx): Promise<number> {
  if (running || !ctx.jusgo?.configured) return 0;
  running = true;
  let n = 0;
  try {
    for (let page = 0; page < 20; page++) { // at most 4000 changes a run
      const res = await ctx.jusgo.changes(200);
      for (const c of res.changes ?? []) {
        try { await applyJusgoChange(ctx, c); } catch (e) { console.error('[jusgo] change failed', c?.eventId, e); }
        n++;
      }
      if (!res.hasMore) break;
    }
  } finally { running = false; }
  return n;
}
