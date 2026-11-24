import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, registerUser, setup, type TestEnv } from './helpers.js';

const saveBank = (o: any) => request(env.app).put('/api/owner/profile').set(o.auth).send({ bankAccountName: 'Mehta Sports', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }); // the bank account comes before any add or change
let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); });

const fresh = async () => { const o = await registerUser(env, 'owner'); const f = await createApprovedVenue(env, admin, o); return { o, ...f }; };
const edit = (o: any, venueId: string, body: object) => request(env.app).put(`/api/owner/venues/${venueId}`).set(o.auth).send(body);
const publicVenue = async (id: string) => (await request(env.app).get(`/api/venues/${id}`).expect(200)).body.venue;
const ownersView = async (o: any, id: string) => (await request(env.app).get(`/api/owner/venues/${id}`).set(o.auth).expect(200)).body.venue;
const waiting = async (id: string) => (await env.db.query('SELECT fields FROM listing_change_requests WHERE venue_id=$1', [id])).rows[0]?.fields ?? null;

describe('contact numbers change straight away, without approval', () => {
  it('on an approved venue the new number is live for customers at once, and nothing is queued for review', async () => {
    const { o, venue } = await fresh();
    const r = await edit(o, venue.id, { contactPhone: '+919800000001' }).expect(200);
    expect(r.body).toMatchObject({ contactUpdated: true, pendingChange: false });
    expect((await publicVenue(venue.id)).contact_phone).toBe('+919800000001');
    expect(await waiting(venue.id)).toBeNull();
  });

  it('can add a second number, change it, and remove it again', async () => {
    const { o, venue } = await fresh();
    await edit(o, venue.id, { contactPhone: '+919800000001', contactPhone2: '+919800000002' }).expect(200);
    expect(await ownersView(o, venue.id)).toMatchObject({ contact_phone: '+919800000001', contact_phone2: '+919800000002' });
    await edit(o, venue.id, { contactPhone2: '9811111111' }).expect(200); expect((await ownersView(o, venue.id)).contact_phone2).toBe('9811111111');
    await edit(o, venue.id, { contactPhone2: '' }).expect(200); expect((await ownersView(o, venue.id)).contact_phone2).toBeNull();
    await edit(o, venue.id, { contactPhone2: '+919800000003' }).expect(200); await edit(o, venue.id, { contactPhone2: null }).expect(200); expect((await ownersView(o, venue.id)).contact_phone2).toBeNull();
    expect((await publicVenue(venue.id)).contact_phone).toBe('+919800000001'); // the first number was not touched
  });

  it('only the numbers go live in a mixed edit: other details still wait for approval', async () => {
    const { o, venue } = await fresh();
    const before = (await publicVenue(venue.id)).name;
    const r = await edit(o, venue.id, { contactPhone: '+919822222222', name: 'A Brand New Name' }).expect(200);
    expect(r.body).toMatchObject({ contactUpdated: true, pendingChange: true });
    const pub = await publicVenue(venue.id); expect(pub.contact_phone).toBe('+919822222222'); expect(pub.name).toBe(before); // customers see the number, not the new name
    expect(await waiting(venue.id)).toEqual({ name: 'A Brand New Name' }); // the number is not in the review queue
  });

  it('customers never receive the second number, only the main one', async () => {
    const { o, venue } = await fresh();
    await edit(o, venue.id, { contactPhone: '+919800000001', contactPhone2: '+919800000002' }).expect(200);
    const pub = await publicVenue(venue.id);
    expect(pub.contact_phone).toBe('+919800000001'); expect('contact_phone2' in pub).toBe(false); expect(JSON.stringify(pub)).not.toContain('+919800000002');
    expect((await ownersView(o, venue.id)).contact_phone2).toBe('+919800000002'); // the owner still sees it
  });

  it('a non-contact edit is still held, as before', async () => {
    const { o, venue } = await fresh();
    const r = await edit(o, venue.id, { name: 'Renamed Arena' }).expect(200);
    expect(r.body).toMatchObject({ contactUpdated: false, pendingChange: true });
  });

  it('an older change waiting for review cannot bring the old number back when it is approved', async () => {
    const { o, venue } = await fresh();
    await env.db.query(`INSERT INTO listing_change_requests (venue_id, fields) VALUES ($1,$2::jsonb)`, [venue.id, JSON.stringify({ contact_phone: '+919000000000', name: 'Held Name' })]);
    await edit(o, venue.id, { contactPhone: '+919833333333' }).expect(200);
    expect(await waiting(venue.id)).toEqual({ name: 'Held Name' }); // the stale number was dropped from the queue
    await request(env.app).post(`/api/admin/venues/${venue.id}/changes`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    const pub = await publicVenue(venue.id); expect(pub.contact_phone).toBe('+919833333333'); expect(pub.name).toBe('Held Name');
  });

  it('a request that only changed the number leaves no empty review behind', async () => {
    const { o, venue } = await fresh();
    await env.db.query(`INSERT INTO listing_change_requests (venue_id, fields) VALUES ($1,$2::jsonb)`, [venue.id, JSON.stringify({ contact_phone: '+919000000000' })]);
    expect((await edit(o, venue.id, { contactPhone: '+919844444444' }).expect(200)).body.pendingChange).toBe(false);
    expect(await waiting(venue.id)).toBeNull();
  });

  it('works while the venue is waiting for approval, where every other edit is locked', async () => {
    const { o, venue } = await fresh();
    await env.db.query(`UPDATE venues SET status='pending' WHERE id=$1`, [venue.id]);
    await edit(o, venue.id, { contactPhone2: '+919855555555' }).expect(200);
    expect((await env.db.query('SELECT contact_phone2 FROM venues WHERE id=$1', [venue.id])).rows[0].contact_phone2).toBe('+919855555555');
    expect((await edit(o, venue.id, { name: 'Locked Name' }).expect(409)).body.error.code).toBe('venue_locked');
  });

  it('a new venue can be created with two numbers, and a draft venue changes them instantly too', async () => {
    const o = await registerUser(env, 'owner'); await request(env.app).post(`/api/admin/owners/${o.id}/verification`).set(admin.auth).send({ status: 'verified' }).expect(200);
    await saveBank(o);
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ name: 'Two Phones Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038', lat: 12.97, lng: 77.59, contactPhone: '+919866666666', contactPhone2: '+919877777777', bank: { accountName: 'Mehta Sports', accountNumber: '123456789012', ifsc: 'HDFC0001234' } }).expect(201)).body.venue;
    expect(v).toMatchObject({ contact_phone: '+919866666666', contact_phone2: '+919877777777' }); // the owner's own copy of the venue
    await edit(o, v.id, { contactPhone: '+919888888888' }).expect(200);
    expect((await env.db.query('SELECT contact_phone, status FROM venues WHERE id=$1', [v.id])).rows[0]).toMatchObject({ contact_phone: '+919888888888', status: 'draft' });
  });

  it('refuses a number that is not valid, or the same number twice', async () => {
    const { o, venue } = await fresh();
    for (const bad of ['12345', 'abcdefghij', '+91 98000 00001x', '+9198000000011111']) { await edit(o, venue.id, { contactPhone: bad }).expect(400); await edit(o, venue.id, { contactPhone2: bad }).expect(400); }
    await edit(o, venue.id, { contactPhone: '+919800000001', contactPhone2: '+919800000001' }).expect(400);
    await edit(o, venue.id, { contactPhone: '+919800000001' }).expect(200);
    expect((await edit(o, venue.id, { contactPhone2: '+919800000001' }).expect(400)).body.error.code).toBe('duplicate_phone'); // same as the first, set separately
  });

  it('only the venue\'s owner can change them', async () => {
    const { venue } = await fresh(); const other = await registerUser(env, 'owner'); const c = await registerUser(env, 'customer');
    await edit(other, venue.id, { contactPhone: '+919800000009' }).expect(403); await edit(c, venue.id, { contactPhone: '+919800000009' }).expect(403);
    await request(env.app).put(`/api/owner/venues/${venue.id}`).send({ contactPhone: '+919800000009' }).expect(401);
  });
});


