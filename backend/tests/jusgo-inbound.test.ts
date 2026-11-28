import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, ist, setup, type TestEnv } from './helpers.js';
import { pollJusgoChanges, reconcileJusgoAvailability } from '../src/lib/jusgoBookings.js';

const dayAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let env: TestEnv; let n = 0;
beforeAll(async () => { env = await setup({ JUSGO_WEBHOOK_SECRET: 'whsec_test' }); });

const slotsOf = async (f: any, day: string) => (await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date: day, sportId: f.football.id })).body.slots as any[];
const at = (slots: any[], day: string, hhmm: string) => slots.find((s) => s.startsAt === new Date(ist(day, hhmm)).toISOString());
const change = (type: string, f: any, booking: Record<string, unknown> | null, extra: Record<string, unknown> = {}): any => ({
  eventId: `e-${++n}`, type, entityType: 'booking', entityId: (booking?.id as string) ?? 'bk-x', playingAreaId: 'pa-1', externalPlayingAreaId: f.area.id,
  changedFields: [], previousValues: {}, newValues: {}, booking, ...extra,
});

describe('JusGo -> PlaynX: a booking on JusGo closes the slot here', () => {
  it('a confirmed or held booking on JusGo blocks the PlaynX slot; cancelling it opens the slot again', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const day = dayAhead(3);
    env.jusgo.pending.push(change('booking.confirmed', f, { id: 'bk-1', playing_area_id: 'pa-1', start: ist(day, '18:00'), end: ist(day, '19:00'), status: 'CONFIRMED', channel: 'walk_in', is_yours: false }));
    expect(await pollJusgoChanges(env.ctx)).toBe(1);
    expect(at(await slotsOf(f, day), day, '18:00')).toMatchObject({ available: false, reason: 'blocked' });
    // the owner sees why
    const blocks = (await request(env.app).get(`/api/owner/areas/${f.area.id}/blocks`).set(f.owner.auth).expect(200)).body.blocks;
    expect(blocks).toEqual([expect.objectContaining({ reason: 'Booked on JusGo (walk in)' })]);
    // nobody can book it on PlaynX
    env.jusgo.pending.push(change('booking.cancelled', f, { id: 'bk-1', playing_area_id: 'pa-1', start: ist(day, '18:00'), end: ist(day, '19:00'), status: 'CANCELLED', channel: 'walk_in', is_yours: false }));
    await pollJusgoChanges(env.ctx);
    expect(at(await slotsOf(f, day), day, '18:00')).toMatchObject({ available: true });
  });

  it('a hold that expires frees the slot; a moved booking moves the block', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const day = dayAhead(4);
    env.jusgo.pending.push(change('booking.held', f, { id: 'bk-2', start: ist(day, '10:00'), end: ist(day, '11:00'), status: 'HELD', channel: 'partner', is_yours: false }));
    env.jusgo.pending.push(change('booking.updated', f, null, { entityId: 'bk-2', changedFields: ['start', 'end'], newValues: { start: ist(day, '14:00'), end: ist(day, '15:00') } }));
    await pollJusgoChanges(env.ctx);
    let slots = await slotsOf(f, day);
    expect(at(slots, day, '10:00').available).toBe(true); expect(at(slots, day, '14:00')).toMatchObject({ available: false, reason: 'blocked' });
    env.jusgo.pending.push(change('booking.expired', f, { id: 'bk-2', status: 'EXPIRED', is_yours: false }));
    await pollJusgoChanges(env.ctx);
    slots = await slotsOf(f, day);
    expect(at(slots, day, '14:00').available).toBe(true);
  });

  it('skips PlaynX\'s own bookings, courts that are not paired yet, other kinds of change, and an event seen before', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const day = dayAhead(5);
    const own = change('booking.confirmed', f, { id: 'bk-3', start: ist(day, '07:00'), end: ist(day, '08:00'), status: 'CONFIRMED', is_yours: true });
    const unpaired = change('booking.confirmed', f, { id: 'bk-4', start: ist(day, '08:00'), end: ist(day, '09:00'), status: 'CONFIRMED', is_yours: false }, { externalPlayingAreaId: null });
    const price = { ...change('pricing.updated', f, null), entityType: 'pricing' };
    const blockIt = change('booking.confirmed', f, { id: 'bk-5', start: ist(day, '09:00'), end: ist(day, '10:00'), status: 'CONFIRMED', is_yours: false });
    env.jusgo.pending.push(own, unpaired, price, blockIt, { ...blockIt }); // the same event twice
    await pollJusgoChanges(env.ctx);
    const slots = await slotsOf(f, day);
    expect(at(slots, day, '07:00').available).toBe(true); expect(at(slots, day, '08:00').available).toBe(true); expect(at(slots, day, '09:00').available).toBe(false);
    expect((await env.db.query(`SELECT count(*)::int AS n FROM jusgo_slot_blocks j JOIN bookings b ON b.id=j.booking_id WHERE b.area_id=$1`, [f.area.id])).rows[0].n).toBe(1);
  });

  it('these blocks are never sent back to JusGo in the booking feed', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const day = dayAhead(6);
    env.jusgo.pending.push(change('booking.confirmed', f, { id: 'bk-6', start: ist(day, '11:00'), end: ist(day, '12:00'), status: 'CONFIRMED', is_yours: false }));
    await pollJusgoChanges(env.ctx);
    const key = (await request(env.app).post('/api/owner/sync-key').set(f.owner.auth).expect(201)).body.key;
    const feed = (await request(env.app).get('/api/playnx/bookings').set({ Authorization: `Bearer ${key}` }).expect(200)).body.bookings;
    expect(feed.some((x: any) => x.start === new Date(ist(day, '11:00')).toISOString())).toBe(false);
  });

  it('the same booking events work through the webhook, signed', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const day = dayAhead(7);
    const body = JSON.stringify({ id: 'wh-1', type: 'booking.confirmed', entity_type: 'booking', entity_id: 'bk-7', created_at: new Date().toISOString(),
      data: { booking: { id: 'bk-7', playing_area_id: 'pa-1', external_playing_area_id: f.area.id, start: ist(day, '20:00'), end: ist(day, '21:00'), status: 'CONFIRMED', channel: 'phone', is_yours: false } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v1=' + crypto.createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex');
    await request(env.app).post('/api/webhooks/jusgo').set({ 'Content-Type': 'application/json', 'X-JusGo-Timestamp': ts, 'X-JusGo-Signature': sig }).send(body).expect(200);
    expect(at(await slotsOf(f, day), day, '20:00')).toMatchObject({ available: false, reason: 'blocked' });
  });

  it('the minute check closes a slot that is busy on JusGo even when its change never arrived, and opens it when it is free again', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const day = dayAhead(8);
    env.jusgo.catalog.venues = [{ id: 'v-9', externalId: f.venue.id, name: 'Green Arena', playingAreas: [{ id: 'pa-9', externalId: f.area.id, name: 'Turf A' }, { id: 'pa-x', externalId: null, name: 'Unpaired' }] }];
    env.jusgo.busy.set('pa-9', [{ start: ist(day, '18:00'), end: ist(day, '19:00') }]);
    expect(await reconcileJusgoAvailability(env.ctx)).toBe(1);
    expect(await reconcileJusgoAvailability(env.ctx)).toBe(0); // nothing new the second time
    expect(at(await slotsOf(f, day), day, '18:00')).toMatchObject({ available: false, reason: 'blocked' });
    env.jusgo.busy.set('pa-9', []);
    await reconcileJusgoAvailability(env.ctx);
    expect(at(await slotsOf(f, day), day, '18:00').available).toBe(true);
    env.jusgo.catalog.venues = [];
  });

  it('a playing area or venue renamed on JusGo is renamed on PlaynX, by its change and by the minute check', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin);
    const name = async () => (await env.db.query('SELECT a.name AS area, v.name AS venue, a.is_active FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE a.id=$1', [f.area.id])).rows[0];
    env.jusgo.pending.push({ ...change('playing_area.updated', f, null), entityType: 'playing_area', changedFields: ['name'], newValues: { name: 'Main Turf' } });
    env.jusgo.pending.push({ ...change('venue.updated', f, null), entityType: 'venue', externalVenueId: f.venue.id, changedFields: ['venue_name'], newValues: { venue_name: 'Green Field Arena' } });
    await pollJusgoChanges(env.ctx);
    expect(await name()).toMatchObject({ area: 'Main Turf', venue: 'Green Field Arena', is_active: true });
    // a change that never arrived: the minute check reads the names from JusGo
    env.jusgo.catalog.venues = [{ id: 'v-7', externalId: f.venue.id, name: 'Green Field Sports', playingAreas: [{ id: 'pa-7', externalId: f.area.id, name: 'Turf One' }] }];
    await reconcileJusgoAvailability(env.ctx);
    expect(await name()).toMatchObject({ area: 'Turf One', venue: 'Green Field Sports' });
    env.jusgo.catalog.venues = [];
  });

  it('every detail changed on JusGo lands on PlaynX: venue address, court settings, sports, hours, special days and prices', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin);
    const ch = (type: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...change(type, f, null), entityType: type.split('.')[0], externalVenueId: f.venue.id, changedFields: Object.keys(fields), newValues: fields, ...extra });
    env.jusgo.pending.push(ch('venue.updated', { city: 'Coimbatore', postal_code: '641001', description: 'Floodlit' }));
    env.jusgo.pending.push(ch('playing_area.updated', { capacity: 10, ground_type: 'OPEN_GROUND', turf_shape: 'ROUND', sport_types: ['cricket'],
      slot_configuration: { duration_in_minutes: 60, min_duration_minutes: 60, max_duration_minutes: 120, advance_booking_limit_hours: 240, instant_booking: false },
      operating_hours: [{ day_of_week: 1, open_time: '07:00:00', close_time: '22:00:00' }], hour_exceptions: [{ date: '2030-01-26', closed: true, open_time: null, close_time: null, reason: 'Republic Day' }] }));
    env.jusgo.catalog.venues = [{ id: 'v-8', externalId: f.venue.id, name: 'Green Arena', playingAreas: [{ id: 'pa-8', externalId: f.area.id, name: 'Turf A', pricing: { pricePerHour: 1200, separatePrice: false, rules: [{ days: [5, 6], start: '18:00', end: '22:00', pricePerHour: 1500 }] } }] }];
    env.jusgo.pending.push(ch('pricing.updated', { price_per_hour: 1200 }, { playingAreaId: 'pa-8' }));
    await pollJusgoChanges(env.ctx);
    const v = (await env.db.query('SELECT city, pincode, description FROM venues WHERE id=$1', [f.venue.id])).rows[0];
    expect(v).toEqual({ city: 'Coimbatore', pincode: '641001', description: 'Floodlit' });
    const a = (await env.db.query('SELECT capacity, environment, turf_shape, max_duration_minutes, advance_booking_days, instant_booking FROM playing_areas WHERE id=$1', [f.area.id])).rows[0];
    expect(a).toEqual({ capacity: 10, environment: 'outdoor', turf_shape: 'round', max_duration_minutes: 120, advance_booking_days: 10, instant_booking: false });
    expect((await env.db.query('SELECT s.slug FROM playing_area_sports x JOIN sports s ON s.id=x.sport_id WHERE x.playing_area_id=$1', [f.area.id])).rows).toEqual([{ slug: 'cricket' }]);
    const hours = (await env.db.query(`SELECT day_of_week AS d, to_char(open_time,'HH24:MI') AS o, to_char(close_time,'HH24:MI') AS c, is_closed FROM playing_area_hours WHERE playing_area_id=$1 ORDER BY day_of_week`, [f.area.id])).rows;
    expect(hours.find((h: any) => h.d === 1)).toEqual({ d: 1, o: '07:00', c: '22:00', is_closed: false }); expect(hours.find((h: any) => h.d === 0).is_closed).toBe(true);
    expect((await env.db.query('SELECT closed, reason FROM playing_area_hour_exceptions WHERE playing_area_id=$1', [f.area.id])).rows).toEqual([{ closed: true, reason: 'Republic Day' }]);
    const prices = (await env.db.query('SELECT day_of_week, price_per_hour::float8 AS p FROM pricing_rules WHERE area_id=$1 ORDER BY p, day_of_week NULLS FIRST', [f.area.id])).rows;
    expect(prices).toEqual([{ day_of_week: null, p: 1200 }, { day_of_week: 5, p: 1500 }, { day_of_week: 6, p: 1500 }]);
    env.jusgo.catalog.venues = [];
  });

  it('a playing area added on JusGo appears on PlaynX in the same venue, once, and its bookings close its slots', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const day = dayAhead(9);
    env.jusgo.catalog.venues = [{ id: 'v-n', externalId: f.venue.id, name: 'Green Arena', playingAreas: [
      { id: 'pa-old', externalId: f.area.id, name: 'Turf A' },
      { id: 'pa-new', externalId: null, name: 'Court 2', sportTypes: ['football'], status: 'ACTIVE', pricing: { pricePerHour: 900, separatePrice: false, rules: [] } }] }];
    await reconcileJusgoAvailability(env.ctx); await reconcileJusgoAvailability(env.ctx); // twice: still one new area
    const made = (await env.db.query(`SELECT a.id, a.is_active, a.approval_status FROM playing_areas a WHERE a.venue_id=$1 AND a.name='Court 2'`, [f.venue.id])).rows;
    expect(made).toEqual([{ id: expect.any(String), is_active: true, approval_status: 'approved' }]);
    expect((await env.db.query('SELECT price_per_hour::float8 AS p FROM pricing_rules WHERE area_id=$1', [made[0].id])).rows).toEqual([{ p: 900 }]);
    // it is offered in the PlaynX venues feed, so JusGo can pair it; a booking on it closes the slot even before that
    env.jusgo.pending.push({ ...change('booking.confirmed', f, { id: 'bk-n', playing_area_id: 'pa-new', start: ist(day, '18:00'), end: ist(day, '19:00'), status: 'CONFIRMED', is_yours: false }), playingAreaId: 'pa-new', externalPlayingAreaId: null });
    await pollJusgoChanges(env.ctx);
    const slots = (await request(env.app).get(`/api/areas/${made[0].id}/slots`).query({ date: day, sportId: f.football.id })).body.slots as any[];
    expect(at(slots, day, '18:00')).toMatchObject({ available: false, reason: 'blocked' });
    env.jusgo.catalog.venues = [];
  });
});
