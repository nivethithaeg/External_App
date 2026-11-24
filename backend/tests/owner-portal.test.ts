import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { approveOwner, createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
let other: Awaited<ReturnType<typeof registerUser>>;
beforeAll(async () => {
  env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin);
  other = await registerUser(env, 'owner'); await approveOwner(env, admin, other);
  const c = await registerUser(env, 'customer');
  const r = await startBooking(env, c, fx, ist(dateIn(3), '18:00'));
  await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
});
const get = (url: string, who = fx.owner) => request(env.app).get(`/api/owner${url}`).set(who.auth);

describe('overview', () => {
  it('reports real figures computed from the owner’s own data', async () => {
    const o = (await get('/overview').expect(200)).body;
    expect(o.counts).toMatchObject({ venues: 1, active_venues: 1, areas: 1, active_areas: 1 });
    expect(o.upcoming).toBe(1);
    expect(o.nextBookings).toHaveLength(1);
    expect(o.statusBreakdown).toEqual([{ status: 'confirmed', n: 1 }]);
    expect(o.revenue.month.length + o.revenue.day.length).toBeGreaterThan(0);
    expect(o.recentTransactions[0]).toMatchObject({ status: 'captured', amount: 1200 });
    expect(o.popularAreas[0]).toMatchObject({ name: 'Turf A', bookings: 1 });
    expect(o.venues[0].status).toBe('approved');
    expect(o.slots.total).toBeGreaterThan(0);
    expect(o.slots.occupancyPct).toBeGreaterThanOrEqual(0);
  });
  it('shows nothing for an owner with no venues (no fabricated numbers)', async () => {
    const o = (await get('/overview', other).expect(200)).body;
    expect(o.counts).toMatchObject({ venues: 0, areas: 0 });
    expect(o.today).toMatchObject({ bookings: 0, revenue: 0 });
    expect(o.nextBookings).toEqual([]); expect(o.recentTransactions).toEqual([]); expect(o.slots.total).toBe(0);
  });
  it('is not available to customers or anonymous users', async () => {
    const c = await registerUser(env, 'customer');
    await request(env.app).get('/api/owner/overview').set(c.auth).expect(403);
    await request(env.app).get('/api/owner/overview').expect(401);
  });
});

describe('listings are scoped to the owner', () => {
  it('areas, media, documents, bookings and refunds only include own records', async () => {
    expect((await get('/areas')).body.areas).toHaveLength(1);
    expect((await get('/media')).body.media).toHaveLength(2); // the venue photo and the geo-tagged video
    expect((await get('/documents')).body.documents).toHaveLength(2); // the electricity bill and the land proof
    for (const p of ['/areas', '/media', '/documents', '/blocks', '/refunds']) {
      const body = (await get(p, other).expect(200)).body; expect(Object.values(body)[0]).toEqual([]);
    }
  });
});

describe('bookings & transactions filters', () => {
  it('filters by view, search, status and paginates with a total', async () => {
    const upcoming = (await get('/bookings?view=upcoming').expect(200)).body;
    expect(upcoming.total).toBe(1); expect(upcoming.bookings[0].customer_name).toBeTruthy(); expect(upcoming.bookings[0]).toHaveProperty('payment_status', 'captured');
    expect((await get('/bookings?view=history').expect(200)).body.total).toBe(0);
    expect((await get('/bookings?view=cancelled').expect(200)).body.total).toBe(0);
    const ref = upcoming.bookings[0].reference;
    expect((await get('/bookings?q=' + ref.slice(0, 5).toLowerCase()).expect(200)).body.total).toBe(1);
    expect((await get('/bookings?q=nobody-here').expect(200)).body.total).toBe(0);
    expect((await get('/bookings?payment=failed').expect(200)).body.total).toBe(0);
    expect((await get('/bookings?status=confirmed&sportId=' + fx.football.id + '&areaId=' + fx.area.id).expect(200)).body.total).toBe(1);
    expect((await get('/bookings?limit=1&page=2').expect(200)).body.bookings).toHaveLength(0);
    expect((await get('/bookings?view=upcoming', other).expect(200)).body.total).toBe(0); // other owner sees nothing
    await get('/bookings?view=bogus').expect(400);
  });
  it('searches transactions and exposes fee, discount and earnings', async () => {
    const t = (await get('/transactions').expect(200)).body;
    expect(t.total).toBe(1);
    expect(t.transactions[0]).toMatchObject({ status: 'captured', subtotal: 1200, commission_amount: 120, owner_amount: 1080 });
    expect(t.transactions[0].transaction_id).toBeTruthy();
    expect((await get('/transactions?status=failed').expect(200)).body.total).toBe(0);
    expect((await get('/transactions?q=zzzz').expect(200)).body.total).toBe(0);
    expect((await get('/transactions', other).expect(200)).body.total).toBe(0);
  });
});