describe('the turf owner\'s own business contact numbers (Business information page)', () => {
  const put = (who: any, body: object) => request(env.app).put('/api/me/profile').set(who.auth).send(body);
  const mine = async (who: any) => (await request(env.app).get('/api/me/profile').set(who.auth).expect(200)).body;
  const changes = async (id: string) => (await env.db.query('SELECT 1 FROM owner_profile_change_requests WHERE owner_id=$1', [id])).rows;

  it('an owner adds, changes and removes a second number, and it is live at once with nothing queued for approval', async () => {
    const o = await registerUser(env, 'owner'); await request(env.app).post(`/api/admin/owners/${o.id}/verification`).set(admin.auth).send({ status: 'verified' }).expect(200);
    await put(o, { alternatePhone: '9899999999' }).expect(200);
    expect((await mine(o)).profile.alternate_phone).toBe('+919899999999'); // stored in one form, like the main number
    expect(await changes(o.id)).toHaveLength(0);
    await put(o, { alternatePhone: '+919877700000' }).expect(200); expect((await mine(o)).profile.alternate_phone).toBe('+919877700000');
    await put(o, { alternatePhone: '' }).expect(200); expect((await mine(o)).profile.alternate_phone).toBeNull();
  });
  it('the main number is changed in the same way, and is also live at once (it only needs verifying again)', async () => {
    const o = await registerUser(env, 'owner'); const before = (await mine(o)).user.phone;
    const r = await put(o, { phone: '9123456701', alternatePhone: '9123456702' }).expect(200);
    expect(r.body.user.phone).toBe('+919123456701'); expect(r.body.user.phone).not.toBe(before); expect(r.body.user.phoneVerified).toBe(false);
    expect((await mine(o)).profile.alternate_phone).toBe('+919123456702');
  });
  it('refuses a second number that is not valid, or the same as the main number', async () => {
    const o = await registerUser(env, 'owner'); const main = (await mine(o)).user.phone;
    await put(o, { alternatePhone: '12345' }).expect(400);
    expect((await put(o, { alternatePhone: main }).expect(400)).body.error.code).toBe('duplicate_phone');
    expect((await put(o, { alternatePhone: main.replace('+91', '') }).expect(400)).body.error.code).toBe('duplicate_phone'); // same number written without +91
    expect((await mine(o)).profile.alternate_phone).toBeNull();
  });
  it('is for turf owners only: a customer cannot add one, and it is never returned to customers', async () => {
    const c = await registerUser(env, 'customer');
    expect((await put(c, { alternatePhone: '9899999999' }).expect(403)).body.error.message).toMatch(/Only turf owners/);
    expect(JSON.stringify((await mine(c)).profile)).not.toContain('alternate'); // not in a customer's profile at all
    await put(c, { fullName: 'Still Works' }).expect(200);
  });
});
