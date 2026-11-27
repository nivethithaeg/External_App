import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { forgetPricedCache } from '../src/middleware/auth.js';
import { approveOwner, createAdmin, createApprovedVenue, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
const dayAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let env: TestEnv;
beforeAll(async () => { env = await setup(); });

const cols = async (t: string) => (await env.db.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [t])).rows.map((r: any) => r.column_name as string);

describe('venue-owner tables carry JusGo names and fields', () => {
  it('has the JusGo table and column names', async () => {
    expect(await cols('playing_area_sports')).toEqual(expect.arrayContaining(['playing_area_id', 'sport_id', 'created_at']));
    expect(await cols('playing_area_hours')).toEqual(expect.arrayContaining(['id', 'playing_area_id', 'day_of_week', 'open_time', 'close_time', 'created_at']));
    expect(await cols('playing_area_hour_exceptions')).toEqual(expect.arrayContaining(['playing_area_id', 'exception_date', 'closed', 'open_time', 'close_time', 'reason']));
    expect(await cols('owner_staff')).toEqual(expect.arrayContaining(['staff_id', 'owner_id', 'status', 'all_venues', 'created_by', 'created_at', 'updated_at', 'last_login_at']));
    expect(await cols('venue_staff')).toEqual(expect.arrayContaining(['id', 'venue_id', 'staff_id', 'created_by', 'created_at'])); // JusGo's venue_staff: which venues a staff login works in
    expect(await cols('staff_permissions')).toEqual(expect.arrayContaining(['staff_id', 'permission_code', 'created_at', 'granted_by', 'granted_at']));
    expect(await cols('staff_permission_catalog')).toEqual(expect.arrayContaining(['code', 'requires', 'is_staff_admin']));
    expect(await cols('owner_profile_change_requests')).toEqual(expect.arrayContaining(['changes', 'previous', 'document_path', 'reason', 'status', 'review_note', 'reviewed_by', 'reviewed_at', 'created_at']));
    expect(await cols('listing_change_requests')).toEqual(expect.arrayContaining(['id', 'entity_type', 'venue_id', 'area_id', 'owner_id', 'requested_by', 'changes', 'fields', 'status', 'review_note']));
    expect(await cols('owner_customers')).toEqual(expect.arrayContaining(['created_by', 'hidden_at']));
    expect(await cols('pricing_date_slots')).toEqual(expect.arrayContaining(['playing_area_id', 'price_date', 'start_time', 'end_time', 'price_per_hour', 'currency', 'status', 'created_by', 'ended_at']));
    expect(await cols('weekly_blocks')).toEqual(expect.arrayContaining(['days_of_week', 'valid_from', 'valid_until', 'event_details', 'removed_by', 'removed_at']));
    expect(await cols('booking_events')).toEqual(expect.arrayContaining(['booking_id', 'event_type', 'actor_id', 'actor_type', 'data']));
    for (const old of ['area_sports', 'availability_rules', 'operating_hour_exceptions', 'owner_profile_changes', 'venue_changes']) expect(await cols(old), old).toEqual([]);
  });

  it('staff permissions are one row each in staff_permissions, checked against the catalogue', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    const st = (await request(env.app).post('/api/owner/staff').set(own).send({ fullName: 'Ravi Kumar', email: 'ravi.staff@example.com', password: 'Passw0rd!xyz', permissions: ['BOOKING_VIEW', 'CHECK_IN'] }).expect(201)).body.staff;
    const rows = async () => (await env.db.query('SELECT permission_code, granted_by FROM staff_permissions WHERE staff_id=$1 ORDER BY permission_code', [st.id])).rows;
    expect((await rows()).map((r: any) => r.permission_code)).toEqual(['BOOKING_VIEW', 'CHECK_IN']);
    expect((await rows())[0].granted_by).toBe(f.owner.id);
    await request(env.app).patch(`/api/owner/staff/${st.id}`).set(own).send({ permissions: ['REPORTS_VIEW'] }).expect(200);
    expect((await rows()).map((r: any) => r.permission_code)).toEqual(['REPORTS_VIEW']);
    const listed = (await request(env.app).get('/api/owner/staff').set(own).expect(200)).body.staff[0];
    expect(listed.permissions).toEqual(['REPORTS_VIEW']);
    expect((await env.db.query('SELECT status, all_venues FROM owner_staff WHERE staff_id=$1', [st.id])).rows[0]).toMatchObject({ status: 'ACTIVE', all_venues: true });
  });

  it('a price for a chosen date beats the weekly prices on that date only; a later save replaces it; default "apply" removes it', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth; const date = dayAhead(9), other = dayAhead(10);
    const price = async (d: string) => (await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date: d, sportId: f.football.id, duration: 60 }).expect(200)).body.slots.find((s: any) => s.startsAt === new Date(ist(d, '10:00')).toISOString()).price;
    expect(await price(date)).toBe(800);
    await request(env.app).put(`/api/owner/areas/${f.area.id}/date-prices`).set(own).send({ entries: [{ date, startTime: '09:00', endTime: '12:00', pricePerHour: 1500 }] }).expect(204);
    expect(await price(date)).toBe(1500); expect(await price(other)).toBe(800);
    await request(env.app).put(`/api/owner/areas/${f.area.id}/date-prices`).set(own).send({ entries: [{ date, startTime: '10:00', endTime: '11:00', pricePerHour: 2000 }] }).expect(204);
    expect(await price(date)).toBe(2000);
    expect((await env.db.query(`SELECT status FROM pricing_date_slots WHERE playing_area_id=$1 ORDER BY created_at, id`, [f.area.id])).rows.map((r: any) => r.status).sort()).toEqual(['ACTIVE', 'SUPERSEDED']);
    const listed = (await request(env.app).get(`/api/owner/areas/${f.area.id}/date-prices`).set(own).expect(200)).body.prices;
    expect(listed).toHaveLength(1); expect(listed[0]).toMatchObject({ date, startTime: '10:00', endTime: '11:00', pricePerHour: 2000 });
    await request(env.app).put(`/api/owner/areas/${f.area.id}/date-prices`).set(own).send({ entries: [{ date, startTime: '10:00', endTime: '09:00', pricePerHour: 100 }] }).expect(400);
    await request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(own).send({ basePrice: 700, applyToAll: true }).expect(200);
    expect(await price(date)).toBe(700);
    expect((await request(env.app).get(`/api/owner/areas/${f.area.id}/date-prices`).set(own).expect(200)).body.prices).toHaveLength(0);
  });

  it('a block over a date range is kept in weekly_blocks and every booking records its events', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ areaIds: [f.area.id], startsAt: ist(dayAhead(5), '10:00'), endsAt: ist(dayAhead(5), '12:00'), reason: 'Coaching camp', weekdays: [0, 1, 2, 3, 4, 5, 6], endDate: dayAhead(7) }).expect(201);
    const wb = (await env.db.query(`SELECT days_of_week, start_time::text AS s, end_time::text AS e, reason, status, valid_from::text AS vf, valid_until::text AS vu FROM weekly_blocks WHERE playing_area_id=$1`, [f.area.id])).rows;
    expect(wb).toHaveLength(1); expect(wb[0]).toMatchObject({ s: '10:00:00', e: '12:00:00', reason: 'Coaching camp', status: 'ACTIVE', vf: dayAhead(5), vu: dayAhead(7) });
    const c = await registerUser(env, 'customer');
    const sb = await startBooking(env, c, f, ist(dayAhead(3), '10:00'));
    await pay(env, c, sb.booking.body.bookingId, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    await request(env.app).post(`/api/owner/bookings/${sb.booking.body.bookingId}/cancel`).set(own).send({ reason: 'Venue closed for repairs' }).expect(200);
    const ev = (await env.db.query(`SELECT event_type FROM booking_events WHERE booking_id=$1 ORDER BY created_at, id`, [sb.booking.body.bookingId])).rows.map((r: any) => r.event_type);
    expect(ev).toEqual(expect.arrayContaining(['CREATED', 'CONFIRMED', 'CANCELLED']));
  });
  it('the playing area keeps JusGo choices: Indoor/Outdoor, an open or closed roof, a round or rectangle shape, 1 to 100 players', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const mk = (b: object) => request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(f.owner.auth).send({ name: 'Court 9', sportIds: [f.football.id], ...b });
    const a = (await mk({ environment: 'indoor', roofType: 'closed', turfShape: 'round', capacity: 100 }).expect(201)).body.area;
    expect(a).toMatchObject({ environment: 'indoor', roof_type: 'closed', turf_shape: 'round', capacity: 100 });
    await mk({ capacity: 101 }).expect(400); await mk({ turfShape: 'oval' }).expect(400); await mk({ roofType: 'glass' }).expect(400);
    const u = (await request(env.app).put(`/api/owner/areas/${a.id}`).set(f.owner.auth).send({ environment: 'outdoor', turfShape: 'rectangle', roofType: 'open' }).expect(200)).body.area;
    expect(u).toMatchObject({ environment: 'outdoor', turf_shape: 'rectangle', roof_type: 'open' });
  });
  it('date-wise hours replace the day-wise hours on their date: closed all day, shorter hours; a day can be open 24 hours', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth; const closed = dayAhead(8), short = dayAhead(9), normal = dayAhead(10);
    const week = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: '06:00', closeTime: '23:00' }));
    await request(env.app).put(`/api/owner/areas/${f.area.id}/availability`).set(own).send({ days: week, exceptions: [
      { date: closed, closed: true, reason: 'Pongal holiday' }, { date: short, closed: false, openTime: '10:00', closeTime: '12:00' }] }).expect(204);
    const slots = async (d: string) => (await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date: d, sportId: f.football.id, duration: 60 }).expect(200)).body.slots as any[];
    expect(await slots(closed)).toHaveLength(0);
    expect((await slots(short)).map((x) => new Date(x.startsAt).toISOString())).toEqual([ist(short, '10:00'), ist(short, '11:00')].map((x) => new Date(x).toISOString()));
    expect((await slots(normal)).length).toBeGreaterThan(10);
    const detail = (await request(env.app).get(`/api/owner/venues/${f.venue.id}`).set(own).expect(200)).body.venue.areas[0].hour_exceptions;
    expect(detail).toEqual(expect.arrayContaining([expect.objectContaining({ date: closed, closed: true, reason: 'Pongal holiday' })]));
    await request(env.app).put(`/api/owner/areas/${f.area.id}/availability`).set(own).send({ days: week, exceptions: [{ date: closed, closed: true }, { date: closed, closed: true }] }).expect(400); // a date twice
    await request(env.app).put(`/api/owner/areas/${f.area.id}/availability`).set(own).send({ days: week.map((d) => ({ ...d, openTime: '00:00', closeTime: '24:00' })), exceptions: [] }).expect(204); // 24 hours, no special dates
    expect((await slots(normal)).length).toBe(24);
    expect(await slots(closed)).toHaveLength(24);
  });
  it('an offline booking keeps the customer city, both opponents with their cities, and an online or offline payment mode', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const r = await request(env.app).post('/api/owner/bookings/offline').set(f.owner.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(dayAhead(6), '10:00'), durationMinutes: 60,
      customerName: 'Ravi Kumar', customerPhone: '9876543210', customerCity: 'Erode', opponent1Name: 'Karthik', opponent1Phone: '9123456780', opponent1City: 'Salem', opponentName: 'Arun', opponentPhone: '9123456781', opponentCity: 'Madurai', paymentMethod: 'online', amountPaid: 300 }).expect(201);
    const row = (await env.db.query(`SELECT walkin_city, opponent1_name, opponent1_city, opponent_name, opponent_city, payment_method, amount_paid::float8 AS paid FROM bookings WHERE id=$1`, [r.body.bookingId])).rows[0];
    expect(row).toMatchObject({ walkin_city: 'Erode', opponent1_name: 'Karthik', opponent1_city: 'Salem', opponent_name: 'Arun', opponent_city: 'Madurai', payment_method: 'online', paid: 300 });
    const cust = (await env.db.query(`SELECT name, city FROM owner_customers WHERE owner_id=$1 AND source='opponent' ORDER BY name`, [f.owner.id])).rows;
    expect(cust).toEqual([{ name: 'Arun', city: 'Madurai' }, { name: 'Karthik', city: 'Salem' }]);
    await request(env.app).post('/api/owner/bookings/offline').set(f.owner.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(dayAhead(6), '12:00'), durationMinutes: 60, customerName: 'Ravi', customerPhone: '9876543210', opponent1Phone: '9123456780' }).expect(400); // an opponent needs a name
  });
  it('a staff login can be created inactive (it cannot sign in) and switched on later; the status follows in owner_staff', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const st = (await request(env.app).post('/api/owner/staff').set(f.owner.auth).send({ fullName: 'Meena Das', email: 'meena.staff@example.com', password: 'Passw0rd!xyz', isActive: false }).expect(201)).body.staff;
    expect(st.is_active).toBe(false);
    expect((await env.db.query('SELECT status FROM owner_staff WHERE staff_id=$1', [st.id])).rows[0].status).toBe('INACTIVE');
    await request(env.app).post('/api/auth/login').send({ email: 'meena.staff@example.com', password: 'Passw0rd!xyz' }).expect(403);
    await request(env.app).patch(`/api/owner/staff/${st.id}`).set(f.owner.auth).send({ isActive: true }).expect(200);
    expect((await env.db.query('SELECT status FROM owner_staff WHERE staff_id=$1', [st.id])).rows[0].status).toBe('ACTIVE');
    await request(env.app).post('/api/auth/login').send({ email: 'meena.staff@example.com', password: 'Passw0rd!xyz' }).expect(200);
  });
  it('a booking the owner made can be edited (details, slot, price, payment), deleted, restored, and a refund recorded when cancelled', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth; const day = dayAhead(12);
    const book = (t: string) => request(env.app).post('/api/owner/bookings/offline').set(own).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(day, t), durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210', customerCity: 'Erode', paymentMethod: 'unpaid' });
    const b = (await book('10:00').expect(201)).body.bookingId;
    const row = async () => (await env.db.query(`SELECT status, walkin_name, walkin_city, notes, total::float8 AS total, amount_paid::float8 AS paid, payment_method, lower(during) AS s, refund_amount::float8 AS refund, refund_mode, deleted_at FROM bookings WHERE id=$1`, [b])).rows[0];
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ customerName: 'Ravi K', customerCity: 'Salem', note: 'birthday' }).expect(200);
    expect(await row()).toMatchObject({ walkin_name: 'Ravi K', walkin_city: 'Salem', notes: 'birthday' });
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ price: 700, payment: { status: 'partial', amountPaid: 300, mode: 'online' } }).expect(200);
    expect(await row()).toMatchObject({ total: 700, paid: 300, payment_method: 'online' });
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ payment: { status: 'partial', amountPaid: 900, mode: 'online' } }).expect(400); // more than the price
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ refund: { amount: 100, mode: 'online' } }).expect(400); // only a cancelled booking
    await book('12:00').expect(201);
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ startsAt: ist(day, '12:00') }).expect(409); // that slot is taken
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ startsAt: ist(day, '14:00') }).expect(200);
    expect(new Date((await row()).s).toISOString()).toBe(new Date(ist(day, '14:00')).toISOString());
    await request(env.app).post(`/api/owner/bookings/${b}/cancel`).set(own).send({ reason: 'Customer called' }).expect(200);
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ refund: { amount: 500 } }).expect(400); // more than the 300 paid, and no mode
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ refund: { amount: 300, mode: 'offline' } }).expect(200);
    expect(await row()).toMatchObject({ status: 'cancelled', refund: 300, refund_mode: 'offline' });
    await request(env.app).post(`/api/owner/bookings/${b}/restore`).set(own).expect(200);
    expect(await row()).toMatchObject({ status: 'confirmed', refund: 0, refund_mode: null });
    await request(env.app).delete(`/api/owner/bookings/${b}`).set(own).send({ reason: 'Entered twice' }).expect(204);
    expect(await row()).toMatchObject({ status: 'cancelled' }); expect((await row()).deleted_at).not.toBeNull();
    const list = (await request(env.app).get('/api/owner/bookings').set(own).expect(200)).body.bookings as any[];
    expect(list.some((x) => x.id === b)).toBe(false); // a deleted booking leaves the list
    await request(env.app).patch(`/api/owner/bookings/${b}`).set(own).send({ note: 'x' }).expect(409);
    await book('14:00').expect(201); // its slot is free again
    await request(env.app).post(`/api/owner/bookings/${b}/restore`).set(own).expect(409); // ...so it cannot come back
    const other = await registerUser(env, 'owner'); await request(env.app).delete(`/api/owner/bookings/${b}`).set(other.auth).expect(403);
  });
  it('an owner has the two JusGo notification switches: booking notifications and venue and playing area updates', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const get = async () => (await request(env.app).get('/api/me/notification-preferences').set(f.owner.auth).expect(200)).body.preferences;
    expect(await get()).toMatchObject({ bookings: true, venue_updates: true });
    await request(env.app).put('/api/me/notification-preferences').set(f.owner.auth).send({ venue_updates: false }).expect(200);
    expect(await get()).toMatchObject({ bookings: true, venue_updates: false });
    const { categoryOf } = await import('../src/lib/notify.js');
    expect([categoryOf('venue_status'), categoryOf('area_status'), categoryOf('booking_new'), categoryOf('announcement')]).toEqual(['venue_updates', 'venue_updates', 'bookings', 'announcements']);
  });
  it('the activity log can be filtered by who did it, the resource and the dates', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    await request(env.app).post('/api/owner/staff').set(f.owner.auth).send({ fullName: 'Gate Keeper', email: 'gate.log@example.com', password: 'Passw0rd!xyz' }).expect(201);
    const log = async (q: object) => (await request(env.app).get('/api/owner/activity').query(q).set(f.owner.auth).expect(200)).body;
    const all = await log({});
    expect(all.resources).toEqual(expect.arrayContaining(['venue']));
    const venues = await log({ resource: 'venue' });
    expect(venues.activity.length).toBeGreaterThan(0); expect(venues.activity.every((a: any) => a.entity === 'venue')).toBe(true);
    expect((await log({ by: 'owner' })).activity.every((a: any) => a.actor_name != null)).toBe(true);
    expect((await log({ by: 'staff' })).activity).toHaveLength(0); // the staff login has not done anything yet
    expect((await log({ from: dayAhead(1) })).activity).toHaveLength(0); // nothing is dated tomorrow
    expect((await log({ to: dayAhead(0) })).activity.length).toBeGreaterThan(0);
  });
  it('a staff login can be limited to some venues (venue_staff): it sees only those, and cannot look up the bookings of the other venue', async () => {
    const admin = await createAdmin(env);
    const f1: any = await createApprovedVenue(env, admin);
    const f2: any = await createApprovedVenue(env, admin, f1.owner);
    const own = f1.owner.auth;
    const book = async (f: any, t: string) => (await request(env.app).post('/api/owner/bookings/offline').set(own).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(dayAhead(3), t), durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876543210', customerCity: 'Erode', paymentMethod: 'unpaid' }).expect(201)).body.reference;
    const ref1 = await book(f1, '10:00'), ref2 = await book(f2, '11:00');
    await request(env.app).post('/api/owner/staff').set(own).send({ fullName: 'Gate One', email: 'gate.one@example.com', password: 'Passw0rd!xyz', permissions: ['CHECK_IN', 'VENUE_VIEW'], allVenues: false, venueIds: [] }).expect(400); // some venue, or all
    const st = (await request(env.app).post('/api/owner/staff').set(own).send({ fullName: 'Gate One', email: 'gate.one@example.com', password: 'Passw0rd!xyz', permissions: ['CHECK_IN', 'VENUE_VIEW'], allVenues: false, venueIds: [f1.venue.id] }).expect(201)).body.staff;
    const login = (await request(env.app).post('/api/auth/login').send({ email: 'gate.one@example.com', password: 'Passw0rd!xyz' }).expect(200)).body.token;
    const as = { Authorization: `Bearer ${login}` };
    expect((await request(env.app).get('/api/staff/venues').set(as).expect(200)).body.venues.map((v: any) => v.id)).toEqual([f1.venue.id]);
    await request(env.app).post('/api/staff/verify').set(as).send({ reference: ref1 }).expect(200);
    await request(env.app).post('/api/staff/verify').set(as).send({ reference: ref2 }).expect(404); // that venue is not theirs
    const listed = (await request(env.app).get('/api/owner/staff').set(own).expect(200)).body.staff.find((x: any) => x.id === st.id);
    expect(listed).toMatchObject({ all_venues: false, venue_ids: [f1.venue.id] });
    await request(env.app).patch(`/api/owner/staff/${st.id}`).set(own).send({ allVenues: true }).expect(200); // every venue, now and later
    await request(env.app).post('/api/staff/verify').set(as).send({ reference: ref2 }).expect(200);
    expect((await request(env.app).get('/api/staff/venues').set(as).expect(200)).body.venues).toHaveLength(2);
  });

  it('closing an area asks about upcoming bookings; the dashboard lists closed areas', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth; const areaId = f.area.id;
    const c = await registerUser(env, 'customer');
    const sb = await startBooking(env, c, f, ist(dayAhead(3), '10:00'));
    await pay(env, c, sb.booking.body.bookingId, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    const list = (await request(env.app).get(`/api/owner/areas/${areaId}/upcoming-bookings`).set(own).expect(200)).body.bookings;
    expect(list).toHaveLength(1);
    await request(env.app).put(`/api/owner/areas/${areaId}`).set(own).send({ isActive: false }).expect(409); // must choose
    const r = (await request(env.app).put(`/api/owner/areas/${areaId}`).set(own).send({ isActive: false, bookings: 'cancel' }).expect(200)).body;
    expect(r.cancelledBookings).toBe(1);
    expect((await env.db.query('SELECT status FROM bookings WHERE id=$1', [sb.booking.body.bookingId])).rows[0].status).toBe('cancelled');
    const ov = (await request(env.app).get('/api/owner/overview').set(own).expect(200)).body;
    expect(ov.closedAreas.map((x: any) => x.id)).toContain(areaId); expect(Array.isArray(ov.unpricedAreas)).toBe(true);
  });

  it('the owner chooses full payment or an advance percentage when booking', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    expect((await request(env.app).get('/api/owner/payment-collection').set(own).expect(200)).body).toEqual({ mode: 'full', advancePercent: null });
    await request(env.app).put('/api/owner/payment-collection').set(own).send({ mode: 'advance' }).expect(400); // the percentage is needed
    await request(env.app).put('/api/owner/payment-collection').set(own).send({ mode: 'advance', advancePercent: 100 }).expect(400);
    await request(env.app).put('/api/owner/payment-collection').set(own).send({ mode: 'advance', advancePercent: 30 }).expect(200);
    expect((await request(env.app).get('/api/owner/payment-collection').set(own).expect(200)).body).toEqual({ mode: 'advance', advancePercent: 30 });
    await request(env.app).put('/api/owner/payment-collection').set(own).send({ mode: 'full', advancePercent: 30 }).expect(200);
    expect((await request(env.app).get('/api/owner/payment-collection').set(own).expect(200)).body).toEqual({ mode: 'full', advancePercent: null });
  });

  it('payout status: a paid booking is on hold until the hold time passes, then ready to pay; a complaint moves it to dispute', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    const c = await registerUser(env, 'customer');
    const sb = await startBooking(env, c, f, ist(dayAhead(3), '10:00'));
    await pay(env, c, sb.booking.body.bookingId, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    let d = (await request(env.app).get('/api/owner/payout-status').set(own).expect(200)).body;
    const row = () => d.bookings.find((x: any) => x.id === sb.booking.body.bookingId);
    expect(row().state).toBe('hold'); expect(row().on_hold).toBeGreaterThan(0); expect(row().ready_to_pay).toBe(0);
    expect(row().gross).toBeCloseTo(row().on_hold + row().fee, 2);
    await env.db.query(`UPDATE bookings SET during=tstzrange(now() - interval '10 days', now() - interval '10 days' + interval '1 hour'), status='completed' WHERE id=$1`, [sb.booking.body.bookingId]);
    d = (await request(env.app).get('/api/owner/payout-status').set(own).expect(200)).body;
    expect(row().state).toBe('ready'); expect(row().ready_to_pay).toBeCloseTo(row().gross - row().fee, 2); expect(row().on_hold).toBe(0); expect(d.totals.ready_to_pay).toBeGreaterThan(0);
    await env.db.query(`INSERT INTO support_tickets (user_id, booking_id, subject, status) VALUES ($1,$2,'Bad turf','open')`, [c.id, sb.booking.body.bookingId]);
    d = (await request(env.app).get('/api/owner/payout-status').set(own).expect(200)).body;
    expect(row().state).toBe('dispute'); expect(row().dispute).toBe(row().gross); expect(row().ready_to_pay).toBe(0);
  });

  it('pricing gate: hours set for today but no price closes the portal until a price is set', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    expect((await request(env.app).get('/api/owner/pricing-gate').set(own).expect(200)).body).toEqual({ blocked: false, areas: [] });
    await env.db.query('DELETE FROM pricing_rules WHERE area_id=$1', [f.area.id]); // the hours stay, the prices are gone
    const g = (await request(env.app).get('/api/owner/pricing-gate').set(own).expect(200)).body;
    expect(g.blocked).toBe(true); expect(g.areas[0]).toMatchObject({ id: f.area.id, venueId: f.venue.id });
  });

  it('open slots today: open (free now or later) out of all of todays slots, every playing area added up', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    const t = (await request(env.app).get('/api/owner/overview').set(own).expect(200)).body.slotsToday;
    expect(t.total).toBeGreaterThan(0); expect(t.open).toBeLessThanOrEqual(t.total);
    const free = (await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date: (await env.db.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d")).rows[0].d, sportId: f.football.id, duration: f.area.min_duration_minutes ?? 60 })).body.slots ?? [];
    if (free.length) expect(t.open).toBe(free.filter((x: any) => x.available).length);
  });

  it('a ₹0 price counts as no price: saving it is refused, and one already saved closes the portal like a missing price', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    await request(env.app).put(`/api/owner/areas/${f.area.id}/pricing`).set(own).send({ rules: [{ dayType: 'all', startTime: '00:00', endTime: '24:00', pricePerHour: 0 }] }).expect(400);
    await env.db.query('UPDATE pricing_rules SET price_per_hour=0 WHERE area_id=$1', [f.area.id]); // an old ₹0 price
    expect((await request(env.app).get('/api/owner/pricing-gate').set(own).expect(200)).body.blocked).toBe(true);
  });

  it('a playing area created with a default price is priced for every slot; a slot price set later wins for that slot', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    const a = (await request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(own).send({ name: 'Court Z', sportIds: [f.football.id], slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 120, environment: 'outdoor', turfShape: 'rectangle', defaultPrice: 700 }).expect(201)).body.area;
    expect((await env.db.query('SELECT start_time::text AS s, end_time::text AS e, price_per_hour::float8 AS p FROM pricing_rules WHERE area_id=$1', [a.id])).rows).toEqual([{ s: '00:00:00', e: '24:00:00', p: 700 }]);
    await request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(own).send({ name: 'Court Y', sportIds: [f.football.id], slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 120, environment: 'outdoor', turfShape: 'rectangle', defaultPrice: 0 }).expect(400);
  });

  it('the default price fills every slot without its own price; a slot price stays for its slot', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    const day = dayAhead(4); const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    await env.db.query('DELETE FROM pricing_rules WHERE area_id=$1', [f.area.id]);
    await env.db.query(`INSERT INTO pricing_rules (area_id, sport_id, day_type, day_of_week, start_time, end_time, price_per_hour) VALUES ($1,NULL,'all',$2,'10:00','11:00',1300)`, [f.area.id, dow]);
    await request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(own).send({ basePrice: 900, applyToAll: false }).expect(200);
    const slots = (await request(env.app).get(`/api/areas/${f.area.id}/slots`).query({ date: day, sportId: f.football.id, duration: 60 }).expect(200)).body.slots;
    const at = (h: string) => slots.find((x: any) => new Date(x.startsAt).toISOString() === new Date(ist(day, h)).toISOString());
    expect(at('10:00').price).toBe(1300); // its own price
    expect(at('12:00').price).toBe(900); // no price of its own: the default
    expect(slots.some((x: any) => x.reason === 'unpriced')).toBe(false);
  });

  it('admin settles a complaint with a part refund: the customer gets it back, the venue share shrinks, the ticket is resolved', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const c = await registerUser(env, 'customer');
    const sb = await startBooking(env, c, f, ist(dayAhead(3), '10:00'));
    const bid = sb.booking.body.bookingId;
    await pay(env, c, bid, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    const t = (await env.db.query(`INSERT INTO support_tickets (user_id, booking_id, subject, status) VALUES ($1,$2,'Turf was flooded','open') RETURNING id`, [c.id, bid])).rows[0];
    const before = (await env.db.query('SELECT total::float8 AS total, owner_amount::float8 AS o FROM bookings WHERE id=$1', [bid])).rows[0];
    const d = (await request(env.app).get(`/api/admin/tickets/${t.id}`).set(admin.auth).expect(200)).body;
    expect(d.booking).toMatchObject({ reference: expect.any(String), paid: before.total, refunded: 0, refundable: before.total });
    const half = Math.round(before.total / 2);
    await request(env.app).post(`/api/admin/tickets/${t.id}/refund`).set(admin.auth).send({ amount: half, reason: 'Half the game was lost to rain' }).expect(201);
    const after = (await env.db.query('SELECT owner_amount::float8 AS o FROM bookings WHERE id=$1', [bid])).rows[0];
    expect(after.o).toBeCloseTo(before.o * (1 - half / before.total), 1);
    expect((await env.db.query('SELECT status FROM support_tickets WHERE id=$1', [t.id])).rows[0].status).toBe('resolved');
    const d2 = (await request(env.app).get(`/api/admin/tickets/${t.id}`).set(admin.auth).expect(200)).body;
    expect(d2.booking.refunded).toBe(half); expect(d2.booking.refundable).toBeCloseTo(before.total - half, 2);
    expect(d2.messages.some((m: any) => m.body.includes('Half the game was lost to rain'))).toBe(true);
    // the venue owner sees the refunded amount under Dispute for that booking
    const ps = (await request(env.app).get('/api/owner/payout-status').set(f.owner.auth).expect(200)).body;
    const row = ps.bookings.find((x: any) => x.id === bid);
    expect(row.dispute).toBe(half); expect(row.state).not.toBe('dispute'); expect(ps.totals.dispute).toBeGreaterThanOrEqual(half);
    // a second, smaller refund needs no reason
    await request(env.app).post(`/api/admin/tickets/${t.id}/refund`).set(admin.auth).send({ amount: 10 }).expect(201);
    // the customer gets one detailed message per refund (no second, generic "Refund issued")
    const notes = (await env.db.query(`SELECT title, body FROM notifications WHERE user_id=$1 AND title IN ('Refund for your complaint','Refund issued') ORDER BY created_at`, [c.id])).rows;
    expect(notes.map((n: any) => n.title)).toEqual(['Refund for your complaint', 'Refund for your complaint']);
    expect(notes[0].body).toContain('"Turf was flooded"'); expect(notes[0].body).toContain(`you paid ₹${before.total.toLocaleString('en-IN')} in total`);
    expect(notes[0].body).toContain(`We have refunded ₹${half.toLocaleString('en-IN')} of it`); expect(notes[0].body).toContain('Reason: Half the game was lost to rain.');
    expect(notes[1].body).toContain(`refunded on this booking in all`);
  });

  it('a complaint without a booking: the admin sees the customer paid bookings, picks one, and refunds it in full', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const c = await registerUser(env, 'customer');
    const sb = await startBooking(env, c, f, ist(dayAhead(3), '11:00'));
    const bid = sb.booking.body.bookingId;
    await pay(env, c, bid, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    const t = (await request(env.app).post('/api/me/tickets').set(c.auth).send({ subject: 'not clean', message: 'Turf is not clean' }).expect(201)).body.ticket ?? (await env.db.query('SELECT id FROM support_tickets WHERE user_id=$1', [c.id])).rows[0];
    const d = (await request(env.app).get(`/api/admin/tickets/${t.id}`).set(admin.auth).expect(200)).body;
    expect(d.booking).toBeNull(); expect(d.bookings.map((x: any) => x.id)).toContain(bid);
    const other = await registerUser(env, 'customer'); const sb2 = await startBooking(env, other, f, ist(dayAhead(3), '13:00'));
    await request(env.app).post(`/api/admin/tickets/${t.id}/refund`).set(admin.auth).send({ reason: 'Not cleaned before the game', bookingId: sb2.booking.body.bookingId }).expect(400); // not this customer's
    await request(env.app).post(`/api/admin/tickets/${t.id}/refund`).set(admin.auth).send({ reason: 'Not cleaned before the game', bookingId: bid }).expect(201);
    expect((await env.db.query('SELECT booking_id, status FROM support_tickets WHERE id=$1', [t.id])).rows[0]).toMatchObject({ booking_id: bid, status: 'resolved' });
    expect((await env.db.query('SELECT owner_amount::float8 AS o FROM bookings WHERE id=$1', [bid])).rows[0].o).toBe(0);
  });

  it('server lock: with an unpriced slot today, other owner changes are refused until a price is set', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    await env.db.query('DELETE FROM pricing_rules WHERE area_id=$1', [f.area.id]); // hours stay, prices gone
    forgetPricedCache();
    const istHour = new Date(Date.now() + 330 * 60000).getUTCHours(); if (istHour >= 22 || istHour < 5) return; // no slot left today to be unpriced
    const r = await request(env.app).post('/api/owner/customers').set(own).send({ name: 'Meena Das', mobile: '9876500011', city: 'Salem' });
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('price_required');
    await request(env.app).get('/api/owner/bookings').set(own).expect(200); // looking is still fine
    await request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(own).send({ basePrice: 900 }).expect(200); // fixing it is allowed
    await request(env.app).post('/api/owner/customers').set(own).send({ name: 'Meena Das', mobile: '9876500011', city: 'Salem' }).expect(201);
  });

  it('customer search by date leaves out a venue whose slots have no price (it cannot be booked)', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const day = dayAhead(3);
    const ids = async () => (await request(env.app).get(`/api/venues?limit=50&date=${day}`).expect(200)).body.venues.map((v: any) => v.id);
    expect(await ids()).toContain(f.venue.id);
    await env.db.query('DELETE FROM pricing_rules WHERE area_id=$1', [f.area.id]); // open, but no price
    expect(await ids()).not.toContain(f.venue.id);
  });

  it('advance bookings: the customer pays the advance online, the owner records the balance at the venue', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin); const own = f.owner.auth;
    await request(env.app).put('/api/owner/payment-collection').set(own).send({ mode: 'advance', advancePercent: 30 }).expect(200);
    expect((await request(env.app).get(`/api/venues/${f.venue.id}`).expect(200)).body.venue.advance_percent).toBe(30);
    const c = await registerUser(env, 'customer');
    const sb = await startBooking(env, c, f, ist(dayAhead(3), '10:00'));
    const bid = sb.booking.body.bookingId; const total = sb.booking.body.total;
    expect(sb.booking.body.advance).toBeCloseTo(total * 0.3, 2); expect(sb.booking.body.order.amount).toBeCloseTo(total * 0.3, 2);
    expect(sb.booking.body.payAtVenue).toBeCloseTo(total * 0.7, 2);
    await pay(env, c, bid, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    const pend = (await request(env.app).post(`/api/owner/bookings/${bid}/payments`).set(own).send({ amount: total, mode: 'cash' }).expect(400)).body; // more than the balance
    expect(pend.error.code).toBe('overpayment');
    const r = (await request(env.app).post(`/api/owner/bookings/${bid}/payments`).set(own).send({ amount: Math.round(total * 70) / 100, mode: 'cash' }).expect(201)).body;
    expect(r.pending).toBe(0); expect(r.paid).toBeCloseTo(total, 2);
    const b = (await env.db.query('SELECT advance_amount::float8 AS a, commission_amount::float8 AS fee FROM bookings WHERE id=$1', [bid])).rows[0];
    const ps = (await request(env.app).get('/api/owner/payout-status').set(own).expect(200)).body.bookings.find((x: any) => x.id === bid);
    expect(ps.gross).toBeCloseTo(b.a, 2); expect(ps.on_hold + ps.ready_to_pay).toBeCloseTo(Math.max(0, b.a - b.fee), 2); // PlaynX holds only the advance
  });

  it('a ticket takes photos and videos: only the person who raised it and admins can open them', async () => {
    const admin = await createAdmin(env);
    const c = await registerUser(env, 'customer'); const other = await registerUser(env, 'customer');
    const t = (await request(env.app).post('/api/me/tickets').set(c.auth).send({ subject: 'Turf not clean', message: 'Rubbish on the pitch' }).expect(201)).body.ticket;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const a = (await request(env.app).post(`/api/me/tickets/${t.id}/attachments`).set(c.auth).attach('file', png, { filename: 'p.png', contentType: 'image/png' }).expect(201)).body.attachment;
    expect(a.kind).toBe('image');
    await request(env.app).post(`/api/me/tickets/${t.id}/attachments`).set(c.auth).attach('file', Buffer.from('%PDF-1.4 x'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(400); // photos and videos only
    await request(env.app).post(`/api/me/tickets/${t.id}/attachments`).set(other.auth).attach('file', png, { filename: 'p.png', contentType: 'image/png' }).expect(404); // not their ticket
    expect((await request(env.app).get(`/api/me/tickets/${t.id}`).set(c.auth).expect(200)).body.attachments).toHaveLength(1);
    await request(env.app).get(`/api/me/tickets/${t.id}/attachments/${a.id}/file`).set(c.auth).expect(200).expect('Content-Type', /image\/png/);
    await request(env.app).get(`/api/me/tickets/${t.id}/attachments/${a.id}/file`).set(other.auth).expect(404);
    const d = (await request(env.app).get(`/api/admin/tickets/${t.id}`).set(admin.auth).expect(200)).body;
    expect(d.attachments.map((x: any) => x.id)).toEqual([a.id]);
    await request(env.app).get(`/api/admin/tickets/${t.id}/attachments/${a.id}/file`).set(admin.auth).expect(200);
  });

  it('sports are listed Cricket, Football, Badminton first, then the rest by name', async () => {
    const names = (await request(env.app).get('/api/sports').expect(200)).body.sports.map((x: any) => x.name);
    const first = names.filter((n: string) => ['Cricket', 'Football', 'Badminton'].includes(n));
    expect(names.slice(0, first.length)).toEqual(['Cricket', 'Football', 'Badminton'].filter((n) => first.includes(n)));
    const rest = names.slice(first.length); expect(rest).toEqual([...rest].sort((a: string, b: string) => a.localeCompare(b)));
  });

  it('a just-approved owner with no bank account can save the bank details and how customers pay, in either order', async () => {
    const admin = await createAdmin(env);
    const o = await registerUser(env, 'owner'); await approveOwner(env, admin, o);
    await env.db.query('UPDATE owner_onboarding SET bank_account_number=NULL WHERE owner_id=$1', [o.id]);
    await request(env.app).put('/api/owner/payment-collection').set(o.auth).send({ mode: 'advance', advancePercent: 30 }).expect(200); // no "add your bank first"
    await request(env.app).put('/api/owner/profile').set(o.auth).send({ bankAccountName: 'Ravi Kumar', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }).expect(200);
    expect((await request(env.app).get('/api/owner/payment-collection').set(o.auth).expect(200)).body).toEqual({ mode: 'advance', advancePercent: 30 });
  });

  it('the "from" price is the lowest a customer can really book: a default price no open slot uses is not shown', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    await env.db.query('DELETE FROM pricing_rules WHERE area_id=$1', [f.area.id]);
    await env.db.query(`INSERT INTO pricing_rules (area_id, sport_id, day_type, day_of_week, start_time, end_time, price_per_hour) VALUES ($1,NULL,'all',NULL,'00:00','24:00',500)`, [f.area.id]); // default
    await env.db.query(`DELETE FROM playing_area_sports WHERE playing_area_id=$1 AND sport_id<>$2`, [f.area.id, f.football.id]); // football only
    await env.db.query(`INSERT INTO pricing_rules (area_id, sport_id, day_type, day_of_week, start_time, end_time, price_per_hour) VALUES ($1,$2,'all',NULL,'00:00','24:00',900)`, [f.area.id, f.football.id]); // football always costs 900
    const v = (await request(env.app).get('/api/venues?limit=50').expect(200)).body.venues.find((x: any) => x.id === f.venue.id);
    expect(v.min_price).toBe(900);
    const d = (await request(env.app).get(`/api/venues/${f.venue.id}`).expect(200)).body.venue;
    expect(d.areas.find((a: any) => a.id === f.area.id).from_price).toBe(900);
  });
});
