import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { distanceMeters } from '../src/lib/geo.js';
import { MP4, approveOwner, createAdmin, registerUser, setup, type TestEnv } from './helpers.js';

const HERE = { lat: 12.9716, lng: 77.5946 };
const jpeg = (n = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, n)]); // a different byte pattern per photo
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe('distance', () => {
  it('measures metres', () => {
    expect(distanceMeters(HERE, HERE)).toBeCloseTo(0, 0);
    expect(distanceMeters({ lat: 12, lng: 77 }, { lat: 13, lng: 77 })).toBeGreaterThan(110000);
  });
});

let env: TestEnv; let strict: TestEnv;
beforeAll(async () => { env = await setup(); strict = await setup({ REQUIRE_LIVE_AREA_PHOTOS: 'true', REQUIRE_AREA_GEOTAG: 'true' }); });

async function draft(e: TestEnv = strict) {
  const admin = await createAdmin(e); const o = await registerUser(e, 'owner'); await approveOwner(e, admin, o);
  const v = (await request(e.app).post('/api/owner/venues').set(o.auth).send({ name: 'Live Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038', ...HERE }).expect(201)).body.venue;
  const sport = (await request(e.app).get('/api/sports')).body.sports[0];
  const area = (await request(e.app).post(`/api/owner/venues/${v.id}/areas`).set(o.auth).send({ name: 'Turf A', sportIds: [sport.id] }).expect(201)).body.area;
  return { o, v, area };
}
const check = (o: any, venueId: string, file: Buffer, f: Record<string, string | number> = { lat: HERE.lat, lng: HERE.lng, accuracy: 12 }, e: TestEnv = strict) => {
  const r = request(e.app).post(`/api/owner/venues/${venueId}/media/live-check`).set(o.auth); for (const [k, v] of Object.entries(f)) r.field(k, String(v));
  return r.attach('file', file, { filename: 'p.jpg', contentType: file[0] === 0x89 ? 'image/png' : 'image/jpeg' });
};
const save = (o: any, venueId: string, areaId: string, file: Buffer, proof?: string, e: TestEnv = strict) => {
  const r = request(e.app).post(`/api/owner/venues/${venueId}/media`).set(o.auth).field('areaId', areaId); if (proof) r.field('proof', proof);
  return r.attach('file', file, { filename: 'p.jpg', contentType: 'image/jpeg' });
};

describe('live location check', () => {
  it('accepts a photo with a live location at the turf, and returns a proof', async () => {
    const { o, v } = await draft();
    const r = await check(o, v.id, jpeg(), { lat: 12.9717, lng: 77.5947, accuracy: 8 }).expect(200);
    expect(r.body).toMatchObject({ ok: true, maxMeters: 500, accuracyM: 8 }); expect(r.body.distanceM).toBeLessThan(40); expect(typeof r.body.proof).toBe('string');
  });
  it('refuses a location far from the venue, and says how far', async () => {
    const { o, v } = await draft();
    const r = await check(o, v.id, jpeg(), { lat: 13.0827, lng: 80.2707, accuracy: 10 }).expect(400); // Chennai
    expect(r.body.error.code).toBe('geotag_far'); expect(r.body.error.details.distanceM).toBeGreaterThan(200000); expect(r.body.error.message).toMatch(/km from the location pinned/);
    expect((await check(o, v.id, jpeg(), { lat: 12.977, lng: 77.5946, accuracy: 10 }).expect(400)).body.error.message).toMatch(/about \d+ m from/); // ~600 m
  });
  it('refuses a weak location fix (a laptop on Wi-Fi) and a missing or fake one', async () => {
    const { o, v } = await draft();
    const weak = await check(o, v.id, jpeg(), { ...HERE, accuracy: 900 }).expect(400);
    expect(weak.body.error.code).toBe('location_inaccurate'); expect(weak.body.error.message).toMatch(/accurate to about 900 m/);
    await check(o, v.id, jpeg(), { lat: 0, lng: 0, accuracy: 5 }).expect(400);
    await check(o, v.id, jpeg(), {}).expect(400); // no location sent at all
    await check(o, v.id, jpeg(), { lat: 999, lng: 77, accuracy: 5 }).expect(400);
  });
  it('only the venue\'s owner can check, and the file must really be an image', async () => {
    const { o, v } = await draft(); const other = await registerUser(strict, 'owner'); const c = await registerUser(strict, 'customer');
    await check(other, v.id, jpeg()).expect(403); await check(c, v.id, jpeg()).expect(403);
    await check(o, v.id, Buffer.from('<script>alert(1)</script> padding padding padding')).expect(400);
  });
});

