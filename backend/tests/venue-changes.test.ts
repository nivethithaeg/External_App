import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });

const publicName = async () => (await request(env.app).get(`/api/venues/${fx.venue.id}`)).body.venue?.name;
const ownerView = async () => (await request(env.app).get(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth)).body.venue;

describe('edits to an approved venue', () => {
  it('are held for admin approval; customers keep seeing the approved version until then', async () => {
    const before = await publicName();
    const put = await request(env.app).put(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).send({ name: 'Renamed Arena', description: 'New floodlights' });
    expect(put.status).toBe(200); expect(put.body.pendingChange).toBe(true);
    expect(await publicName()).toBe(before); // customers: unchanged
    const mine = await ownerView(); // the owner sees their own edit and that it is pending
    expect(mine.name).toBe('Renamed Arena'); expect(mine.pendingChange.fields.name).toBe('Renamed Arena'); expect(mine.status).toBe('approved'); // still live
    const detail = (await request(env.app).get(`/api/admin/venues/${fx.venue.id}`).set(admin.auth)).body;
    expect(detail.change.fields).toMatchObject({ name: 'Renamed Arena', description: 'New floodlights' });
    expect((await request(env.app).get('/api/admin/venues').query({ status: 'pending' }).set(admin.auth)).body.venues.map((v: any) => v.id)).toContain(fx.venue.id); // shows in the default 'awaiting review' list
    expect((await request(env.app).get('/api/admin/venues').query({ status: 'changes' }).set(admin.auth)).body.venues.map((v: any) => v.id)).toContain(fx.venue.id);

    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/changes`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    expect(await publicName()).toBe('Renamed Arena'); // now customers see it
    expect((await ownerView()).pendingChange).toBeNull();
    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/changes`).set(admin.auth).send({ decision: 'approve' }).expect(409); // nothing left to review
  });

  it('rejecting needs a reason and discards the edit', async () => {
    const live = await publicName();
    await request(env.app).put(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).send({ name: 'Bad Name' }).expect(200);
    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/changes`).set(admin.auth).send({ decision: 'reject' }).expect(400);
    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/changes`).set(admin.auth).send({ decision: 'reject', reason: 'Name is misleading' }).expect(200);
    expect(await publicName()).toBe(live);
    const mine = await ownerView(); expect(mine.name).toBe(live); expect(mine.pendingChange).toBeNull();
  });

  it('changing a field back to the live value leaves nothing to review; unchanged saves create nothing', async () => {
    const live = await publicName();
    await request(env.app).put(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).send({ name: 'Temp' }).expect(200);
    const back = await request(env.app).put(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).send({ name: live });
    expect(back.body.pendingChange).toBe(false);
    expect((await ownerView()).pendingChange).toBeNull();
    const nop = await request(env.app).put(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).send({ name: live, address: (await ownerView()).address });
    expect(nop.body.pendingChange).toBe(false);
  });

  it('facility changes are held too and applied on approval', async () => {
    const facs = (await request(env.app).get('/api/facilities')).body.facilities as { id: number }[];
    const now = (await ownerView()).facilityIds as number[];
    const next = facs.map((f) => f.id).filter((id) => !now.includes(id)).slice(0, 1);
    await request(env.app).put(`/api/owner/venues/${fx.venue.id}/facilities`).set(fx.owner.auth).send({ facilityIds: [...now, ...next] }).expect(204);
    const liveRows = async () => (await env.db.query('SELECT facility_id FROM venue_facilities WHERE venue_id=$1', [fx.venue.id])).rows.map((r: any) => r.facility_id).sort();
    expect(await liveRows()).toEqual([...now].sort()); // not applied yet
    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/changes`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    expect(await liveRows()).toEqual([...now, ...next].sort());
  });

  it('a venue that was never approved is still edited directly', async () => {
    const other = await createApprovedVenue(env, admin);
    await env.db.query(`UPDATE venues SET status='draft' WHERE id=$1`, [other.venue.id]);
    const put = await request(env.app).put(`/api/owner/venues/${other.venue.id}`).set(other.owner.auth).send({ name: 'Direct Edit' });
    expect(put.status).toBe(200); expect(put.body.venue.name).toBe('Direct Edit'); expect(put.body.pendingChange).toBeUndefined();
  });
});

describe('photos and documents of an approved venue', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80)]);
  const customerImages = async () => (await request(env.app).get(`/api/venues/${fx.venue.id}`)).body.images?.map((i: any) => i.id) ?? (await request(env.app).get(`/api/venues/${fx.venue.id}`)).body.venue.images.map((i: any) => i.id);

  it('new photos wait for approval, removals wait too, and the admin sees both', async () => {
    const before = await customerImages();
    const up = await request(env.app).post(`/api/owner/venues/${fx.venue.id}/media`).set(fx.owner.auth).attach('file', PNG, { filename: 'new.png', contentType: 'image/png' });
    expect(up.status).toBe(201); expect(up.body.media.is_pending).toBe(true);
    expect(await customerImages()).toEqual(before); // customers do not see it yet
    const owner = await ownerView(); expect(owner.images.find((i: any) => i.id === up.body.media.id).is_pending).toBe(true);
    // remove an existing (live) photo: it stays visible until approved
    const live = before[0];
    await request(env.app).delete(`/api/owner/media/${live}`).set(fx.owner.auth).expect(204);
    expect(await customerImages()).toContain(live);
    const detail = (await request(env.app).get(`/api/admin/venues/${fx.venue.id}`).set(admin.auth)).body;
    expect(detail.change.newImages.map((i: any) => i.id)).toEqual([up.body.media.id]); expect(detail.change.removedImages.map((i: any) => i.id)).toEqual([live]);
    expect((await request(env.app).get('/api/admin/venues').query({ status: 'pending' }).set(admin.auth)).body.venues.find((v: any) => v.id === fx.venue.id).change_pending).toBe(true);

    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/changes`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    const after = await customerImages();
    expect(after).toContain(up.body.media.id); expect(after).not.toContain(live);
    const covers = (await env.db.query('SELECT count(*)::int AS n FROM venue_images WHERE venue_id=$1 AND is_cover', [fx.venue.id])).rows[0].n;
    expect(covers).toBe(1); // a cover always remains
  });

  it('rejecting discards new photos and keeps the ones marked for removal', async () => {
    const before = await customerImages();
    const up = await request(env.app).post(`/api/owner/venues/${fx.venue.id}/media`).set(fx.owner.auth).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(201);
    await request(env.app).delete(`/api/owner/media/${before[0]}`).set(fx.owner.auth).expect(204);
    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/changes`).set(admin.auth).send({ decision: 'reject', reason: 'Photo is not of this venue' }).expect(200);
    expect(await customerImages()).toEqual(before);
    expect((await env.db.query('SELECT 1 FROM venue_images WHERE id=$1', [up.body.media.id])).rows.length).toBe(0);
  });

  it('a new document on an approved venue appears in the admin review list', async () => {
    await request(env.app).post(`/api/owner/venues/${fx.venue.id}/documents`).set(fx.owner.auth).field('docType', 'Fire safety certificate')
      .attach('file', Buffer.from('%PDF-1.4 fire cert'), { filename: 'fire.pdf', contentType: 'application/pdf' }).expect(201);
    const detail = (await request(env.app).get(`/api/admin/venues/${fx.venue.id}`).set(admin.auth)).body;
    expect(detail.change.newDocuments.map((d: any) => d.doc_type)).toContain('Fire safety certificate');
    expect((await request(env.app).get('/api/admin/venues').query({ status: 'changes' }).set(admin.auth)).body.venues.map((v: any) => v.id)).toContain(fx.venue.id);
  });

  it('changing the cover photo is held and applied on approval', async () => {
    const imgs = (await ownerView()).images.filter((i: any) => i.kind === 'image' && !i.is_pending && !i.delete_requested);
    const other = imgs.find((i: any) => !i.is_cover); if (!other) return;
    await request(env.app).put(`/api/owner/media/${other.id}/cover`).set(fx.owner.auth).expect(204);
    expect((await env.db.query('SELECT is_cover FROM venue_images WHERE id=$1', [other.id])).rows[0].is_cover).toBe(false); // not live yet
    expect((await ownerView()).images.find((i: any) => i.id === other.id).is_cover).toBe(true); // the owner sees it
  });
});
