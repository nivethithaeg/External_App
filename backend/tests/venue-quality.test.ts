import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
const score = async () => (await request(env.app).get(`/api/owner/venues/${fx.venue.id}/score`).set(fx.owner.auth).expect(200)).body;
const part = (s: any, k: string) => s.parts.find((p: any) => p.key === k);

describe('venue score', () => {
  it('scores out of 100 with fixed, visible rules, and says what would raise it', async () => {
    const s = await score();
    expect(s.parts.map((p: any) => p.key)).toEqual(['profile', 'reliability', 'reviews', 'complaints']);
    expect(s.parts.reduce((n: number, p: any) => n + p.max, 0)).toBe(100);
    expect(s.score).toBe(s.parts.reduce((n: number, p: any) => n + p.points, 0));
    expect(part(s, 'reliability')).toMatchObject({ points: 24 }); // a new venue
    expect(part(s, 'reviews')).toMatchObject({ points: 15 }); // fewer than 3 reviews
    expect(part(s, 'complaints')).toMatchObject({ points: 15 });
    expect(s.tips.length).toBeGreaterThan(0); expect(['Excellent', 'Good', 'Fair', 'Needs work']).toContain(s.grade);
  });

  it('rises with a complete profile and falls with complaints and venue cancellations', async () => {
    const before = (await score()).score;
    await env.db.query(`UPDATE venues SET description=$2, contact_phone='+919876543210' WHERE id=$1`, [fx.venue.id, 'A floodlit five-a-side turf with parking, a cafeteria and changing rooms.']);
    expect(part(await score(), 'profile').points).toBeGreaterThan(part({ parts: [{ key: 'profile', points: 0 }] }, 'profile').points);
    expect((await score()).score).toBeGreaterThan(before);
    await env.db.query(`UPDATE venues SET rating_avg=4.5, rating_count=10 WHERE id=$1`, [fx.venue.id]);
    expect(part(await score(), 'reviews').points).toBe(23); // 4.5 / 5 * 25, rounded
    // a customer complaint about a booking costs 5 points
    const c = await registerUser(env, 'customer'); const r = await startBooking(env, c, fx, ist(dateIn(5), '10:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    await request(env.app).post('/api/me/tickets').set(c.auth).send({ subject: 'Ground was not ready', message: 'It was waterlogged.', bookingId: r.booking.body.bookingId }).expect(201);
    expect(part(await score(), 'complaints').points).toBe(10);
    // venue cancellations: 5 games, 2 cancelled by the venue = 40%, which is past the 25% limit, so 0 of 30
    for (let i = 0; i < 4; i++) { const x = await startBooking(env, c, fx, ist(dateIn(6 + i), '10:00')); await pay(env, c, x.booking.body.bookingId, x.booking.body.order.id); if (i < 2) await request(env.app).post(`/api/owner/bookings/${x.booking.body.bookingId}/cancel`).set(fx.owner.auth).send({ reason: 'Ground flooded' }).expect(200); }
    expect(part(await score(), 'reliability')).toMatchObject({ points: 0 });
    await request(env.app).get(`/api/owner/venues/${fx.venue.id}/score`).set((await registerUser(env, 'customer')).auth).expect(403);
    const other = await registerUser(env, 'owner'); await approveOwner(env, admin, other);
    await request(env.app).get(`/api/owner/venues/${fx.venue.id}/score`).set(other.auth).expect(403); // not their venue
  });

  it('lists scores for approved venues to admins only', async () => {
    const r = (await request(env.app).get('/api/admin/venue-scores').set(admin.auth).expect(200)).body.scores;
    expect(r[fx.venue.id]).toMatchObject({ score: expect.any(Number), grade: expect.any(String) });
    await request(env.app).get('/api/admin/venue-scores').set(fx.owner.auth).expect(403);
  });
});

describe('approval checklist', () => {
  it('checks what can be checked, needs two human confirmations, and reports when a venue is ready', async () => {
    await env.db.query(`UPDATE venues SET state='Karnataka' WHERE id=$1`, [fx.venue.id]); // venues created through the form always have one
    const get = async () => (await request(env.app).get(`/api/admin/venues/${fx.venue.id}/readiness`).set(admin.auth).expect(200)).body;
    const a = await get();
    const ok = (id: string) => a.checklist.auto.find((x: any) => x.id === id).ok;
    expect(ok('owner_verified')).toBe(true); expect(ok('location')).toBe(true); expect(ok('areas')).toBe(true);
    expect(a.checklist.manual.map((m: any) => m.id)).toEqual(['photos_match', 'docs_legible']); expect(a.checklist.manual.every((m: any) => !m.checked)).toBe(true);
    expect(a.checklist.ready).toBe(false); expect(a.checklist.blocking).toBeGreaterThanOrEqual(2); expect(a.score.score).toBeGreaterThan(0);
    // optional items are listed but never block
    const optional = a.checklist.auto.filter((i: any) => !i.required).map((i: any) => i.id); expect(optional).toEqual(expect.arrayContaining(['bank', 'description', 'contact']));
    await request(env.app).put(`/api/admin/venues/${fx.venue.id}/review-checks/photos_match`).set(admin.auth).send({ checked: true }).expect(200);
    const b = await get(); expect(b.checklist.manual.find((m: any) => m.id === 'photos_match')).toMatchObject({ checked: true, by: expect.any(String) });
    await request(env.app).put(`/api/admin/venues/${fx.venue.id}/review-checks/photos_match`).set(admin.auth).send({ checked: false }).expect(200);
    expect((await get()).checklist.manual.find((m: any) => m.id === 'photos_match').checked).toBe(false);
    await request(env.app).put(`/api/admin/venues/${fx.venue.id}/review-checks/made_up`).set(admin.auth).send({ checked: true }).expect(400);
    await request(env.app).get(`/api/admin/venues/${fx.venue.id}/readiness`).set(fx.owner.auth).expect(403);
  });

  it('flags a missing bill and an area photo taken far from the venue as problems', async () => {
    const o = await registerUser(env, 'owner'); await approveOwner(env, admin, o); const f2 = await createApprovedVenue(env, admin, o);
    await env.db.query(`DELETE FROM venue_documents WHERE venue_id=$1`, [f2.venue.id]);
    await env.db.query(`UPDATE venues SET lat=12.97, lng=77.59 WHERE id=$1`, [f2.venue.id]);
    await env.db.query(`INSERT INTO venue_images (venue_id, area_id, url, kind, geo_lat, geo_lng) VALUES ($1,$2,'http://x/far.jpg','image',13.9,77.59)`, [f2.venue.id, f2.area.id]);
    const c = (await request(env.app).get(`/api/admin/venues/${f2.venue.id}/readiness`).set(admin.auth).expect(200)).body.checklist;
    expect(c.auto.find((i: any) => i.id === 'bill')).toMatchObject({ ok: false, required: true });
    expect(c.auto.find((i: any) => i.id === 'photos_near')).toMatchObject({ ok: false });
    expect(c.ready).toBe(false);
    await request(env.app).get(`/api/admin/venues/00000000-0000-4000-8000-000000000000/readiness`).set(admin.auth).expect(404);
  });
});

describe('saved rejection reasons', () => {
  it('starts with a few common reasons, lets admins add and remove their own', async () => {
    const list = async () => (await request(env.app).get('/api/admin/rejection-templates').set(admin.auth).expect(200)).body.templates as any[];
    expect((await list()).map((t) => t.label)).toEqual(expect.arrayContaining(['Photos unclear', 'Electricity bill']));
    const made = (await request(env.app).post('/api/admin/rejection-templates').set(admin.auth).send({ label: 'No parking', body: 'Please confirm the parking details before we approve.' }).expect(201)).body.template;
    expect((await list()).some((t) => t.id === made.id)).toBe(true);
    await request(env.app).post('/api/admin/rejection-templates').set(admin.auth).send({ label: 'x', body: 'short' }).expect(400);
    await request(env.app).delete(`/api/admin/rejection-templates/${made.id}`).set(admin.auth).expect(204);
    await request(env.app).delete(`/api/admin/rejection-templates/${made.id}`).set(admin.auth).expect(404);
    await request(env.app).get('/api/admin/rejection-templates').set(fx.owner.auth).expect(403);
  });
});
