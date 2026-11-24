import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

const upload = (areaId?: string, who = fx.owner, venueId = fx.venue.id, file: Buffer = PNG, type = 'image/png') => {
  const r = request(env.app).post(`/api/owner/venues/${venueId}/media`).set(who.auth);
  if (areaId) r.field('areaId', areaId);
  return r.attach('file', file, { filename: type === 'video/mp4' ? 'a.mp4' : 'a.png', contentType: type });
};
const ownerVenue = async () => (await request(env.app).get(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).expect(200)).body.venue;

describe('playing area photos', () => {
  it('stores a photo against the area and never makes it the cover; the first venue photo still does', async () => {
    const o = await registerUser(env, 'owner'); await approveOwner(env, admin, o);
    const draft = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ name: 'Draft Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038', lat: 12.97, lng: 77.59 }).expect(201)).body.venue;
    const sport = (await request(env.app).get('/api/sports')).body.sports[0];
    const area = (await request(env.app).post(`/api/owner/venues/${draft.id}/areas`).set(o.auth).send({ name: 'Turf A', sportIds: [sport.id] }).expect(201)).body.area;
    const a = await upload(area.id, o, draft.id).expect(201);
    expect(a.body.media).toMatchObject({ area_id: area.id, is_cover: false, kind: 'image' });
    const v = await upload(undefined, o, draft.id).expect(201); // uploaded after the area photo, yet it becomes the cover
    expect(v.body.media).toMatchObject({ area_id: null, is_cover: true });
    const detail = (await request(env.app).get(`/api/owner/venues/${draft.id}`).set(o.auth).expect(200)).body.venue;
    expect(detail.images.find((i: any) => i.id === a.body.media.id).area_id).toBe(area.id);
  });

  it('on a live venue a new area photo needs no approval: customers see it under that area only, and removing it is immediate', async () => {
    const o = await registerUser(env, 'owner'); const f = await createApprovedVenue(env, admin, o);
    const up = await request(env.app).post(`/api/owner/venues/${f.venue.id}/media`).set(o.auth).field('areaId', f.area.id).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    expect(up.body.media.is_pending).toBe(false);
    const seen = async () => (await request(env.app).get(`/api/venues/${f.venue.id}`).expect(200)).body.venue;
    const pub = await seen(); const area = pub.areas.find((x: any) => x.id === f.area.id);
    expect(area.images).toHaveLength(1); // public at once
    expect(pub.images.some((i: any) => i.url === area.images[0].url)).toBe(false); // not in the venue gallery
    const list = (await request(env.app).get('/api/venues').expect(200)).body.venues.find((x: any) => x.id === f.venue.id);
    expect(list.cover_image).not.toBe(area.images[0].url); // and not the cover on the listing
    expect((await request(env.app).get('/api/admin/listing-changes').set(admin.auth)).body.changes.some((c: any) => c.venueId === f.venue.id)).toBe(false); // nothing for an admin to review
    await request(env.app).delete(`/api/owner/media/${up.body.media.id}`).set(o.auth).expect(204);
    expect((await seen()).areas.find((x: any) => x.id === f.area.id).images).toHaveLength(0); // gone at once
  });

  it('accepts images only, at most 10 per area, and only for the owner\'s own area', async () => {
    const o = await registerUser(env, 'owner'); const f = await createApprovedVenue(env, admin, o);
    await request(env.app).post(`/api/owner/venues/${f.venue.id}/media`).set(o.auth).field('areaId', f.area.id).attach('file', Buffer.concat([Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), Buffer.alloc(64)]), { filename: 'a.mp4', contentType: 'video/mp4' }).expect(400); // no videos on an area
    for (let i = 0; i < 10; i++) await request(env.app).post(`/api/owner/venues/${f.venue.id}/media`).set(o.auth).field('areaId', f.area.id).attach('file', PNG, { filename: `p${i}.png`, contentType: 'image/png' }).expect(201);
    const eleventh = await request(env.app).post(`/api/owner/venues/${f.venue.id}/media`).set(o.auth).field('areaId', f.area.id).attach('file', PNG, { filename: 'p10.png', contentType: 'image/png' }).expect(400);
    expect(eleventh.body.error.code).toBe('too_many_files');
    // another owner's area, or an area of a different venue, is refused
    const other = await registerUser(env, 'owner'); const g = await createApprovedVenue(env, admin, other);
    await request(env.app).post(`/api/owner/venues/${g.venue.id}/media`).set(other.auth).field('areaId', f.area.id).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(404);
    await request(env.app).post(`/api/owner/venues/${f.venue.id}/media`).set(other.auth).field('areaId', g.area.id).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(403);
  });

  it('an area photo cannot be made the venue cover, but can be removed', async () => {
    const a = await upload(fx.area.id).expect(201);
    const c = await request(env.app).put(`/api/owner/media/${a.body.media.id}/cover`).set(fx.owner.auth).expect(400);
    expect(c.body.error.message).toMatch(/cannot be the venue cover/);
    await request(env.app).delete(`/api/owner/media/${a.body.media.id}`).set(fx.owner.auth).expect(204);
    expect((await ownerVenue()).images.some((i: any) => i.id === a.body.media.id)).toBe(false);
  });

  it('deleting the playing area removes its photos, and area photos do not count as the venue\'s required photo', async () => {
    const o = await registerUser(env, 'owner'); const f = await createApprovedVenue(env, admin, o);
    const extra = (await request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(o.auth).send({ name: 'Turf B', sportIds: [f.football.id] }).expect(201)).body.area;
    const p = await request(env.app).post(`/api/owner/venues/${f.venue.id}/media`).set(o.auth).field('areaId', extra.id).attach('file', PNG, { filename: 'b.png', contentType: 'image/png' }).expect(201);
    await env.db.query('DELETE FROM playing_areas WHERE id=$1', [extra.id]);
    expect((await env.db.query('SELECT 1 FROM venue_images WHERE id=$1', [p.body.media.id])).rows).toHaveLength(0);
  });
});
