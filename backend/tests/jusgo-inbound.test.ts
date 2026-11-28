import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, ist, setup, type TestEnv } from './helpers.js';
import { pollJusgoChanges } from '../src/lib/jusgoBookings.js';

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
});
