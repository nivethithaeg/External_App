import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MP4, approveOwner, createAdmin, registerUser, setup, type TestEnv } from './helpers.js';
import { coordsFromMapUrl, coordsFromShortLink } from '../src/lib/mapLink.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); });
const owner = async () => { const o = await registerUser(env, 'owner'); await approveOwner(env, admin, o); return o; };
const video = (o: any, venueId: string, lat: number, lng: number, accuracy = 20, file = MP4, ct = 'video/mp4') =>
  request(env.app).post(`/api/owner/venues/${venueId}/media/geo-video`).set(o.auth).field('lat', String(lat)).field('lng', String(lng)).field('accuracy', String(accuracy)).attach('file', file, { filename: 'tour.mp4', contentType: ct });

describe('geo-tagged video recorded at the venue', () => {
  it('is kept with where it was shot; far away, inaccurate or not a video is refused', async () => {
    const o = await owner();
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ name: 'Green Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038', lat: 12.9716, lng: 77.5946 }).expect(201)).body.venue;
    await video(o, v.id, 13.5, 77.5946).expect(400); // far from the venue's location
    await video(o, v.id, 12.9716, 77.5946, 5000).expect(400); // the phone's location is too rough
    await video(o, v.id, 12.9716, 77.5946, 20, Buffer.from('%PDF-1.4 not a video padded padded'), 'application/pdf').expect(400);
    const ok = (await video(o, v.id, 12.9717, 77.5947).expect(201)).body;
    expect(ok.located).toBe(false); expect(ok.distanceM).toBeLessThan(50);
    const row = (await env.db.query(`SELECT kind, geo_lat, geo_distance_m FROM venue_images WHERE venue_id=$1 AND kind='video'`, [v.id])).rows;
    expect(row).toHaveLength(1); expect(row[0].geo_lat).toBeCloseTo(12.9717, 4);
  });

  it('a venue created without a location (no map pin) is placed by its first geo-tagged video', async () => {
    const o = await owner();
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ name: 'No Pin Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038' }).expect(201)).body.venue;
    expect(v.lat).toBeNull();
    const r = (await video(o, v.id, 12.98, 77.6).expect(201)).body; expect(r.located).toBe(true);
    const after = (await env.db.query('SELECT lat, lng FROM venues WHERE id=$1', [v.id])).rows[0];
    expect([after.lat, after.lng]).toEqual([12.98, 77.6]);
    await video(o, v.id, 13.9, 77.6).expect(400); // from now on it is compared with that location
  });

  it('the venue cannot be sent for approval without it', async () => {
    const o = await owner();
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ name: 'Video Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038', lat: 12.97, lng: 77.59 }).expect(201)).body.venue;
    const msg = (await request(env.app).post(`/api/owner/venues/${v.id}/submit`).set(o.auth).expect(400)).body.error.details.missing as string[];
    expect(msg).toContain('a geo-tagged video recorded at the venue');
  });
});

describe('Google Maps link', () => {
  it('reads the coordinates written in a link', () => {
    expect(coordsFromMapUrl('https://www.google.com/maps/place/X/@12.9716,77.5946,17z')).toEqual({ lat: 12.9716, lng: 77.5946 });
    expect(coordsFromMapUrl('https://www.google.com/maps?q=13.0827,80.2707')).toEqual({ lat: 13.0827, lng: 80.2707 });
    expect(coordsFromMapUrl('https://www.google.com/maps/place/X/data=!3d11.34!4d77.72')).toEqual({ lat: 11.34, lng: 77.72 });
    expect(coordsFromMapUrl('https://maps.app.goo.gl/abc123')).toBeNull();
  });
  it('follows a short link to Google only, a few hops, and reads the coordinates there', async () => {
    const hops: string[] = [];
    const fake = async (url: string) => { hops.push(url); return url.startsWith('https://maps.app.goo.gl/') ? { status: 302, headers: { get: () => 'https://www.google.com/maps/place/Turf/@11.34,77.72,17z' } } : { status: 200, headers: { get: () => null } }; };
    expect(await coordsFromShortLink('https://maps.app.goo.gl/xyz', fake as any)).toMatchObject({ lat: 11.34, lng: 77.72 });
    const evil = async (url: string) => { hops.push(url); return { status: 302, headers: { get: () => 'https://evil.example.com/steal' } }; };
    hops.length = 0; expect(await coordsFromShortLink('https://maps.app.goo.gl/xyz', evil as any)).toBeNull(); expect(hops).toEqual(['https://maps.app.goo.gl/xyz']); // never fetched the other host
  });
  it('the resolve endpoint takes Google links only', async () => {
    const o = await owner();
    await request(env.app).get('/api/owner/maps/resolve').query({ url: 'https://evil.example.com/maps' }).set(o.auth).expect(400);
    const r = (await request(env.app).get('/api/owner/maps/resolve').query({ url: 'https://www.google.com/maps/place/X/@12.9716,77.5946,17z' }).set(o.auth).expect(200)).body;
    expect(r).toEqual({ found: true, lat: 12.9716, lng: 77.5946 });
  });
});
