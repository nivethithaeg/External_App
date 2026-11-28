import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, ist, setup, type TestEnv } from './helpers.js';
import { walkIn } from './walkin.js';

const dayAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pause = () => new Promise((r) => setTimeout(r, 20));
let env: TestEnv;
beforeAll(async () => { env = await setup(); });

async function ownerWithKey() {
  const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin);
  const key = (await request(env.app).post('/api/owner/sync-key').set(f.owner.auth).expect(201)).body.key as string;
  return { f, admin, key, as: { Authorization: `Bearer ${key}` } };
}
const feed = (auth?: Record<string, string>, query: Record<string, string> = {}) => { const r = request(env.app).get('/api/playnx/bookings').query(query); return auth ? r.set(auth) : r; };

describe('JusGo booking feed and venues (Partner API "Booking feed" and "Your own ids")', () => {
  it('venues come in JusGo\'s catalog shape: id, name, city, postalCode and playingAreas with sportTypes', async () => {
    const { f, as } = await ownerWithKey();
    const v = (await request(env.app).get('/api/playnx/venues').set(as).expect(200)).body.venues;
    expect(v).toEqual([expect.objectContaining({ id: f.venue.id, name: 'Green Arena', city: 'Bengaluru', postalCode: '560038', timezone: 'Asia/Kolkata' })]);
    expect(v[0].playingAreas).toEqual([expect.objectContaining({ id: f.area.id, name: 'Turf A', slotMinutes: 60, isActive: true, sportTypes: expect.arrayContaining(['Football', 'Cricket']) })]);
  });

  it('the feed lists bookings as { bookings, hasMore } with id, playingAreaId, venueId, start, end, status and updatedAt', async () => {
    const { f, as } = await ownerWithKey();
    const day = dayAhead(3);
    const bk = (await walkIn(env, f.owner.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(day, '10:00'), durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210' }).expect(201)).body;
    const body = (await feed(as).expect(200)).body;
    expect(body.hasMore).toBe(false);
    expect(body.bookings.find((x: any) => x.id === bk.bookingId)).toEqual({
      id: bk.bookingId, playingAreaId: f.area.id, venueId: f.venue.id, start: new Date(ist(day, '10:00')).toISOString(), end: new Date(ist(day, '11:00')).toISOString(),
      status: 'CONFIRMED', updatedAt: expect.any(String), customerName: 'Ravi Kumar', customerMobile: '+919876543210', totalPrice: 800, currency: 'INR',
    });
  });

  it('plain blocked times are not sent; a paid venue event is, as a confirmed booking', async () => {
    const { f, as } = await ownerWithKey();
    const day = dayAhead(4);
    const block = (await request(env.app).post(`/api/owner/areas/${f.area.id}/blocks`).set(f.owner.auth).send({ startsAt: ist(day, '12:00'), endsAt: ist(day, '13:00'), reason: 'Maintenance' }).expect(201)).body.block;
    await request(env.app).post('/api/owner/blocks/bulk').set(f.owner.auth).send({ areaIds: [f.area.id], startsAt: ist(day, '15:00'), endsAt: ist(day, '16:00'), reason: 'Cup final', customerName: 'Erode FC', customerPhone: '9876500011', amount: 2000, paymentMethod: 'cash' }).expect(201);
    const list = (await feed(as).expect(200)).body.bookings;
    expect(list.some((x: any) => x.id === block.id)).toBe(false);
    expect(list).toEqual([expect.objectContaining({ status: 'CONFIRMED', start: new Date(ist(day, '15:00')).toISOString(), customerName: 'Erode FC' })]);
  });

  it('?since gives only what changed from then on; a cancellation comes back as CANCELLED', async () => {
    const { f, as } = await ownerWithKey();
    const bk = (await walkIn(env, f.owner.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(dayAhead(5), '10:00'), durationMinutes: 60, customerName: 'Ravi', customerPhone: '9876543210' }).expect(201)).body;
    const first = (await feed(as).expect(200)).body.bookings;
    const since = first[first.length - 1].updatedAt;
    await pause();
    await env.db.query(`UPDATE bookings SET status='cancelled', cancelled_at=now() WHERE id=$1`, [bk.bookingId]);
    const later = (await feed(as, { since }).expect(200)).body.bookings;
    expect(later.find((x: any) => x.id === bk.bookingId)).toMatchObject({ status: 'CANCELLED' });
    expect(later[later.length - 1].updatedAt > since).toBe(true);
  });

  it('without a key: every published venue and its bookings, but no customer details; a wrong key is refused', async () => {
    const { f } = await ownerWithKey();
    await walkIn(env, f.owner.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(dayAhead(2), '10:00'), durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210' }).expect(201);
    const draft = (await request(env.app).post('/api/owner/venues').set(f.owner.auth).send({ name: 'Hidden Draft Arena', address: '1 Lake Road, Erode', city: 'Erode', pincode: '638001', lat: 11.34, lng: 77.71 }).expect(201)).body.venue;
    const v = (await request(env.app).get('/api/playnx/venues').expect(200)).body.venues;
    expect(v.some((x: any) => x.id === f.venue.id)).toBe(true); expect(v.some((x: any) => x.id === draft.id)).toBe(false);
    const list = (await feed().expect(200)).body.bookings;
    expect(list.some((x: any) => x.venueId === f.venue.id)).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/Ravi|9876543210|customerName/);
    await feed({ Authorization: 'Bearer pnx_wrong' }).expect(401);
  });

  it('with a key, only that owner\'s bookings; a new key stops the old one', async () => {
    const a = await ownerWithKey(); const b = await ownerWithKey();
    await walkIn(env, b.f.owner.auth).send({ areaId: b.f.area.id, sportId: b.f.football.id, startsAt: ist(dayAhead(6), '10:00'), durationMinutes: 60, customerName: 'Other', customerPhone: '9876500000' }).expect(201);
    expect((await feed(a.as).expect(200)).body.bookings.every((x: any) => x.venueId === a.f.venue.id)).toBe(true);
    const shown = (await request(env.app).get('/api/owner/sync-key').set(a.f.owner.auth).expect(200)).body.key;
    expect(shown.prefix).toBe(a.key.slice(0, 10)); expect(shown.lastUsedAt).toBeTruthy();
    await request(env.app).post('/api/owner/sync-key').set(a.f.owner.auth).expect(201);
    await feed(a.as).expect(401);
  });
});
