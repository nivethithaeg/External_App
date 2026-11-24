import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let sa: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); sa = await createAdmin(env, 'super_admin'); });

const approvedOwner = async () => { const o = await registerUser(env, 'owner'); await approveOwner(env, sa, o); return o; };
const putProfile = (o: { auth: any }, body: object) => request(env.app).put('/api/owner/profile').set(o.auth).send(body);
const myProfile = async (o: { auth: any }) => (await request(env.app).get('/api/me/profile').set(o.auth).expect(200)).body;
const queue = async (a = sa) => (await request(env.app).get('/api/admin/profile-changes').set(a.auth).expect(200)).body.changes as any[];
const inbox = async (u: { auth: any }) => (await request(env.app).get('/api/me/notifications').set(u.auth).expect(200)).body.notifications as any[];

describe('owner profile changes need admin approval', () => {
  it('keeps the approved details live and queues the change for an admin', async () => {
    const o = await approvedOwner();
    const before = (await myProfile(o)).profile;
    const r = await putProfile(o, { businessName: 'Brand New Sports', gstin: '29ABCDE1234F1Z5', address: '9 New Street, Chennai' }).expect(202);
    expect(r.body).toMatchObject({ pending: true }); expect(r.body.fields).toEqual(expect.arrayContaining(['Business name', 'GSTIN', 'Registered address']));
    const after = await myProfile(o);
    expect(after.profile.business_name).toBe(before.business_name); // nothing changed yet
    expect(after.profile.gstin).toBe(before.gstin);
    expect(after.pendingChange.changes.map((c: any) => [c.label, c.proposed])).toEqual(expect.arrayContaining([['Business name', 'Brand New Sports']]));
    const mine = (await queue()).find((c) => c.owner_id === o.id)!;
    expect(mine.changes.find((c: any) => c.field === 'business_name')).toMatchObject({ current: before.business_name, proposed: 'Brand New Sports' });
    expect((await inbox(sa)).some((n) => n.type === 'admin_profile_change' && n.data.link === '/admin/profile-changes')).toBe(true);
  });

  it('shows the new details only after an admin approves, then tells the owner', async () => {
    const o = await approvedOwner();
    await putProfile(o, { businessName: 'Approved Name', pan: 'ABCDE1234F' }).expect(202);
    const ch = (await queue()).find((c) => c.owner_id === o.id)!;
    await request(env.app).post(`/api/admin/profile-changes/${ch.id}/approve`).set(sa.auth).expect(200);
    const p = await myProfile(o);
    expect(p.profile).toMatchObject({ business_name: 'Approved Name', pan: 'ABCDE1234F' });
    expect(p.pendingChange).toBeNull(); expect(p.lastDecision.status).toBe('approved');
    expect((await inbox(o)).some((n) => n.title === 'Your profile changes were approved')).toBe(true);
    await request(env.app).post(`/api/admin/profile-changes/${ch.id}/approve`).set(sa.auth).expect(409); // cannot be decided twice
    expect((await queue()).find((c) => c.id === ch.id)).toBeUndefined();
  });

  it('keeps the old details when an admin rejects, and the owner sees why', async () => {
    const o = await approvedOwner();
    const before = (await myProfile(o)).profile.business_name;
    await putProfile(o, { businessName: 'Sneaky Name' }).expect(202);
    const ch = (await queue()).find((c) => c.owner_id === o.id)!;
    await request(env.app).post(`/api/admin/profile-changes/${ch.id}/reject`).set(sa.auth).send({}).expect(400); // a reason is required
    await request(env.app).post(`/api/admin/profile-changes/${ch.id}/reject`).set(sa.auth).send({ note: 'Name does not match the registration certificate' }).expect(200);
    const p = await myProfile(o);
    expect(p.profile.business_name).toBe(before); expect(p.pendingChange).toBeNull();
    expect(p.lastDecision).toMatchObject({ status: 'rejected', note: 'Name does not match the registration certificate' });
    expect((await inbox(o)).find((n) => n.title === 'Your profile changes were not approved')!.body).toContain('Name does not match');
  });

  it('merges repeated edits into one request, ignores unchanged values and lets the owner withdraw', async () => {
    const o = await approvedOwner();
    const cur = (await myProfile(o)).profile;
    expect((await putProfile(o, { businessName: cur.business_name }).expect(200)).body.pending).toBe(false); // same value: nothing to approve
    await putProfile(o, { businessName: 'First Edit' }).expect(202);
    await putProfile(o, { address: '1 Second Edit Road' }).expect(202);
    const mine = (await queue()).filter((c) => c.owner_id === o.id);
    expect(mine).toHaveLength(1); expect(mine[0].changes.map((c: any) => c.field).sort()).toEqual(['address', 'business_name']);
    await request(env.app).delete('/api/owner/profile/change').set(o.auth).expect(204);
    expect((await myProfile(o)).pendingChange).toBeNull(); expect((await queue()).filter((c) => c.owner_id === o.id)).toHaveLength(0);
    await request(env.app).delete('/api/owner/profile/change').set(o.auth).expect(404);
  });

  it('masks the account number for the admin and resets bank verification only when approved', async () => {
    const o = await approvedOwner();
    await putProfile(o, { bankAccountName: 'Test Sports', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }).expect(202);
    const ch = (await queue()).find((c) => c.owner_id === o.id)!;
    expect(JSON.stringify(ch)).not.toContain('123456789012'); expect(ch.changes.find((c: any) => c.field === 'bank_account_number').proposed).toBe('••••••••9012');
    expect(JSON.stringify(await myProfile(o))).not.toContain('123456789012');
    await request(env.app).post(`/api/admin/profile-changes/${ch.id}/approve`).set(sa.auth).expect(200);
    const row = (await env.db.query('SELECT bank_account_number, bank_verified FROM owner_profiles WHERE user_id=$1', [o.id])).rows[0];
    expect(row).toMatchObject({ bank_account_number: '123456789012', bank_verified: false }); // finance still verifies before any payout
  });

  it('an owner who is not approved yet cannot edit through this endpoint (their application is reviewed instead)', async () => {
    const o = await registerUser(env, 'owner');
    await putProfile(o, { businessName: 'Early Edit' }).expect(403);
    expect((await queue()).filter((c) => c.owner_id === o.id)).toHaveLength(0);
  });

  it('only admins with the users permission can see or decide requests; customers and owners cannot', async () => {
    const o = await approvedOwner(); const c = await registerUser(env, 'customer'); const fin = await createAdmin(env, 'finance'); const ops = await createAdmin(env, 'operations');
    await putProfile(o, { businessName: 'Guarded Name' }).expect(202);
    await request(env.app).get('/api/admin/profile-changes').expect(401);
    await request(env.app).get('/api/admin/profile-changes').set(c.auth).expect(403);
    await request(env.app).get('/api/admin/profile-changes').set(o.auth).expect(403);
    await request(env.app).get('/api/admin/profile-changes').set(fin.auth).expect(403);
    const ch = (await queue(ops)).find((x) => x.owner_id === o.id)!;
    await request(env.app).post(`/api/admin/profile-changes/${ch.id}/approve`).set(o.auth).expect(403); // an owner cannot approve their own change
    await request(env.app).post(`/api/admin/profile-changes/${ch.id}/approve`).set(ops.auth).expect(200);
  });
});
