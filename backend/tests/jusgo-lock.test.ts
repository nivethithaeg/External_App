import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, ist, setup, type TestEnv } from './helpers.js';

const dayAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let env: TestEnv;
beforeAll(async () => { env = await setup(); });
const locked = (r: any) => { expect(r.status, JSON.stringify(r.body)).toBe(409); expect(r.body.error.code).toBe('managed_in_jusgo'); };

describe('venues linked with JusGo are changed in JusGo only', () => {
  it('without a JusGo key nothing is locked; with one, venue, court, slot, price and block changes are refused', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth; const day = dayAhead(3);
    const block = () => request(env.app).post(`/api/owner/areas/${f.area.id}/blocks`).set(own).send({ startsAt: ist(day, '10:00'), endsAt: ist(day, '11:00'), reason: 'Rain' });
    const made = (await block().expect(201)).body.block; // not linked yet
    await request(env.app).post('/api/owner/sync-key').set(own).expect(201);
    const calls = [
      request(env.app).put(`/api/owner/venues/${f.venue.id}`).set(own).send({ name: 'Renamed' }),
      request(env.app).put(`/api/owner/venues/${f.venue.id}/sports`).set(own).send({ sportIds: [f.football.id] }),
      request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(own).send({ name: 'Turf B', sportIds: [f.football.id] }),
      request(env.app).put(`/api/owner/areas/${f.area.id}`).set(own).send({ name: 'Turf Z' }),
      request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(own).send({ basePrice: 999 }),
      request(env.app).put(`/api/owner/areas/${f.area.id}/availability`).set(own).send({ days: [] }),
      request(env.app).post(`/api/owner/areas/${f.area.id}/deletion`).set(own).send({}),
      block(),
      request(env.app).delete(`/api/owner/blocks/${made.id}`).set(own),
      request(env.app).post('/api/owner/blocks/bulk').set(own).send({ areaIds: [f.area.id], startsAt: ist(day, '15:00'), endsAt: ist(day, '16:00') }),
    ];
    for (const c of calls) locked(await c);
    expect((await env.db.query('SELECT name FROM venues WHERE id=$1', [f.venue.id])).rows[0].name).toBe('Green Arena');
    // reading is fine, and so are things JusGo does not manage
    await request(env.app).get(`/api/owner/areas/${f.area.id}/blocks`).set(own).expect(200);
    await request(env.app).post('/api/owner/venues').set(own).send({ name: 'Second Arena', address: '9 Hill Road, Erode', city: 'Erode', pincode: '638001', lat: 11.34, lng: 77.71 }).expect(201);
    // removing the JusGo key unlocks it again
    await request(env.app).delete('/api/owner/sync-key').set(own).expect(204);
    await request(env.app).delete(`/api/owner/blocks/${made.id}`).set(own).expect(204);
  });

  it('staff of a linked owner cannot block slots either', async () => {
    const admin = await createAdmin(env); const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    await request(env.app).post('/api/owner/staff').set(own).send({ fullName: 'Gate Staff', email: 'lock.staff@test.dev', password: 'GatePassword1', permissions: ['BLOCK_SLOTS'] }).expect(201);
    const staff = { Authorization: `Bearer ${(await request(env.app).post('/api/auth/login').send({ email: 'lock.staff@test.dev', password: 'GatePassword1' }).expect(200)).body.token}` };
    await request(env.app).post('/api/owner/sync-key').set(own).expect(201);
    const day = dayAhead(4);
    locked(await request(env.app).post('/api/staff/blocks').set(staff).send({ areaId: f.area.id, startsAt: ist(day, '10:00'), endsAt: ist(day, '11:00'), reason: 'Rain' }));
    await request(env.app).get('/api/staff/blocks').set(staff).expect(200);
  });
});