describe('calendar & blocking', () => {
  const range = (d: string) => `?from=${encodeURIComponent(ist(d, '00:00'))}&to=${encodeURIComponent(ist(d, '23:59'))}`;
  it('returns bookings and blocks in range, hiding other owners’ data', async () => {
    const day = dateIn(3);
    const mine = (await get(`/calendar${range(day)}`).expect(200)).body.items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'confirmed', area_name: 'Turf A' });
    expect((await get(`/calendar${range(day)}`, other).expect(200)).body.items).toEqual([]);
    await get(`/calendar?from=${encodeURIComponent(ist(dateIn(3), '00:00'))}&to=${encodeURIComponent(ist(dateIn(90), '00:00'))}`).expect(400);
  });
  it('bulk-blocks several days/weeks, reports conflicts with existing bookings, and tags maintenance', async () => {
    const res = await request(env.app).post('/api/owner/blocks/bulk').set(fx.owner.auth).send({
      areaIds: [fx.area.id], startsAt: ist(dateIn(3), '17:00'), endsAt: ist(dateIn(3), '19:00'), kind: 'maintenance', reason: 'Turf re-laying', repeatWeeks: 1,
    }).expect(201);
    expect(res.body.created).toBe(1); // week 0 overlaps the confirmed 18:00 booking; week 1 is free
    expect(res.body.conflicts).toHaveLength(1);
    const blocks = (await get('/blocks').expect(200)).body.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'maintenance', reason: 'Turf re-laying' });
    const slots = await request(env.app).get(`/api/areas/${fx.area.id}/slots?date=${dateIn(10)}&sportId=${fx.football.id}&duration=60`).expect(200);
    expect(slots.body.slots.find((s: any) => s.startsAt === new Date(ist(dateIn(10), '17:00')).toISOString()).reason).toBe('blocked');
    await request(env.app).post('/api/owner/blocks/bulk').set(fx.owner.auth).send({ areaIds: [fx.area.id], startsAt: ist(dateIn(3), '18:00'), endsAt: ist(dateIn(3), '19:00') }).expect(409);
  });
  it('refuses to block another owner’s area', async () => {
    await request(env.app).post('/api/owner/blocks/bulk').set(other.auth).send({ areaIds: [fx.area.id], startsAt: ist(dateIn(20), '10:00'), endsAt: ist(dateIn(20), '11:00') }).expect(403);
  });
});

