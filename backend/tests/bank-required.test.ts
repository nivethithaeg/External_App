import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); });
const venue = { name: 'Bank Test Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038', lat: 12.97, lng: 77.59 };
const bank = { accountName: 'Mehta Sports', accountNumber: '123456789012', ifsc: 'hdfc0001234' };
const owner = async () => { const o = await registerUser(env, 'owner'); await request(env.app).post(`/api/admin/owners/${o.id}/verification`).set(admin.auth).send({ status: 'verified' }).expect(200); return o; };
const create = (o: any, body: object) => request(env.app).post('/api/owner/venues').set(o.auth).send(body);

const saveBank = (o: any, body: object = bank) => request(env.app).put('/api/owner/profile').set(o.auth).send({ bankAccountName: body['accountName' as keyof typeof body], bankAccountNumber: body['accountNumber' as keyof typeof body], bankIfsc: String(body['ifsc' as keyof typeof body]).toUpperCase() });

describe('the bank account comes first: nothing can be added or changed until it is saved', () => {
  it('an approved owner without a bank account can look at everything but every add or change says to add the bank account', async () => {
    const o = await owner();
    for (const path of ['/api/owner/venues', '/api/owner/overview', '/api/owner/areas', '/api/owner/bookings']) await request(env.app).get(path).set(o.auth).expect(200);
    for (const [method, path] of [['post', '/api/owner/venues'], ['post', '/api/owner/customers'], ['post', '/api/owner/staff'], ['put', '/api/owner/areas/00000000-0000-4000-8000-000000000000']] as const) {
      const r = await (request(env.app) as any)[method](path).set(o.auth).send(path.endsWith('venues') ? venue : {}).expect(403);
      expect(r.body.error.code, path).toBe('bank_required');
    }
    expect((await env.db.query('SELECT 1 FROM venues WHERE owner_id=$1', [o.id])).rows).toHaveLength(0); // nothing was created
  });

  it('the venue form no longer asks for bank details: a venue is created as soon as the bank account is saved elsewhere', async () => {
    const o = await owner();
    await create(o, venue).expect(403);
    await saveBank(o).expect(200);
    await create(o, venue).expect(201);
    await create(o, { ...venue, name: 'Second Arena' }).expect(201);
  });

  it('saves the first account at once (not yet verified) and tells finance to verify; the format is checked', async () => {
    const o = await owner();
    await saveBank(o, { ...bank, accountNumber: '12ab' }).expect(400);
    await saveBank(o, { ...bank, ifsc: 'NOPE' }).expect(400);
    await saveBank(o).expect(200);
    const row = (await env.db.query('SELECT bank_account_name, bank_account_number, bank_ifsc, bank_verified FROM owner_profiles WHERE user_id=$1', [o.id])).rows[0];
    expect(row).toMatchObject({ bank_account_name: 'Mehta Sports', bank_account_number: '123456789012', bank_ifsc: 'HDFC0001234', bank_verified: false });
    const note = await env.db.query(`SELECT 1 FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.role='admin' AND n.title='New owner bank details to verify'`);
    expect(note.rows.length).toBeGreaterThan(0);
  });

  it('a later change to the saved account waits for approval; the live account keeps being used', async () => {
    const o = await owner(); await saveBank(o).expect(200);
    const r = await saveBank(o, { ...bank, accountNumber: '555555555555' }).expect(202);
    expect(r.body.pending).toBe(true);
    expect((await env.db.query('SELECT bank_account_number FROM owner_profiles WHERE user_id=$1', [o.id])).rows[0].bank_account_number).toBe('123456789012');
  });
  it('the admin can look at the full account number before verifying it, and every look is audited; the list only carries the masked one', async () => {
    const o = await owner();
    await request(env.app).get(`/api/admin/owners/${o.id}/bank`).set(admin.auth).expect(400); // nothing added yet
    await saveBank(o).expect(200);
    const list = (await request(env.app).get('/api/admin/owners').set(admin.auth).expect(200)).body.owners.find((x: any) => x.id === o.id);
    expect(list.bank_account_masked).toBe('••••••••9012'); expect(JSON.stringify(list)).not.toContain('123456789012');
    const full = (await request(env.app).get(`/api/admin/owners/${o.id}/bank`).set(admin.auth).expect(200)).body.bank;
    expect(full).toMatchObject({ accountName: 'Mehta Sports', accountNumber: '123456789012', ifsc: 'HDFC0001234', verified: false });
    expect((await env.db.query(`SELECT 1 FROM audit_logs WHERE action='bank.viewed' AND entity_id=$1`, [o.id])).rows.length).toBe(1);
    await request(env.app).get(`/api/admin/owners/${o.id}/bank`).set(o.auth).expect(403); // owners cannot use the admin route
  });
});
