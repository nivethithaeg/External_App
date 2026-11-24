import { PGlite, types } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import request from 'supertest';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { createRazorpayGateway, type PaymentGateway } from '../src/lib/payments.js';
import { createNotifier } from '../src/lib/notify.js';
import type { Ctx } from '../src/types.js';
import { noopRealtime } from '../src/lib/realtime.js';

export const WEBHOOK_SECRET = 'whsec_test';
export const KEY_SECRET = 'rzp_secret_test';

export async function createPgliteDb(): Promise<Db> {
  const pg = new PGlite({ extensions: { btree_gist }, parsers: { [types.NUMERIC]: (v: string) => parseFloat(v), [types.INT8]: (v: string) => parseInt(v, 10) } });
  const wrap = (x: any) => ({ async query(text: string, params?: unknown[]) { const r = await x.query(text, params); return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length }; } });
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    exec: async (sql) => { await pg.exec(sql); },
    close: () => pg.close(),
  } as Db;
}

export interface TestEnv {
  ctx: Ctx; app: ReturnType<typeof createApp>; db: Db; clock: { offsetMs: number };
  emails: { to: string; subject: string; html: string }[];
  sms: { to: string; message: string }[];
  gatewayCalls: { orders: any[]; refunds: any[]; failRefund: boolean };
}

const privateFiles = new Map<string, { data: Buffer; contentType: string }>();
export async function setup(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const cfg = loadConfig({
    NODE_ENV: 'test', REQUIRE_AREA_GEOTAG: 'false', REQUIRE_LIVE_AREA_PHOTOS: 'false', GEOCODE_URL: '', ...overrides, JWT_SECRET: 'x'.repeat(40), RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  } as any);
  const db = await createPgliteDb();
  await migrate(db);
  const emails: TestEnv['emails'] = [];
  const clock = { offsetMs: 0 };
  const gatewayCalls = { orders: [] as any[], refunds: [] as any[], failRefund: false };
  const real = createRazorpayGateway(cfg);
  const gateway: PaymentGateway = {
    ...real,
    async createOrder(amount, receipt) { const o = { id: `order_${gatewayCalls.orders.length + 1}_${crypto.randomUUID().slice(0, 6)}`, amount, currency: 'INR' }; gatewayCalls.orders.push({ ...o, receipt }); return o; },
    async refund(paymentId, amount) {
      if (gatewayCalls.failRefund) throw new Error('gateway down');
      const r = { id: `rfnd_${gatewayCalls.refunds.length + 1}`, status: 'processed' }; gatewayCalls.refunds.push({ paymentId, amount }); return r;
    },
  };
  const mailer = { async send(to: string, subject: string, html: string) { emails.push({ to, subject, html }); } };
  const smsLog: TestEnv['sms'] = [];
  const sms = { async send(to: string, message: string) { smsLog.push({ to, message }); } };
  const google = { async verify(t: string) { if (t.startsWith('good:')) return { email: t.slice(5), name: 'Google User' }; throw new Error('bad'); } };
  const base = { db, cfg, google, gateway, mailer, sms, realtime: noopRealtime, now: () => new Date(Date.now() + clock.offsetMs) };
  const ctx: Ctx = {
    ...base, storage: {
      async upload(folder, _n, _d, ct) { return `https://files.test/${folder}/${crypto.randomUUID()}.${ct.split('/')[1]}`; },
      async putPrivate(folder, data, ct) { const k = `${folder}/${crypto.randomUUID()}`; privateFiles.set(k, { data, contentType: ct }); return k; },
      async getPrivate(k) { const f = privateFiles.get(k); if (!f) throw new Error('missing'); return f; },
    },
    notifier: createNotifier(db, noopRealtime, mailer, { async send() { return []; } }),
  };
  return { ctx, app: createApp(ctx), db, clock, emails, sms: smsLog, gatewayCalls };
}

let seq = 0;
export const uniq = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

export async function registerUser(env: TestEnv, role: 'customer' | 'owner', opts: { verified?: boolean; name?: string } = {}) {
  const email = `${uniq(role)}@test.dev`;
  const res = await request(env.app).post('/api/auth/register').send({
    email, password: 'Passw0rdTest', fullName: opts.name ?? `Test ${role}`, role, phone: `+91${String(9000000000 + Math.floor(Math.random() * 999999999))}`, ...(role === 'owner' ? { businessName: 'Test Sports Pvt' } : {}),
  });
  if (res.status !== 201) throw new Error('register failed: ' + JSON.stringify(res.body));
  if (opts.verified !== false) await env.db.query('UPDATE users SET email_verified=true WHERE id=$1', [res.body.user.id]);
  return { id: res.body.user.id as string, email, token: res.body.token as string, auth: { Authorization: `Bearer ${res.body.token}` } };
}

export async function createAdmin(env: TestEnv, adminRole = 'super_admin') {
  const email = `${uniq('admin')}@test.dev`;
  const hash = await bcrypt.hash('AdminPass12345', 4);
  const { rows } = await env.db.query(`INSERT INTO users (email, password_hash, full_name, role, admin_role, email_verified) VALUES ($1,$2,'Admin','admin',$3,true) RETURNING id`, [email, hash, adminRole]);
  const login = await request(env.app).post('/api/auth/login').send({ email, password: 'AdminPass12345' });
  return { id: rows[0].id as string, email, auth: { Authorization: `Bearer ${login.body.token}` } };
}

