import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, registerUser, setup, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
const inbox = async (a: { auth: any }) => (await request(env.app).get('/api/me/notifications?limit=50').set(a.auth).expect(200)).body.notifications as any[];

describe('admin alerts for owner activity', () => {
  it('alerts the right admins at every step of onboarding, and not the wrong ones', async () => {
    const superA = await createAdmin(env, 'super_admin'), ops = await createAdmin(env, 'operations'), fin = await createAdmin(env, 'finance'), sup = await createAdmin(env, 'support');
    const fx = await createApprovedVenue(env, superA); // register owner, create venue, area, upload doc, submit
    await request(env.app).put('/api/owner/profile').set(fx.owner.auth).send({ bankAccountName: 'Test', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }).expect(202);
    await request(env.app).post('/api/owner/coupons').set(fx.owner.auth).send({ code: 'OWNER10', venueId: fx.venue.id, discountType: 'percent', value: 10, validTo: new Date(Date.now() + 86400000 * 5).toISOString() }).expect(201);
    await request(env.app).post('/api/me/tickets').set(fx.owner.auth).send({ subject: 'Payout question', message: 'When is my payout?' }).expect(201);

    const types = async (a: any) => (await inbox(a)).map((n) => n.type);
    const s = await types(superA);
    for (const t of ['admin_owner_registered', 'admin_venue_created', 'admin_area_created', 'admin_document_uploaded', 'admin_venue_submitted', 'admin_bank_changed', 'admin_coupon_created', 'admin_ticket_created']) expect(s, t).toContain(t);

    const o = await types(ops); // operations: users, venues, coupons, tickets (not payouts)
    expect(o).toEqual(expect.arrayContaining(['admin_owner_registered', 'admin_venue_submitted', 'admin_coupon_created', 'admin_ticket_created']));
    expect(o).not.toContain('admin_bank_changed');
    const f = await types(fin); // finance: payouts only
    expect(f).toContain('admin_bank_changed'); expect(f).not.toContain('admin_venue_submitted'); expect(f).not.toContain('admin_owner_registered');
    const su = await types(sup); // support: tickets only
    expect(su).toContain('admin_ticket_created'); expect(su).not.toContain('admin_venue_created');
  });

  it('emails admins when a playing area is created, with a button to the area approvals page', async () => {
    const a = await createAdmin(env, 'super_admin');
    const fx = await createApprovedVenue(env, a);
    const before = env.emails.length;
    await request(env.app).post(`/api/owner/venues/${fx.venue.id}/areas`).set(fx.owner.auth).send({ name: 'Mail Court', sportIds: [1], slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 120, defaultPrice: 900 }).expect(201);
    const mail = env.emails.slice(before).find((m) => m.subject === 'Playing area awaiting approval' && m.to === a.email);
    expect(mail, 'admin email').toBeTruthy();
    expect(mail!.html).toContain('Mail Court'); expect(mail!.html).toContain('/admin/area-approvals'); expect(mail!.html).toContain('Open in admin portal');
  });

  it('includes a link to the relevant admin page and the owner’s own name', async () => {
    const a = await createAdmin(env, 'super_admin');
    const o = await registerUser(env, 'owner', { name: 'Meera Nair' }); await approveOwner(env, a, o);
    await request(env.app).post('/api/owner/venues').set(o.auth).send({ pincode: '560001', name: 'Alert Arena', address: '5 Test Street', city: 'Chennai', lat: 13.0, lng: 80.2 }).expect(201);
    const n = (await inbox(a)).find((x) => x.type === 'admin_venue_created' && x.body.includes('Alert Arena'))!;
    expect(n.body).toContain('Meera Nair'); expect(n.data.link).toBe('/admin/venues?status=draft'); expect(n.read_at).toBeNull();
  });

  it('does not alert admins who are disabled, owners, or customers', async () => {
    const off = await createAdmin(env, 'super_admin');
    await env.db.query('UPDATE users SET is_active=false WHERE id=$1', [off.id]);
    const before = (await env.db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1', [off.id])).rows[0].n;
    const bystander = await registerUser(env, 'customer');
    await registerUser(env, 'owner');
    expect((await env.db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1', [off.id])).rows[0].n).toBe(before);
    expect((await inbox(bystander)).filter((n) => n.type.startsWith('admin_'))).toEqual([]);
  });

  it('customer support tickets alert admins too, and a failed alert never breaks the owner’s request', async () => {
    const a = await createAdmin(env, 'super_admin');
    const c = await registerUser(env, 'customer');
    await request(env.app).post('/api/me/tickets').set(c.auth).send({ subject: 'Refund missing', message: 'Where is my refund?' }).expect(201);
    expect((await inbox(a)).some((n) => n.type === 'admin_ticket_created' && n.title.includes('customer'))).toBe(true);
    const real = env.ctx.db.query.bind(env.ctx.db);
    (env.ctx.db as any).query = async (sql: string, p?: unknown[]) => { if (/role='admin' AND is_active/.test(sql)) throw new Error('db hiccup'); return real(sql, p); };
    try {
      const o = await registerUser(env, 'owner'); await approveOwner(env, a, o);
      await request(env.app).post('/api/owner/venues').set(o.auth).send({ pincode: '560001', name: 'Resilient Turf', address: '9 Test Street', city: 'Pune', lat: 18.5, lng: 73.8 }).expect(201);
    } finally { (env.ctx.db as any).query = real; }
  });
});

