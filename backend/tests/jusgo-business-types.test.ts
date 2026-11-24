import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
const put = (o: any, body: object) => request(env.app).put('/api/owner/application/business').set(o.auth).send(body);
const get = (o: any) => request(env.app).get('/api/owner/application').set(o.auth);
const addr = { address: '12 Park Road, Indiranagar', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', pan: 'ABCDE1234F' };

describe('JusGo business types', () => {
  it('Individual: needs legal name, PAN, 18+ date of birth and phone; business name defaults to the person', async () => {
    const o = await registerUser(env, 'owner');
    await put(o, { businessType: 'individual', ...addr, representativeName: 'Arjun Mehta', phone: '9876543210', dob: '2015-01-01' }).expect(400);
    await put(o, { businessType: 'individual', ...addr, representativeName: 'Arjun Mehta', dob: '1990-05-17' }).expect(400); // phone missing
    await put(o, { businessType: 'individual', ...addr, representativeName: 'Arjun Mehta', phone: '9876543210', dob: '1990-05-17' }).expect(200);
    const b = (await get(o).expect(200)).body.business;
    expect(b.type).toBe('individual'); expect(b.name).toBe('Arjun Mehta'); expect(b.dob).toBe('1990-05-17'); expect(b.phone).toBe('9876543210');
  });

  it('Sole proprietorship: optional GST, Udyam and other information are stored; a bad Udyam number is refused', async () => {
    const o = await registerUser(env, 'owner');
    const body = { businessType: 'sole_proprietorship', ...addr, businessName: 'Mehta Sports', representativeName: 'Arjun Mehta', phone: '9876543210' };
    await put(o, { ...body, udyamNumber: 'nope' }).expect(400);
    await put(o, { ...body, udyamNumber: 'udyam-tn-00-0000001', otherInfo: 'Running since 2019' }).expect(200);
    const b = (await get(o)).body.business;
    expect(b.udyamNumber).toBe('UDYAM-TN-00-0000001'); expect(b.otherInfo).toBe('Running since 2019');
  });

  it('Partnership / Private Limited: needs at least one partner or director; Aadhaar is stored as its last 4 digits only', async () => {
    const o = await registerUser(env, 'owner');
    const body = { businessType: 'partnership_pvt_ltd', ...addr, businessName: 'Mehta & Co', representativeName: 'Arjun Mehta', phone: '9876543210' };
    await put(o, { ...body, partners: [] }).expect(400);
    await put(o, { ...body, partners: [{ name: 'Arjun Mehta', pan: 'ABCDE1234F', aadhaar: '123456789012', phone: '9876543210' }], registrationNumber: '' }).expect(200);
    const b = (await get(o)).body.business;
    expect(b.partners).toEqual([{ name: 'Arjun Mehta', pan: 'ABCDE1234F', aadhaarLast4: '9012', phone: '9876543210' }]);
    expect(JSON.stringify(b)).not.toContain('123456789012');
    await put(o, { ...body, registrationNumber: 'BADCIN', partners: [{ name: 'A B', pan: 'ABCDE1234F', aadhaar: '123456789012', phone: '9876543210' }] }).expect(400);
  });
});

describe('JusGo playing-area details', () => {
  it('stores indoor/outdoor, roof type and an advance booking limit that stops far-future holds', async () => {
    const { createApprovedVenue, createAdmin } = await import('./helpers.js');
    const v: any = await createApprovedVenue(env, await createAdmin(env));
    const areaId = v.area.id;
    const own = v.owner.auth;
    const r = await request(env.app).put(`/api/owner/areas/${areaId}`).set(own).send({ environment: 'indoor', roofType: 'covered', advanceBookingDays: 7 }).expect(200);
    expect(r.body.area?.environment ?? r.body.environment).toBe('indoor');
    await request(env.app).put(`/api/owner/areas/${areaId}`).set(own).send({ roofType: 'glass' }).expect(400);
    const row = (await env.db.query('SELECT environment, roof_type, advance_booking_days FROM playing_areas WHERE id=$1', [areaId])).rows[0];
    expect(row).toEqual({ environment: 'indoor', roof_type: 'covered', advance_booking_days: 7 });
  });
});

describe('JusGo owner customers page', () => {
  it('lists each person who booked once, with their bookings, cancellations and spend', async () => {
    const { createApprovedVenue, createAdmin } = await import('./helpers.js');
    const f: any = await createApprovedVenue(env, await createAdmin(env));
    const own = f.owner.auth;
    const empty = await request(env.app).get('/api/owner/customers').set(own).expect(200);
    expect(empty.body.customers).toEqual([]); expect(empty.body.summary.customers).toBe(0);
    const c = await registerUser(env, 'customer');
    const uid = (await env.db.query('SELECT id FROM users WHERE email=$1', [c.email])).rows[0].id;
    for (const [i, status] of ['completed', 'cancelled'].entries()) {
      await env.db.query(`INSERT INTO bookings (reference, customer_id, venue_id, area_id, sport_id, during, status, subtotal, total, commission_rate, commission_amount, owner_amount)
        VALUES ($1,$2,$3,$4,$5,tstzrange(now() - interval '5 days' + ($6 || ' hours')::interval, now() - interval '5 days' + ($6 || ' hours')::interval + interval '1 hour'),$7,800,800,10,80,720)`,
        [`CUS-${i}-${Date.now()}`, uid, f.venue.id, f.area.id, f.football.id, String(i * 3), status]);
    }
    const r = await request(env.app).get('/api/owner/customers').set(own).expect(200);
    expect(r.body.customers).toHaveLength(1);
    expect(r.body.customers[0]).toMatchObject({ bookings: 2, cancelled: 1, spent: 800 });
    expect(r.body.summary).toMatchObject({ customers: 1, repeat: 1, bookings: 2, cancellations: 1 });
    expect((await request(env.app).get('/api/owner/customers?search=zzzz').set(own).expect(200)).body.customers).toHaveLength(0);
    const h = await request(env.app).get('/api/owner/customers/history').query({ key: r.body.customers[0].key }).set(own).expect(200);
    expect(h.body.bookings).toHaveLength(2);
    await request(env.app).get('/api/owner/customers').set((await registerUser(env, 'customer')).auth).expect(403);
  });
});

describe('personal details step', () => {
  it('saves who the owner is and where the turf is; the business step then starts from those answers', async () => {
    const o = await registerUser(env, 'owner');
    expect((await get(o)).body.personal.done).toBe(false);
    const body = { legalName: 'Arjun Mehta', dob: '1990-05-17', phone: '9876543210', addressLine1: '12 Park Road, Indiranagar', addressLine2: 'Near the temple', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', country: 'India' };
    await request(env.app).put('/api/owner/application/personal').set(o.auth).send({ ...body, dob: '2015-01-01' }).expect(400);
    await request(env.app).put('/api/owner/application/personal').set(o.auth).send({ ...body, legalName: 'R2D2' }).expect(400);
    await request(env.app).put('/api/owner/application/personal').set(o.auth).send(body).expect(200);
    const a = (await get(o)).body;
    expect(a.personal.done).toBe(true);
    expect(a.business).toMatchObject({ representativeName: 'Arjun Mehta', dob: '1990-05-17', phone: '+919876543210', address: '12 Park Road, Indiranagar', addressLine2: 'Near the temple', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', country: 'India' });
  });
});