describe('analytics, settlements & refunds', () => {
  it('computes analytics from real bookings only', async () => {
    const q = `?from=${dateIn(-1)}&to=${dateIn(10)}`;
    const a = (await get(`/analytics${q}`).expect(200)).body;
    expect(a.summary).toMatchObject({ total: 1, confirmed: 1, gross: 1200, cancelled: 0 });
    expect(a.summary.net).toBeCloseTo(1080); // 10% platform commission
    expect(a.summary.avg_value).toBe(1200);
    expect(a.byVenue[0]).toMatchObject({ name: 'Green Arena', bookings: 1 });
    expect(a.bySport[0]).toMatchObject({ name: 'Football' });
    expect(a.peakHours[0].hour).toBe(18);
    expect(a.summary.occupancyPct).toBeGreaterThan(0);
    const csv = await get(`/analytics${q}&format=csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/csv/);
    expect((await get(`/analytics${q}`, other).expect(200)).body.summary.total).toBe(0);
    await get(`/analytics?from=2020-01-01&to=2026-01-01`).expect(400);
  });
  it('lists refunds after a cancellation and keeps pending payments out of revenue', async () => {
    const c = await registerUser(env, 'customer');
    const r = await startBooking(env, c, fx, ist(dateIn(30), '10:00'));
    const before = (await get('/analytics?from=' + dateIn(29) + '&to=' + dateIn(31))).body.summary.gross;
    expect(before).toBe(0); // pending (unpaid) booking is not revenue
    await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id);
    await request(env.app).post(`/api/bookings/${r.booking.body.bookingId}/cancel`).set(c.auth).send({}).expect(200);
    const refunds = (await get('/refunds').expect(200)).body.refunds;
    expect(refunds[0]).toMatchObject({ status: 'processed', amount: 800, cancellation_hours: 24 });
    expect(refunds[0].razorpay_payment_id).toMatch(/^…/); // masked
  });
  it('masks bank details, requires verification after a change, and gates payouts on it', async () => {
    const sa = await createAdmin(env, 'super_admin');
    await env.db.query(`UPDATE owner_profiles SET bank_account_name=NULL, bank_account_number=NULL, bank_ifsc=NULL WHERE user_id=$1`, [fx.owner.id]); // this test is about a first-time bank entry
    const approveChange = async () => { const ch = (await request(env.app).get('/api/admin/profile-changes').set(sa.auth).expect(200)).body.changes.find((c: any) => c.owner_id === fx.owner.id); await request(env.app).post(`/api/admin/profile-changes/${ch.id}/approve`).set(sa.auth).expect(200); };
    await request(env.app).put('/api/owner/profile').set(fx.owner.auth).send({ bankAccountName: 'Test Sports', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }).expect(200); // the first bank account is saved at once
    expect((await get('/bank').expect(200)).body.accountNumber).toBe('••••••••9012'); // and is live (masked) straight away
    const s = (await get('/settlements').expect(200)).body;
    expect(s.bank).toMatchObject({ accountNumber: '••••••••9012', ifsc: 'HDFC0001234', verified: false });
    expect(JSON.stringify(s)).not.toContain('123456789012');
    expect(JSON.stringify((await request(env.app).get('/api/me/profile').set(fx.owner.auth)).body)).not.toContain('123456789012');
    const payout = { ownerId: fx.owner.id, amount: 100, periodStart: dateIn(-30), periodEnd: dateIn(0) };
    const fin = await createAdmin(env, 'finance');
    expect((await request(env.app).post('/api/admin/payouts').set(fin.auth).send(payout)).body.error.code).toBe('bank_unverified');
    await request(env.app).post(`/api/admin/owners/${fx.owner.id}/bank-verification`).set(fin.auth).send({ verified: true }).expect(200);
    await env.db.query(`UPDATE bookings SET status='completed', during=tstzrange(now() - interval '10 days', now() - interval '10 days' + interval '1 hour')
                          WHERE id = (SELECT b.id FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status='confirmed' AND b.source='online' LIMIT 1)`, [fx.owner.id]); // played long ago, so its money is released
    await request(env.app).post('/api/admin/payouts').set(fin.auth).send(payout).expect(201);
    expect((await get('/settlements')).body.summary.pending).toBe(100);
    await request(env.app).put('/api/owner/profile').set(fx.owner.auth).send({ bankAccountNumber: '999999999999' }).expect(202);
    expect((await get('/bank')).body).toMatchObject({ verified: true, accountNumber: '••••••••9012' }); // the approved account stays live until the change is approved
    await approveChange();
    expect((await get('/bank')).body).toMatchObject({ verified: false, accountNumber: '••••••••9999' }); // changing the account resets verification
  });
});

describe('pricing history & security', () => {
  it('records a before/after history whenever pricing changes', async () => {
    await request(env.app).put(`/api/owner/areas/${fx.area.id}/pricing`).set(fx.owner.auth).send({ rules: [{ startTime: '06:00', endTime: '23:00', pricePerHour: 900 }] }).expect(204);
    const h = (await get('/pricing/history').expect(200)).body.history;
    expect(h).toHaveLength(2); // initial setup + this change, newest first
    expect(h[0].metadata.before).toHaveLength(2); expect(h[0].metadata.after[0].pricePerHour).toBe(900); expect(h[1].metadata.before).toEqual([]);
  });
  it('shows login history and signs other sessions out on logout-all / password change', async () => {
    const o = await registerUser(env, 'owner'); await approveOwner(env, admin, o);
    const login = await request(env.app).post('/api/auth/login').send({ email: o.email, password: 'Passw0rdTest' }).expect(200);
    const hist = (await get('/security/login-history', o).expect(200)).body.events;
    expect(hist[0].action).toBe('user.login');
    const oldToken = login.body.token;
    const all = await request(env.app).post('/api/auth/logout-all').set({ Authorization: `Bearer ${oldToken}` }).expect(200);
    await request(env.app).get('/api/auth/me').set({ Authorization: `Bearer ${oldToken}` }).expect(401); // other session is dead
    const fresh = { Authorization: `Bearer ${all.body.token}` };
    await request(env.app).get('/api/auth/me').set(fresh).expect(200);
    const ch = await request(env.app).post('/api/auth/change-password').set(fresh).send({ currentPassword: 'Passw0rdTest', newPassword: 'NewPassw0rd9' }).expect(200);
    await request(env.app).get('/api/auth/me').set(fresh).expect(401);
    await request(env.app).get('/api/auth/me').set({ Authorization: `Bearer ${ch.body.token}` }).expect(200);
  });
  it('filters notifications by type for the Announcements page', async () => {
    await request(env.app).post('/api/admin/notifications/broadcast').set(admin.auth).send({ audience: 'owners', title: 'Fee update', body: 'New season rates' }).expect(200);
    const a = (await request(env.app).get('/api/me/notifications?type=announcement').set(fx.owner.auth).expect(200)).body.notifications;
    expect(a.length).toBeGreaterThan(0); expect(a.every((n: any) => n.type === 'announcement')).toBe(true);
  });
});

