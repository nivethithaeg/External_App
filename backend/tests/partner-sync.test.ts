import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, ist, setup, type TestEnv } from './helpers.js';
import { walkIn } from './walkin.js';

const dayAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let env: TestEnv;
beforeAll(async () => { env = await setup(); });

async function ownerWithKey() {
  const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin);
  const key = (await request(env.app).post('/api/owner/sync-key').set(f.owner.auth).expect(201)).body.key as string;
  return { f, admin, key, as: { Authorization: `Bearer ${key}` } };
}

describe('booking sync for partner apps (JusGo)', () => {
  it('needs a valid key in the Authorization header', async () => {
    await request(env.app).get('/api/playnx/bookings').expect(401);
    await request(env.app).get('/api/playnx/bookings').set({ Authorization: 'Bearer pnx_wrong' }).expect(401);
    const { key } = await ownerWithKey();
    await request(env.app).get('/api/playnx/venues').set({ Authorization: key }).expect(200); // the key on its own works too
  });

  it('the owner makes a key once, sees only its start afterwards, and a new key stops the old one', async () => {
    const { f, key, as } = await ownerWithKey();
    expect(key).toMatch(/^pnx_/);
    const shown = (await request(env.app).get('/api/owner/sync-key').set(f.owner.auth).expect(200)).body.key;
    expect(shown.prefix).toBe(key.slice(0, 10)); expect(JSON.stringify(shown)).not.toContain(key);
    await request(env.app).get('/api/playnx/venues').set(as).expect(200);
    expect((await request(env.app).get('/api/owner/sync-key').set(f.owner.auth)).body.key.lastUsedAt).toBeTruthy();
    const second = (await request(env.app).post('/api/owner/sync-key').set(f.owner.auth).expect(201)).body.key;
    await request(env.app).get('/api/playnx/venues').set(as).expect(401);
    await request(env.app).get('/api/playnx/venues').set({ Authorization: `Bearer ${second}` }).expect(200);
    await request(env.app).delete('/api/owner/sync-key').set(f.owner.auth).expect(204);
    await request(env.app).get('/api/playnx/venues').set({ Authorization: `Bearer ${second}` }).expect(401);
  });

  it('lists the owner\'s own venues with their courts, and nobody else\'s', async () => {
    const { f, as } = await ownerWithKey();
    await ownerWithKey(); // another owner
    const v = (await request(env.app).get('/api/playnx/venues').set(as).expect(200)).body.venues;
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ id: f.venue.id, name: 'Green Arena', timezone: 'Asia/Kolkata' });
    expect(v[0].courts).toEqual([expect.objectContaining({ id: f.area.id, name: 'Turf A', slotMinutes: 60, isActive: true, sports: expect.arrayContaining([expect.objectContaining({ name: 'Football' })]) })]);
    expect(v[0].playingAreas).toEqual(v[0].courts); // the same list under the PlaynX name
  });

  it('lists bookings, blocks and cancellations, with no customer contact details', async () => {
    const { f, as } = await ownerWithKey();
    const day = dayAhead(3);
    const bk = (await walkIn(env, f.owner.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(day, '10:00'), durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210' }).expect(201)).body;
    const block = (await request(env.app).post(`/api/owner/areas/${f.area.id}/blocks`).set(f.owner.auth).send({ startsAt: ist(day, '12:00'), endsAt: ist(day, '13:00'), reason: 'Maintenance' }).expect(201)).body.block;
    let list = (await request(env.app).get('/api/playnx/bookings').set(as).expect(200)).body;
    expect(list.serverTime).toBeTruthy();
    const b1 = list.bookings.find((x: any) => x.id === bk.bookingId);
    expect(b1).toMatchObject({ reference: bk.reference, venueId: f.venue.id, courtId: f.area.id, courtName: 'Turf A', sport: 'Football', type: 'booking', status: 'confirmed', cancelledAt: null,
      startsAt: new Date(ist(day, '10:00')).toISOString(), endsAt: new Date(ist(day, '11:00')).toISOString() });
    expect(JSON.stringify(list)).not.toMatch(/Ravi|9876543210/);
    expect(list.bookings.find((x: any) => x.id === block.id)).toMatchObject({ type: 'block', status: 'blocked' });

    // only what changed since the last read: the block is opened again, so it comes back as cancelled
    const since = list.serverTime;
    await new Promise((r) => setTimeout(r, 20));
    await request(env.app).delete(`/api/owner/blocks/${block.id}`).set(f.owner.auth).expect(204);
    list = (await request(env.app).get('/api/playnx/bookings').query({ since }).set(as).expect(200)).body;
    expect(list.bookings).toEqual([expect.objectContaining({ id: block.id, status: 'cancelled', type: 'block' })]);

    // a cancelled booking comes back as cancelled
    const since2 = list.serverTime; await new Promise((r) => setTimeout(r, 20));
    await env.db.query(`UPDATE bookings SET status='cancelled', cancelled_at=now() WHERE id=$1`, [bk.bookingId]);
    list = (await request(env.app).get('/api/playnx/bookings').query({ since: since2 }).set(as).expect(200)).body;
    expect(list.bookings).toEqual([expect.objectContaining({ id: bk.bookingId, status: 'cancelled' })]);
  });

  it('never shows another owner\'s bookings', async () => {
    const a = await ownerWithKey(); const b = await ownerWithKey();
    await walkIn(env, b.f.owner.auth).send({ areaId: b.f.area.id, sportId: b.f.football.id, startsAt: ist(dayAhead(4), '10:00'), durationMinutes: 60, customerName: 'Other', customerPhone: '9876500000' }).expect(201);
    const list = (await request(env.app).get('/api/playnx/bookings').set(a.as).expect(200)).body.bookings;
    expect(list.every((x: any) => x.venueId === a.f.venue.id)).toBe(true);
  });
});