describe('saving a live photo', () => {
  it('stores the live location from the proof against the area, and nothing the form says', async () => {
    const { o, v, area } = await draft(); const photo = jpeg(2);
    const proof = (await check(o, v.id, photo, { lat: 12.9717, lng: 77.5947, accuracy: 8 }).expect(200)).body.proof;
    const r = await save(o, v.id, area.id, photo, proof).field('lat', '1').field('lng', '1').expect(201); // extra fields are ignored: only the proof counts
    expect(r.body.media).toMatchObject({ area_id: area.id, is_cover: false }); expect(r.body.media.geo_lat).toBeCloseTo(12.9717, 3); expect(r.body.media.geo_distance_m).toBeLessThan(40);
  });
  it('has no upload option: a photo without a proof is refused', async () => {
    const { o, v, area } = await draft();
    const r = await save(o, v.id, area.id, jpeg(3)).expect(400);
    expect(r.body.error.code).toBe('live_capture_required'); expect(r.body.error.message).toMatch(/cannot be uploaded from your files or gallery/);
    expect((await save(o, v.id, area.id, jpeg(3), 'not-a-real-proof').expect(400)).body.error.code).toBe('live_proof_expired');
    expect((await env.db.query('SELECT 1 FROM venue_images WHERE venue_id=$1', [v.id])).rows).toHaveLength(0);
  });
  it('a proof only works for the exact photo it was issued for', async () => {
    const { o, v, area } = await draft();
    const proof = (await check(o, v.id, jpeg(4)).expect(200)).body.proof;
    expect((await save(o, v.id, area.id, jpeg(5), proof).expect(400)).body.error.code).toBe('live_capture_required'); // a different photo swapped in
    await save(o, v.id, area.id, jpeg(4), proof).expect(201);
  });
  it('a proof cannot be used by someone else or on another venue', async () => {
    const { o, v, area } = await draft(); const b = await draft();
    const proof = (await check(o, v.id, jpeg(6)).expect(200)).body.proof;
    await save(b.o, b.v.id, b.area.id, jpeg(6), proof).expect(400); // another owner's venue, same photo bytes
    const other = await registerUser(strict, 'owner');
    await save(other, v.id, area.id, jpeg(6), proof).expect(403); // not their venue at all
  });
  it('a proof expires', async () => {
    const { o, v, area } = await draft(); const photo = jpeg(7);
    const proof = (await check(o, v.id, photo).expect(200)).body.proof;
    const [h, p, sig] = proof.split('.'); const claims = JSON.parse(Buffer.from(p, 'base64url').toString()); claims.exp = Math.floor(Date.now() / 1000) - 10;
    const forged = `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`; // edited claims no longer match the signature
    expect((await save(o, v.id, area.id, photo, forged).expect(400)).body.error.code).toBe('live_proof_expired');
  });
  it('applies to every playing area photo, but not to the venue\'s own gallery photos', async () => {
    const { o, v } = await draft();
    await request(strict.app).post(`/api/owner/venues/${v.id}/media`).set(o.auth).attach('file', PNG, { filename: 'v.png', contentType: 'image/png' }).expect(201);
  });
  it('is switched off in the plain test setup, so older flows keep working', async () => {
    const { o, v, area } = await draft(env);
    await save(o, v.id, area.id, PNG, undefined, env).expect(201);
  });
});

describe('a venue cannot be sent for approval until every playing area has a live photo with a location', () => {
  it('names the missing photo, then lets the venue through once it is added', async () => {
    const { o, v, area } = await draft();
    await request(strict.app).post(`/api/owner/venues/${v.id}/media`).set(o.auth).attach('file', PNG, { filename: 'v.png', contentType: 'image/png' }).expect(201);
    await request(strict.app).post(`/api/owner/venues/${v.id}/documents`).set(o.auth).field('docType', 'Electricity bill').attach('file', PNG, { filename: 'bill.png', contentType: 'image/png' }).expect(201);
    await request(strict.app).post(`/api/owner/venues/${v.id}/documents`).set(o.auth).field('docType', 'Land proof').attach('file', PNG, { filename: 'land.png', contentType: 'image/png' }).expect(201);
    await request(strict.app).post(`/api/owner/venues/${v.id}/media/geo-video`).set(o.auth).field('lat', '12.9716').field('lng', '77.5946').field('accuracy', '20').attach('file', MP4, { filename: 'tour.mp4', contentType: 'video/mp4' }).expect(201);
    expect((await request(strict.app).post(`/api/owner/venues/${v.id}/send-for-approval`).set(o.auth).expect(400)).body.error.message).toMatch(/geo-tagged photo for a playing area/);
    const photo = jpeg(8); const proof = (await check(o, v.id, photo).expect(200)).body.proof;
    await save(o, v.id, area.id, photo, proof).expect(201);
    await request(strict.app).post(`/api/owner/venues/${v.id}/send-for-approval`).set(o.auth).expect(200);
  });
});