/** YYYY-MM-DD for N days from today (UTC-based, safe for IST venue as slots are mid-day/evening). */
export function dateIn(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
export const ist = (date: string, hhmm: string) => `${date}T${hhmm}:00+05:30`;

/** Full onboarding: verified owner + approved venue with one area, football+cricket, 6:00-23:00 daily, ₹800 day / ₹1200 evening. */
/** The first bytes of an MP4 video (the server recognises files by their content). */
export const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)]);

export async function createApprovedVenue(env: TestEnv, admin: { auth: any }, owner?: Awaited<ReturnType<typeof registerUser>>) {
  const o = owner ?? await registerUser(env, 'owner');
  await approveOwner(env, admin, o);
  const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({
    name: 'Green Arena', address: '12 Park Road, Indiranagar', city: 'Bengaluru', pincode: '560038', lat: 12.9716, lng: 77.5946, cancellationHours: 24,
  }).expect(201)).body.venue;
  const sports = (await request(env.app).get('/api/sports')).body.sports as { id: number; slug: string }[];
  const football = sports.find((s) => s.slug === 'football')!, cricket = sports.find((s) => s.slug === 'cricket')!;
  const area = (await request(env.app).post(`/api/owner/venues/${v.id}/areas`).set(o.auth).send({
    name: 'Turf A', slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 180, sportIds: [football.id, cricket.id], capacity: 14,
  }).expect(201)).body.area;
  await env.db.query(`UPDATE playing_areas SET approval_status='approved' WHERE id=$1`, [area.id]); // the admin has approved the area
  await request(env.app).put(`/api/owner/areas/${area.id}/pricing`).set(o.auth).send({ rules: [
    { startTime: '06:00', endTime: '18:00', pricePerHour: 800 }, { startTime: '18:00', endTime: '23:00', pricePerHour: 1200 },
  ] }).expect(204);
  await request(env.app).put(`/api/owner/areas/${area.id}/availability`).set(o.auth).send({
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: '06:00', closeTime: '23:00' })) }).expect(204);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  await request(env.app).post(`/api/owner/venues/${v.id}/media`).set(o.auth).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
  const doc = (await request(env.app).post(`/api/owner/venues/${v.id}/documents`).set(o.auth).field('docType', 'Electricity bill')
    .attach('file', Buffer.from('%PDF-1.4 test document content'), { filename: 'lease.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
  const land = (await request(env.app).post(`/api/owner/venues/${v.id}/documents`).set(o.auth).field('docType', 'Land proof').attach('file', Buffer.from('%PDF-1.4 land proof content'), { filename: 'land.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
  await request(env.app).post(`/api/owner/venues/${v.id}/media/geo-video`).set(o.auth).field('lat', '12.9716').field('lng', '77.5946').field('accuracy', '20').attach('file', MP4, { filename: 'tour.mp4', contentType: 'video/mp4' }).expect(201);
  await request(env.app).post(`/api/owner/venues/${v.id}/submit`).set(o.auth).expect(200);
  await request(env.app).patch(`/api/admin/documents/${doc.id}`).set(admin.auth).send({ status: 'approved' }).expect(200);
  await request(env.app).patch(`/api/admin/documents/${land.id}`).set(admin.auth).send({ status: 'approved' }).expect(200);
  await request(env.app).post(`/api/admin/venues/${v.id}/decision`).set(admin.auth).send({ decision: 'approve' }).expect(200);
  await request(env.app).post(`/api/owner/venues/${v.id}/publish`).set(o.auth).expect(200); // the owner chooses to show it to customers
  return { owner: o, venue: v, area, football, cricket };
}

export function sign(orderId: string, paymentId: string, secret = KEY_SECRET) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

/** Lock + create booking for a customer. Returns the API responses. */
export async function startBooking(env: TestEnv, c: { auth: any }, f: Awaited<ReturnType<typeof createApprovedVenue>>, startsAt: string, durationMinutes = 60, couponCode?: string) {
  const lock = await request(env.app).post('/api/slots/lock').set(c.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt, durationMinutes });
  if (lock.status !== 201) return { lock, booking: null as any };
  const booking = await request(env.app).post('/api/bookings').set(c.auth).send({ lockId: lock.body.lockId, couponCode });
  return { lock, booking };
}

export async function pay(env: TestEnv, c: { auth: any }, bookingId: string, orderId: string, paymentId = `pay_${uniq('x')}`) {
  return request(env.app).post(`/api/bookings/${bookingId}/verify-payment`).set(c.auth)
    .send({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) });
}

/** Approve an owner account (venue owners cannot add or manage venues until KickOff approves them). */
export async function approveOwner(env: TestEnv, admin: { auth: any }, owner: { id: string }) {
  await request(env.app).post(`/api/admin/owners/${owner.id}/verification`).set(admin.auth).send({ status: 'verified' }).expect(200);
  // a venue cannot be created without payout bank details; tests that are about something else get a default account
  await env.db.query(`UPDATE owner_profiles SET bank_account_name='Test Owner', bank_account_number='999900001111', bank_ifsc='HDFC0001234' WHERE user_id=$1 AND bank_account_number IS NULL`, [owner.id]);
}
