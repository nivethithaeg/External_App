import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, dateIn, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
import { runMaintenance } from '../src/lib/bookings.js';

let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>; let fx: Awaited<ReturnType<typeof createApprovedVenue>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); fx = await createApprovedVenue(env, admin); });
const setCity = (uid: string, city: string) => env.db.query(`INSERT INTO customer_profiles (user_id, city) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET city=$2`, [uid, city]);

describe('banners and announcements by city', () => {
  it('shows a city banner only to people in that city, and everyone the global ones', async () => {
    await env.db.query(`INSERT INTO banners (title, image_url, city) VALUES ('Everywhere', 'http://x/a.png', NULL), ('Erode only', 'http://x/b.png', 'Erode'), ('Chennai only', 'http://x/c.png', 'Chennai')`);
    const titles = async (req: request.Test) => ((await req.expect(200)).body.banners as any[]).map((b) => b.title);
    expect(await titles(request(env.app).get('/api/banners'))).toEqual(['Everywhere']); // anonymous: global only
    expect(await titles(request(env.app).get('/api/banners').query({ city: 'erode' }))).toEqual(['Erode only', 'Everywhere'].sort((a, b) => (a === 'Everywhere' ? 1 : -1))); // case-insensitive, city banners first
    const c = await registerUser(env, 'customer'); await setCity(c.id, 'Chennai');
    expect((await titles(request(env.app).get('/api/banners').set(c.auth))).sort()).toEqual(['Chennai only', 'Everywhere']); // a signed-in customer gets their own city
    expect((await titles(request(env.app).get('/api/banners').set(c.auth).query({ city: 'Erode' }))).sort()).toEqual(['Erode only', 'Everywhere']); // an explicit city wins
  });

  it('sends a broadcast only to customers (or owners) in the chosen city', async () => {
    const a = await registerUser(env, 'customer'); const b = await registerUser(env, 'customer'); await setCity(a.id, 'Coimbatore'); await setCity(b.id, 'Madurai');
    const send = (body: object) => request(env.app).post('/api/admin/notifications/broadcast').set(admin.auth).send({ title: 'Weekend offer', body: 'Book now', ...body });
    const r = await send({ audience: 'customers', city: 'coimbatore' }).expect(200); expect(r.body.recipients).toBe(1);
    const got = async (uid: string) => (await env.db.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='announcement' AND title='Weekend offer'`, [uid])).rows.length;
    expect(await got(a.id)).toBe(1); expect(await got(b.id)).toBe(0);
    const owners = await send({ audience: 'owners', city: 'Bengaluru' }).expect(200); expect(owners.body.recipients).toBe(1); // the fixture owner's venue is in Bengaluru
    expect((await send({ audience: 'customers', city: 'Nowhere' }).expect(200)).body.recipients).toBe(0);
  });
});

describe('notification preferences', () => {
  it('defaults to everything on, saves changes, and rejects nonsense', async () => {
    const c = await registerUser(env, 'customer');
    expect((await request(env.app).get('/api/me/notification-preferences').set(c.auth).expect(200)).body.preferences).toEqual({ bookings: true, reminders: true, announcements: true, venue_updates: true });
    const r = await request(env.app).put('/api/me/notification-preferences').set(c.auth).send({ reminders: false }).expect(200);
    expect(r.body.preferences).toEqual({ bookings: true, reminders: false, announcements: true, venue_updates: true });
    expect((await request(env.app).get('/api/me/notification-preferences').set(c.auth).expect(200)).body.preferences.reminders).toBe(false);
    await request(env.app).put('/api/me/notification-preferences').set(c.auth).send({ reminders: 'no' }).expect(400);
    await request(env.app).get('/api/me/notification-preferences').expect(401);
  });

  it('stops the email for a switched-off category, but keeps the in-app alert, and leaves other categories alone', async () => {
    const off = await registerUser(env, 'customer'); const on = await registerUser(env, 'customer');
    await request(env.app).put('/api/me/notification-preferences').set(off.auth).send({ reminders: false }).expect(200);
    const date = dateIn(45); const hour = 3600000;
    for (const c of [off, on]) { const r = await startBooking(env, c, fx, ist(date, c === off ? '10:00' : '12:00')); await pay(env, c, r.booking.body.bookingId, r.booking.body.order.id); }
    const sentTo = (email: string, subject: string) => env.emails.filter((m: any) => m.to === email && String(m.subject).includes(subject)).length;
    expect(sentTo(off.email, 'Booking confirmed')).toBeGreaterThan(0); // the booking email category is still on
    env.clock.offsetMs = new Date(ist(date, '10:00')).getTime() - 23 * hour - Date.now(); await runMaintenance(env.ctx);
    const inApp = async (uid: string) => (await env.db.query(`SELECT 1 FROM notifications WHERE user_id=$1 AND type='booking_reminder'`, [uid])).rows.length;
    expect(await inApp(off.id)).toBe(1); expect(sentTo(off.email, 'Your game is tomorrow')).toBe(0); // in-app yes, email no
    env.clock.offsetMs = new Date(ist(date, '12:00')).getTime() - 23 * hour - Date.now(); await runMaintenance(env.ctx);
    expect(await inApp(on.id)).toBe(1); expect(sentTo(on.email, 'Your game is tomorrow')).toBe(1);
    env.clock.offsetMs = 0;
  });
});
