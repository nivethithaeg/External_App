import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); });

async function approvedIndividual() {
  const o = await registerUser(env, 'owner');
  await approveOwner(env, admin, o);
  await env.db.query(`UPDATE owner_profiles SET business_type='individual', business_name='Arun Kumar', pan='ABCDE1234F', application_status='approved', business_verified_at=now() WHERE user_id=$1`, [o.id]);
  return o;
}
const toPartnership = { businessType: 'partnership_pvt_ltd', businessName: 'Arun Sports LLP', representativeName: 'Arun Kumar', phone: '9876543210', address: '12 Cross Street, Erode', state: 'Tamil Nadu', city: 'Erode', pincode: '638001',
  partners: [{ name: 'Meena Ravi', pan: 'BCDEF2345G', aadhaar: '234567891234', phone: '9876543211' }], reason: 'We registered a partnership' };
const profile = async (id: string) => (await env.db.query('SELECT business_type, business_name, partners, business_verified_at FROM owner_profiles WHERE user_id=$1', [id])).rows[0];

describe('changing the business type after approval', () => {
  it('the owner asks, the approved details stay live, and the admin approves: the new type is saved and verified', async () => {
    const o = await approvedIndividual();
    const before = env.emails.length;
    const r = await request(env.app).post('/api/owner/application/business-change').set(o.auth).send(toPartnership).expect(201);
    expect(r.body.request).toMatchObject({ status: 'pending', fromType: 'individual', toType: 'partnership_pvt_ltd', reason: 'We registered a partnership' });
    expect(JSON.stringify(r.body)).not.toContain('234567891234'); // partners' Aadhaar: last 4 digits only
    expect(r.body.request.details.partners[0].aadhaarLast4).toBe('1234');
    expect(await profile(o.id)).toMatchObject({ business_type: 'individual', business_name: 'Arun Kumar' }); // still the approved details
    expect(env.emails.slice(before).some((m) => m.to === admin.email && m.subject === 'Business type change requested')).toBe(true);
    await request(env.app).post('/api/owner/application/business-change').set(o.auth).send(toPartnership).expect(409); // one at a time

    const list = (await request(env.app).get('/api/admin/business-changes?status=pending').set(admin.auth).expect(200)).body.changes;
    const c = list.find((x: any) => x.ownerId === o.id);
    expect(c).toMatchObject({ fromType: 'individual', toType: 'partnership_pvt_ltd', currentBusinessName: 'Arun Kumar' });
    await request(env.app).post(`/api/admin/business-changes/${c.id}/decision`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    const p = await profile(o.id);
    expect(p).toMatchObject({ business_type: 'partnership_pvt_ltd', business_name: 'Arun Sports LLP' });
    expect(p.partners).toEqual([{ name: 'Meena Ravi', pan: 'BCDEF2345G', aadhaarLast4: '1234', phone: '9876543211' }]);
    expect(p.business_verified_at).not.toBeNull();
    expect((await request(env.app).get('/api/owner/application/business-change').set(o.auth).expect(200)).body.request.status).toBe('approved');
  });

  it('rejected: nothing changes and the owner sees why; a reason is required', async () => {
    const o = await approvedIndividual();
    const id = (await request(env.app).post('/api/owner/application/business-change').set(o.auth).send(toPartnership).expect(201)).body.request.id;
    await request(env.app).post(`/api/admin/business-changes/${id}/decision`).set(admin.auth).send({ decision: 'reject' }).expect(400);
    await request(env.app).post(`/api/admin/business-changes/${id}/decision`).set(admin.auth).send({ decision: 'reject', note: 'Upload the partnership deed first' }).expect(200);
    expect(await profile(o.id)).toMatchObject({ business_type: 'individual' });
    expect((await request(env.app).get('/api/owner/application/business-change').set(o.auth).expect(200)).body.request).toMatchObject({ status: 'rejected', reviewNote: 'Upload the partnership deed first' });
  });

  it('the owner can cancel; the same type, an unapproved owner and bad details are refused', async () => {
    const o = await approvedIndividual();
    await request(env.app).post('/api/owner/application/business-change').set(o.auth).send({ ...toPartnership, businessType: 'individual', dob: '1990-01-01' }).expect(400);
    await request(env.app).post('/api/owner/application/business-change').set(o.auth).send({ ...toPartnership, partners: [] }).expect(400);
    await request(env.app).post('/api/owner/application/business-change').set(o.auth).send(toPartnership).expect(201);
    await request(env.app).delete('/api/owner/application/business-change').set(o.auth).expect(200);
    expect((await request(env.app).get('/api/owner/application/business-change').set(o.auth).expect(200)).body.request.status).toBe('cancelled');
    const fresh = await registerUser(env, 'owner'); // still filling the application
    await request(env.app).post('/api/owner/application/business-change').set(fresh.auth).send(toPartnership).expect(409);
  });
});

describe('business information page data', () => {
  it('the owner profile includes the current business type', async () => {
    const o = await approvedIndividual();
    const r = await request(env.app).get('/api/me/profile').set(o.auth).expect(200);
    expect(r.body.profile.business_type).toBe('individual');
  });
});