describe('the address of where the photo was taken', () => {
  const GEO = 'https://geo.test/reverse';
  const stubGeocoder = (reply: () => Promise<Response> | Response) => { const calls: string[] = []; const real = globalThis.fetch; globalThis.fetch = (async (url: any, init?: any) => { if (String(url).startsWith(GEO)) { calls.push(String(url)); return reply(); } return real(url, init); }) as any; return { calls, restore: () => { globalThis.fetch = real; } }; };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('returns the latitude, longitude and street address, and stores them with the photo', async () => {
    const g = stubGeocoder(() => json({ display_name: '12, Park Road, Indiranagar, Bengaluru, Karnataka, 560038, India' }));
    try {
      const e = await setup({ REQUIRE_LIVE_AREA_PHOTOS: 'true', GEOCODE_URL: GEO }); const { o, v, area } = await draft(e); const photo = jpeg(11);
      const r = await check(o, v.id, photo, { lat: 12.9717, lng: 77.5947, accuracy: 8 }, e).expect(200);
      expect(r.body).toMatchObject({ lat: 12.9717, lng: 77.5947, address: '12, Park Road, Indiranagar, Bengaluru, Karnataka, 560038, India' });
      expect(g.calls[0]).toContain('lat=12.9717'); expect(g.calls[0]).toContain('lon=77.5947'); // only the position is sent out
      const saved = await save(o, v.id, area.id, photo, r.body.proof, e).expect(201);
      expect(saved.body.media).toMatchObject({ geo_address: r.body.address }); expect(saved.body.media.geo_lat).toBeCloseTo(12.9717, 4);
      const detail = (await request(e.app).get(`/api/owner/venues/${v.id}`).set(o.auth).expect(200)).body.venue;
      expect(detail.images.find((i: any) => i.id === saved.body.media.id).geo_address).toBe(r.body.address);
    } finally { g.restore(); }
  });
  it('the address comes from the signed proof: an address sent with the photo is ignored', async () => {
    const g = stubGeocoder(() => json({ display_name: 'Real Road, Bengaluru' }));
    try {
      const e = await setup({ REQUIRE_LIVE_AREA_PHOTOS: 'true', GEOCODE_URL: GEO }); const { o, v, area } = await draft(e); const photo = jpeg(12);
      const r = await check(o, v.id, photo, undefined, e).expect(200);
      const saved = await save(o, v.id, area.id, photo, r.body.proof, e).field('address', 'Somewhere I made up').field('geo_address', 'Somewhere I made up').expect(201);
      expect(saved.body.media.geo_address).toBe('Real Road, Bengaluru');
    } finally { g.restore(); }
  });
  it('a failed or empty lookup never blocks the photo: the address is just empty', async () => {
    for (const reply of [() => json({}, 500), () => { throw new Error('network down'); }, () => json({ error: 'Unable to geocode' })] as const) {
      const g = stubGeocoder(reply as any);
      try {
        const e = await setup({ REQUIRE_LIVE_AREA_PHOTOS: 'true', GEOCODE_URL: GEO }); const { o, v, area } = await draft(e); const photo = jpeg(13);
        const r = await check(o, v.id, photo, undefined, e).expect(200); expect(r.body.address).toBeNull();
        expect((await save(o, v.id, area.id, photo, r.body.proof, e).expect(201)).body.media.geo_address).toBeNull();
      } finally { g.restore(); }
    }
  });
  it('is not called at all when lookups are turned off, or when the photo is refused', async () => {
    const g = stubGeocoder(() => json({ display_name: 'x' }));
    try {
      const off = await setup({ REQUIRE_LIVE_AREA_PHOTOS: 'true', GEOCODE_URL: '' }); const a = await draft(off);
      expect((await check(a.o, a.v.id, jpeg(14), undefined, off).expect(200)).body.address).toBeNull();
      const on = await setup({ REQUIRE_LIVE_AREA_PHOTOS: 'true', GEOCODE_URL: GEO }); const b = await draft(on);
      await check(b.o, b.v.id, jpeg(15), { lat: 13.0827, lng: 80.2707, accuracy: 10 }, on).expect(400); // far away: refused before any lookup
      expect(g.calls).toHaveLength(0);
    } finally { g.restore(); }
  });
});
