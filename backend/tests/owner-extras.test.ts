import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createAdmin, createApprovedVenue, ist, pay, registerUser, setup, startBooking, type TestEnv } from './helpers.js';
const dayAhead = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let env: TestEnv;
beforeAll(async () => { env = await setup(); });

describe('owner portal extras (JusGo pages)', () => {


  it('activity log: shows what the owner did, filtered by category', async () => {
    const o = await registerUser(env, 'owner');
    await request(env.app).put('/api/owner/application/identity').set(o.auth).send({ aadhaarNumber: '123412341234' }).expect(200);
    const all = (await request(env.app).get('/api/owner/activity').set(o.auth).expect(200)).body;
    expect(all.activity.some((a: any) => a.action === 'application.identity_saved')).toBe(true);
    const only = (await request(env.app).get('/api/owner/activity?category=venue').set(o.auth)).body.activity;
    expect(only.every((a: any) => a.action.startsWith('venue.'))).toBe(true);
    // another owner never sees it
    const other = await registerUser(env, 'owner');
    expect((await request(env.app).get('/api/owner/activity?category=application').set(other.auth)).body.activity.some((a: any) => a.action === 'application.identity_saved')).toBe(false);
  });

  it('close account: needs the password, refuses with upcoming bookings, then signs the owner out for good', async () => {
    const o = await registerUser(env, 'owner');
    await request(env.app).post('/api/owner/account/close').set(o.auth).send({ confirm: 'DELETE', password: 'wrong', reason: 'Other' }).expect(403);
    await request(env.app).post('/api/owner/account/close').set(o.auth).send({ reason: 'Moving to another platform' }).expect(400); // DELETE must be typed
    await request(env.app).post('/api/owner/account/close').set(o.auth).send({ confirm: 'DELETE', reason: 'No longer own a venue' }).expect(200); // no password: JusGo asks only to type DELETE
    const row = (await env.db.query('SELECT is_active, email, phone, full_name FROM users WHERE id=$1', [o.id])).rows[0];
    expect(row.is_active).toBe(false); expect(row.email).toMatch(/^deleted\+/); expect(row.phone).toBeNull();
    await request(env.app).get('/api/owner/activity').set(o.auth).expect(401); // the old token is dead
    await request(env.app).post('/api/auth/login').send({ email: o.email, password: 'Passw0rdTest' }).expect(401);
  });

  it('close account is blocked while confirmed bookings are coming up', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const c = await registerUser(env, 'customer');
    await env.db.query(`INSERT INTO bookings (reference, customer_id, venue_id, area_id, sport_id, during, status, subtotal, total, commission_rate, commission_amount, owner_amount)
      VALUES ($1,$2,$3,$4,$5,tstzrange(now() + interval '2 days', now() + interval '2 days 1 hour'),'confirmed',800,800,10,80,720)`, [`UP-${Date.now()}`, c.id, f.venue.id, f.area.id, f.football.id]);
    const r = await request(env.app).post('/api/owner/account/close').set(f.owner.auth).send({ confirm: 'DELETE' }).expect(400);
    expect(r.body.error.code).toBe('upcoming_bookings');
  });
});

describe('pending payments and record payment', () => {
  it('a part-paid walk-in booking shows as pending; payments clear it and cannot overpay', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    const startsAt = ist(dayAhead(3), '10:00');
    const make = (extra: object) => request(env.app).post('/api/owner/bookings/offline').set(own).send({ areaId: f.area.id, sportId: f.football.id, startsAt, durationMinutes: 60, customerName: 'Ravi Kumar', customerPhone: '9876501234', ...extra });
    const made = await make({ amount: 1000, amountPaid: 400, paymentMethod: 'cash' }).expect(201);
    let p = (await request(env.app).get('/api/owner/pending-payments').set(own).expect(200)).body;
    expect(p.customers).toHaveLength(1); expect(p.customers[0]).toMatchObject({ name: 'Ravi Kumar', total: 1000, paid: 400, pending: 600 }); expect(p.totalPending).toBe(600);
    await request(env.app).post(`/api/owner/bookings/${made.body.bookingId}/payments`).set(own).send({ amount: 700, mode: 'cash' }).expect(400);
    const r1 = await request(env.app).post(`/api/owner/bookings/${made.body.bookingId}/payments`).set(own).send({ amount: 250, mode: 'upi' }).expect(201);
    expect(r1.body).toMatchObject({ paid: 650, pending: 350 });
    await request(env.app).post(`/api/owner/bookings/${made.body.bookingId}/payments`).set(own).send({ amount: 350, mode: 'cash' }).expect(201);
    p = (await request(env.app).get('/api/owner/pending-payments').set(own)).body;
    expect(p.customers).toEqual([]);
    expect((await env.db.query('SELECT count(*)::int AS n FROM booking_payments WHERE booking_id=$1', [made.body.bookingId])).rows[0].n).toBe(3);
    // another owner cannot record payments on it
    await request(env.app).post(`/api/owner/bookings/${made.body.bookingId}/payments`).set((await registerUser(env, 'owner')).auth).send({ amount: 1, mode: 'cash' }).expect(403);
  });
  it('an unpaid walk-in booking is fully pending', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const startsAt = ist(dayAhead(4), '10:00');
    await request(env.app).post('/api/owner/bookings/offline').set(f.owner.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt, durationMinutes: 60, customerName: 'Meena', customerPhone: '9876505555', paymentMethod: 'unpaid' }).expect(201);
    const p = (await request(env.app).get('/api/owner/pending-payments').set(f.owner.auth)).body;
    expect(p.totalPending).toBeGreaterThan(0); expect(p.customers[0].paid).toBe(0);
  });
});

describe('staff permissions', () => {
  it('each staff login can only do what the owner ticked, and changes apply at once', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    const cat = (await request(env.app).get('/api/owner/staff').set(own).expect(200)).body.permissions.map((p: any) => p.id);
    expect(cat).toEqual(expect.arrayContaining(['CHECK_IN', 'BOOKING_VIEW', 'BOOKING_CREATE', 'DASHBOARD_VIEW', 'VENUE_VIEW', 'PLAYING_AREA_VIEW', 'PRICING_VIEW']));
    await request(env.app).post('/api/owner/staff').set(own).send({ fullName: 'Gate Guy', email: 'gate@test.dev', password: 'GatePassword1', permissions: ['CHECK_IN'] }).expect(201);
    await request(env.app).post('/api/owner/staff').set(own).send({ fullName: 'Bad Perm', email: 'bad@test.dev', password: 'GatePassword1', permissions: ['EVERYTHING'] }).expect(400);
    const login = (await request(env.app).post('/api/auth/login').send({ email: 'gate@test.dev', password: 'GatePassword1' }).expect(200)).body;
    const staff = { Authorization: `Bearer ${login.token}` };
    const staffId = login.user.id;
    expect((await request(env.app).get('/api/staff/me').set(staff).expect(200)).body.permissions).toEqual(['CHECK_IN']);
    for (const path of ['/api/staff/bookings', '/api/staff/venues', '/api/staff/dashboard', '/api/staff/pricing']) await request(env.app).get(path).set(staff).expect(403);
    await request(env.app).post('/api/owner/staff/' + staffId).set(own); // wrong verb is a no-op
    await request(env.app).patch(`/api/owner/staff/${staffId}`).set(own).send({ permissions: ['BOOKING_VIEW', 'VENUE_VIEW', 'PLAYING_AREA_VIEW', 'DASHBOARD_VIEW', 'PRICING_VIEW'] }).expect(200);
    expect((await request(env.app).get('/api/staff/bookings').set(staff).expect(200)).body.bookings).toEqual([]);
    const v = (await request(env.app).get('/api/staff/venues').set(staff).expect(200)).body.venues;
    expect(v[0].name).toBe('Green Arena'); expect(v[0].areas.length).toBe(1);
    expect((await request(env.app).get('/api/staff/dashboard').set(staff).expect(200)).body).toMatchObject({ venues: 1, areas: 1 });
    expect((await request(env.app).get('/api/staff/pricing').set(staff).expect(200)).body.prices.length).toBeGreaterThan(0);
    await request(env.app).post('/api/staff/check-in').set(staff).send({ reference: 'ABCDEF12' }).expect(403); // CHECK_IN was taken away
    await request(env.app).post('/api/staff/bookings/offline').set(staff).send({}).expect(403);
    // add counter booking rights: staff can book a walk-in, and it shows on the owner's side
    await request(env.app).patch(`/api/owner/staff/${staffId}`).set(own).send({ permissions: ['BOOKING_CREATE', 'BOOKING_VIEW'] }).expect(200);
    const startsAt = ist(dayAhead(5), '11:00');
    const made = await request(env.app).post('/api/staff/bookings/offline').set(staff).send({ areaId: f.area.id, sportId: f.football.id, startsAt, durationMinutes: 60, customerName: 'Walk In', customerPhone: '9876509999' }).expect(201);
    expect(made.body.reference).toBeTruthy();
    expect((await request(env.app).get('/api/staff/bookings').set(staff).expect(200)).body.bookings).toHaveLength(1);
    // counter options, calendar and reports are separate permissions
    await request(env.app).get('/api/staff/calendar?date=2030-01-01').set(staff).expect(403);
    await request(env.app).get('/api/staff/reports').set(staff).expect(403);
    await request(env.app).patch(`/api/owner/staff/${staffId}`).set(own).send({ permissions: ['BOOKING_CREATE', 'BOOKING_VIEW', 'CALENDAR_VIEW', 'REPORTS_VIEW'] }).expect(200);
    const opts = (await request(env.app).get('/api/staff/booking-options').set(staff).expect(200)).body.venues;
    expect(opts[0].areas[0].sports.length).toBeGreaterThan(0);
    const cal = (await request(env.app).get(`/api/staff/calendar?date=${dayAhead(5)}`).set(staff).expect(200)).body.items;
    expect(cal).toHaveLength(1); expect(cal[0].customer_name).toBe('Walk In');
    const rep = (await request(env.app).get('/api/staff/reports').set(staff).expect(200)).body;
    expect(rep.days).toBe(30); expect(rep.totals).toHaveProperty('revenue');
    // the change shows in the owner's activity log
    expect((await request(env.app).get('/api/owner/activity?category=staff').set(own)).body.activity.some((a: any) => a.action === 'staff.permissions_changed')).toBe(true);
  });
});

describe('opponents, event bookings and manual customers', () => {
  it('an opponent joins the customer list; owners add, edit and delete customers by hand', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    const book = (extra: object, day = 6) => request(env.app).post('/api/owner/bookings/offline').set(own).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(dayAhead(day), '12:00'), durationMinutes: 60, customerName: 'Home Team', customerPhone: '9876511111', ...extra });
    await book({ opponentPhone: '9876522222' }).expect(400); // an opponent number needs a name
    await book({ eventKind: 'event' }).expect(400); // an event needs a title
    const m = await book({ opponentName: 'Away Team', opponentPhone: '9876522222' }).expect(201);
    const row = (await env.db.query('SELECT opponent_name, opponent_phone, event_kind FROM bookings WHERE id=$1', [m.body.bookingId])).rows[0];
    expect(row).toEqual({ opponent_name: 'Away Team', opponent_phone: '+919876522222', event_kind: null });
    await book({ eventKind: 'academic', eventTitle: 'Summer coaching camp', customerName: 'Sunrise Academy', customerPhone: '9876533333' }, 7).expect(201);
    let list = (await request(env.app).get('/api/owner/customers').set(own).expect(200)).body.customers;
    expect(list.map((c: any) => c.name).sort()).toEqual(['Away Team', 'Home Team', 'Sunrise Academy']);
    const away = list.find((c: any) => c.name === 'Away Team');
    expect(away).toMatchObject({ bookings: 0, source: 'opponent' }); expect(away.manual_id).toBeTruthy();
    // add by hand, refuse a duplicate number, edit, history, delete
    const added = (await request(env.app).post('/api/owner/customers').set(own).send({ name: 'Priya Nair', mobile: '9876544444', city: 'Kochi' }).expect(201)).body.customer;
    await request(env.app).post('/api/owner/customers').set(own).send({ name: 'Priya Again', mobile: '9876544444', city: 'Kochi' }).expect(409); await request(env.app).post('/api/owner/customers').set(own).send({ name: 'No City', mobile: '9876545555' }).expect(400); // the city is required
    await request(env.app).put(`/api/owner/customers/${added.id}`).set(own).send({ name: 'Priya N', mobile: '9876544444', city: 'Chennai', email: 'priya@x.co', note: 'plays every Sunday morning' }).expect(200);
    list = (await request(env.app).get('/api/owner/customers?search=chennai').set(own)).body.customers;
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ name: 'Priya N', bookings: 0, email: 'priya@x.co', note: 'plays every Sunday morning' });
    expect((await request(env.app).get('/api/owner/customers/history').query({ key: `manual:${added.id}` }).set(own).expect(200)).body.bookings).toEqual([]);
    const hist = await request(env.app).get('/api/owner/customers/history').query({ key: `manual:${away.manual_id}` }).set(own).expect(200);
    expect(hist.body.bookings).toHaveLength(1); // the game they played as the opponent
    // another owner cannot touch it
    const other = await registerUser(env, 'owner');
    await request(env.app).put(`/api/owner/customers/${added.id}`).set(other.auth).send({ name: 'Hack', mobile: '9876544444', city: 'Erode' }).expect(403);
    await request(env.app).delete(`/api/owner/customers/${added.id}`).set(own).expect(204);
    await request(env.app).delete(`/api/owner/customers/${added.id}`).set(own).expect(404);
  });
});

describe('instant booking switch and price check', () => {
  it('price-check quotes the saved pricing for an owner; with instant booking off customers cannot pay online', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    const startsAt = ist(dayAhead(3), '10:00');
    const pc = await request(env.app).post(`/api/owner/areas/${f.area.id}/price-check`).set(own).send({ sportId: f.football.id, startsAt, durationMinutes: 60 }).expect(200);
    expect(pc.body.price).toBe(800); expect(pc.body.perHour).toBe(800);
    await request(env.app).post(`/api/owner/areas/${f.area.id}/price-check`).set(own).send({ sportId: f.football.id, startsAt: ist(dayAhead(3), '03:00'), durationMinutes: 60 }).expect(400); // outside opening hours
    await request(env.app).post(`/api/owner/areas/${f.area.id}/price-check`).set((await registerUser(env, 'owner')).auth).send({ sportId: f.football.id, startsAt, durationMinutes: 60 }).expect(403);
    const c = await registerUser(env, 'customer');
    await request(env.app).put(`/api/owner/areas/${f.area.id}`).set(own).send({ instantBooking: false }).expect(200);
    const v = (await request(env.app).get(`/api/venues/${f.venue.id}`).expect(200)).body.venue;
    expect(v.areas[0].instant_booking).toBe(false);
    const lock = await request(env.app).post('/api/slots/lock').set(c.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt, durationMinutes: 60 }).expect(409);
    expect(lock.body.error.code).toBe('request_only');
    // the owner can still book for them, and turning it back on reopens online booking
    await request(env.app).post('/api/owner/bookings/offline').set(own).send({ areaId: f.area.id, sportId: f.football.id, startsAt, durationMinutes: 60, customerName: 'Phone Caller', customerPhone: '9876500001' }).expect(201);
    await request(env.app).put(`/api/owner/areas/${f.area.id}`).set(own).send({ instantBooking: true }).expect(200);
    await request(env.app).post('/api/slots/lock').set(c.auth).send({ areaId: f.area.id, sportId: f.football.id, startsAt: ist(dayAhead(3), '14:00'), durationMinutes: 60 }).expect(201);
  });
});

describe('event blocks with a customer and amount', () => {
  it('blocks a date range on chosen weekdays, takes the event customer and amount, and can cancel booked slots', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    // a customer already holds 10:00 on day 10
    const c = await registerUser(env, 'customer');
    const sb = await startBooking(env, c, f, ist(dayAhead(10), '10:00'));
    await pay(env, c, sb.booking.body.bookingId, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    const body = { areaIds: [f.area.id], startsAt: ist(dayAhead(10), '10:00'), endsAt: ist(dayAhead(10), '12:00'), reason: 'Corporate cup', customerName: 'Acme Corp', customerPhone: '9876577777', amount: 5000, amountPaid: 2000, paymentMethod: 'upi', eventKind: 'event' };
    const skipped = await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ ...body, endDate: dayAhead(12) }).expect(201);
    expect(skipped.body.created).toBe(2); expect(skipped.body.conflicts).toHaveLength(1); // the booked day is skipped, the other two days are blocked
    const cancelled = await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ ...body, cancelBookings: true, endDate: dayAhead(10) }).expect(201);
    expect(cancelled.body).toMatchObject({ created: 1, cancelled: 1 });
    expect((await env.db.query(`SELECT status FROM bookings WHERE customer_id=$1`, [c.id])).rows[0].status).toBe('cancelled');
    // the event shows as a customer with the amount, and the unpaid part is in Pending payments
    const cust = (await request(env.app).get('/api/owner/customers?search=acme').set(own)).body.customers;
    expect(cust).toHaveLength(1); expect(cust[0]).toMatchObject({ name: 'Acme Corp', bookings: 3, spent: 15000 });
    const pend = (await request(env.app).get('/api/owner/pending-payments').set(own)).body;
    expect(pend.customers[0]).toMatchObject({ name: 'Acme Corp', paid: 6000, pending: 9000 });
    const blockId = pend.customers[0].bills[0].id;
    await request(env.app).post(`/api/owner/bookings/${blockId}/payments`).set(own).send({ amount: 3000, mode: 'cash' }).expect(201);
    await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ ...body, customerPhone: undefined }).expect(400); // a customer needs a mobile number
    await request(env.app).post('/api/owner/blocks/bulk').set(own).send({ ...body, weekdays: [], endDate: dayAhead(1) }).expect(400); // end before start
  });
});

describe('admin portal pages (JusGo): sports and listing changes', () => {
  it('sports: admin adds, renames and switches off; the public list only shows active ones; roles are respected', async () => {
    const admin = await createAdmin(env); const support = await createAdmin(env, 'support');
    const added = (await request(env.app).post('/api/admin/sports').set(admin.auth).send({ name: 'Padel Tennis' }).expect(201)).body.sport;
    expect(added.slug).toBe('padel-tennis');
    await request(env.app).post('/api/admin/sports').set(admin.auth).send({ name: 'padel tennis' }).expect(409);
    await request(env.app).post('/api/admin/sports').set(support.auth).send({ name: 'Golf' }).expect(403);
    expect((await request(env.app).get('/api/sports')).body.sports.some((s: any) => s.slug === 'padel-tennis')).toBe(true);
    await request(env.app).patch(`/api/admin/sports/${added.id}`).set(admin.auth).send({ isActive: false }).expect(200);
    expect((await request(env.app).get('/api/sports')).body.sports.some((s: any) => s.slug === 'padel-tennis')).toBe(false);
    const list = (await request(env.app).get('/api/admin/sports').set(admin.auth).expect(200)).body.sports;
    expect(list.find((s: any) => s.id === added.id)).toMatchObject({ isActive: false, venues: 0 });
  });


  it('listing changes: edits to a live venue show up for review', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    await request(env.app).put(`/api/owner/venues/${f.venue.id}`).set(f.owner.auth).send({ name: 'Green Arena Renamed' }).expect(200);
    const ch = (await request(env.app).get('/api/admin/listing-changes').set(admin.auth).expect(200)).body.changes;
    expect(ch.find((c: any) => c.venueId === f.venue.id)).toMatchObject({ venueName: 'Green Arena' });
    await request(env.app).post(`/api/admin/venues/${f.venue.id}/changes`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    expect((await request(env.app).get('/api/admin/listing-changes').set(admin.auth)).body.changes.some((c: any) => c.venueId === f.venue.id)).toBe(false);
  });

  it('a new playing area waits for the admin: hidden from customers until approved; a rejection is edited and resubmitted', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const created = (await request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(f.owner.auth).send({ name: 'Court 2', sportIds: [f.football.id] }).expect(201)).body.area;
    expect(created.approval_status).toBe('pending');
    const names = async () => (await request(env.app).get(`/api/venues/${f.venue.id}`)).body.venue.areas.map((a: any) => a.name);
    expect(await names()).not.toContain('Court 2');
    const list = (await request(env.app).get('/api/admin/areas').query({ status: 'pending' }).set(admin.auth).expect(200)).body.areas;
    expect(list.map((x: any) => x.name)).toEqual(['Court 2']);
    await request(env.app).post(`/api/admin/areas/${created.id}/decision`).set(admin.auth).send({ decision: 'reject' }).expect(400); // a reason is needed
    await request(env.app).post(`/api/admin/areas/${created.id}/decision`).set(admin.auth).send({ decision: 'reject', note: 'Add real photos' }).expect(200);
    const seen = (await request(env.app).get(`/api/owner/venues/${f.venue.id}`).set(f.owner.auth).expect(200)).body.venue.areas.find((a: any) => a.id === created.id);
    expect([seen.approval_status, seen.approval_note]).toEqual(['rejected', 'Add real photos']);
    expect((await request(env.app).put(`/api/owner/areas/${created.id}`).set(f.owner.auth).send({ name: 'Court Two' }).expect(200)).body.area.approval_status).toBe('pending');
    await request(env.app).post(`/api/admin/areas/${created.id}/decision`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    expect(await names()).toContain('Court Two');
  });

  it('default pricing: save changes only the default price, apply replaces every other price', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const rules = async () => (await request(env.app).get(`/api/owner/venues/${f.venue.id}`).set(f.owner.auth).expect(200)).body.venue.areas[0].pricing as any[];
    expect(await rules()).toHaveLength(2);
    await request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(f.owner.auth).send({ basePrice: 0 }).expect(400);
    await request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(f.owner.auth).send({ basePrice: 500 }).expect(200);
    expect(await rules()).toHaveLength(3); // the two time rules stay, the default fills the rest
    await request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(f.owner.auth).send({ basePrice: 600 }).expect(200);
    expect((await rules()).filter((x) => x.pricePerHour === 600)).toHaveLength(1);
    expect(await rules()).toHaveLength(3);
    const all = (await request(env.app).put(`/api/owner/areas/${f.area.id}/default-price`).set(f.owner.auth).send({ basePrice: 700, applyToAll: true }).expect(200)).body;
    expect(all.removedRules).toBe(3);
    expect((await rules()).map((x) => x.pricePerHour)).toEqual([700]);
  });
});

describe('admin staff permissions (pick exactly what each admin can do)', () => {
  it('a ticked list replaces the role; resetting returns to the role; changes take effect at once', async () => {
    const boss = await createAdmin(env);
    const cat = (await request(env.app).get('/api/admin/team').set(boss.auth).expect(200)).body.permissions.map((p: any) => p.id);
    expect(cat).toEqual(expect.arrayContaining(['venues', 'reports', 'admins']));
    const created = (await request(env.app).post('/api/admin/team').set(boss.auth).send({ fullName: 'Ops Person', email: 'ops1@test.dev', password: 'OpsPassword12', adminRole: 'support', permissions: ['reports', 'venues'] }).expect(201)).body.admin;
    expect(created.admin_permissions).toEqual(['reports', 'venues']);
    await request(env.app).post('/api/admin/team').set(boss.auth).send({ fullName: 'Bad', email: 'bad1@test.dev', password: 'OpsPassword12', adminRole: 'support', permissions: ['everything'] }).expect(400);
    const login = async () => ({ Authorization: `Bearer ${(await request(env.app).post('/api/auth/login').send({ email: 'ops1@test.dev', password: 'OpsPassword12' }).expect(200)).body.token}` });
    let a = await login();
    // support by role could not see sports or revenue; the ticked list allows both and nothing else
    await request(env.app).get('/api/admin/sports').set(a).expect(200);
    await request(env.app).get('/api/admin/reports/revenue?from=2030-01-01&to=2030-01-31').set(a).expect(200);
    await request(env.app).get('/api/admin/payments').set(a).expect(403);
    await request(env.app).get('/api/admin/coupons').set(a).expect(403);
    await request(env.app).patch(`/api/admin/team/${created.id}`).set(boss.auth).send({ permissions: ['payments'] }).expect(200);
    await request(env.app).get('/api/admin/payments').set(a).expect(401); // the old session ended, so the change is not missed
    a = await login();
    await request(env.app).get('/api/admin/payments').set(a).expect(200);
    await request(env.app).get('/api/admin/sports').set(a).expect(403);
    await request(env.app).patch(`/api/admin/team/${created.id}`).set(boss.auth).send({ permissions: null }).expect(200); // back to the support role
    a = await login();
    await request(env.app).get('/api/admin/payments').set(a).expect(403);
    await request(env.app).get('/api/admin/tickets').set(a).expect(200);
    await request(env.app).patch(`/api/admin/team/${created.id}`).set(boss.auth).send({}).expect(400);
  });
});

describe('admin customers page', () => {
  it('lists customers with their activity and opens a full profile; support can read, owners cannot', async () => {
    const admin = await createAdmin(env); const support = await createAdmin(env, 'support');
    const f: any = await createApprovedVenue(env, admin);
    const c = await registerUser(env, 'customer', { name: 'Kavya Menon' });
    const sb = await startBooking(env, c, f, ist(dayAhead(9), '10:00'));
    await pay(env, c, sb.booking.body.bookingId, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    const list = (await request(env.app).get('/api/admin/customers?q=kavya').set(support.auth).expect(200)).body;
    expect(list.customers).toHaveLength(1); expect(list.customers[0]).toMatchObject({ full_name: 'Kavya Menon', bookings: 1, cancelled: 0, spent: 800 });
    expect(list.summary.customers).toBeGreaterThan(0);
    expect((await request(env.app).get('/api/admin/customers?q=zzzzzz').set(admin.auth)).body.customers).toEqual([]);
    expect((await request(env.app).get('/api/admin/customers?status=suspended&q=kavya').set(admin.auth)).body.customers).toEqual([]);
    const d = (await request(env.app).get(`/api/admin/customers/${c.id}`).set(admin.auth).expect(200)).body;
    expect(d.customer.full_name).toBe('Kavya Menon'); expect(d.stats).toMatchObject({ bookings: 1, spent: 800, refunded: 0, wallet: 0 });
    expect(d.bookings[0]).toMatchObject({ venue: 'Green Arena', area: 'Turf A', status: 'confirmed' });
    await request(env.app).get(`/api/admin/customers/${f.owner.id}`).set(admin.auth).expect(404); // an owner is not a customer
    await request(env.app).get('/api/admin/customers').set(f.owner.auth).expect(403);
  });
});

describe('admin reviews and wallets pages', () => {
  it('reviews: list, filter, hide; wallets: who holds credit', async () => {
    const admin = await createAdmin(env); const finance = await createAdmin(env, 'finance');
    const f: any = await createApprovedVenue(env, admin);
    const c = await registerUser(env, 'customer', { name: 'Review Rani' });
    const sb = await startBooking(env, c, f, ist(dayAhead(11), '10:00'));
    await pay(env, c, sb.booking.body.bookingId, sb.booking.body.order.id).then((r) => expect(r.status).toBe(200));
    await env.db.query(`INSERT INTO reviews (booking_id, venue_id, customer_id, rating, comment) VALUES ($1,$2,$3,2,'Floodlights were off')`, [sb.booking.body.bookingId, f.venue.id, c.id]);
    const all = (await request(env.app).get('/api/admin/reviews').set(admin.auth).expect(200)).body;
    expect(all.reviews).toHaveLength(1); expect(all.reviews[0]).toMatchObject({ rating: 2, customer_name: 'Review Rani', venue_name: 'Green Arena' }); expect(all.summary.total).toBe(1);
    expect((await request(env.app).get('/api/admin/reviews?rating=5').set(admin.auth)).body.reviews).toEqual([]);
    await request(env.app).patch(`/api/admin/reviews/${all.reviews[0].id}`).set(admin.auth).send({ isHidden: true }).expect(200);
    expect((await request(env.app).get('/api/admin/reviews?hidden=true').set(admin.auth)).body.reviews).toHaveLength(1);
    await request(env.app).get('/api/admin/reviews').set(finance.auth).expect(403);
    await request(env.app).post(`/api/admin/users/${c.id}/wallet`).set(finance.auth).send({ amount: 250, reason: 'Goodwill credit' }).expect(200);
    const w = (await request(env.app).get('/api/admin/wallets').set(finance.auth).expect(200)).body;
    expect(w.wallets).toHaveLength(1); expect(w.wallets[0]).toMatchObject({ full_name: 'Review Rani', balance: 250 }); expect(w.summary).toMatchObject({ customers: 1, outstanding: 250 });
    await request(env.app).get('/api/admin/wallets').set(c.auth).expect(403);
  });
});

describe('admin verifies the owner bank account', () => {
  it('the owners list shows the masked account and finance can verify it; support cannot', async () => {
    const admin = await createAdmin(env); const finance = await createAdmin(env, 'finance'); const support = await createAdmin(env, 'support');
    const f: any = await createApprovedVenue(env, admin);
    await env.db.query(`UPDATE owner_profiles SET bank_account_name='Mehta Sports', bank_account_number='123456789012', bank_ifsc='HDFC0001234', bank_verified=false WHERE user_id=$1`, [f.owner.id]);
    const row = (await request(env.app).get('/api/admin/owners').set(admin.auth).expect(200)).body.owners.find((o: any) => o.id === f.owner.id);
    expect(row).toMatchObject({ bank_account_name: 'Mehta Sports', bank_account_masked: '••••••••9012', bank_ifsc: 'HDFC0001234', bank_verified: false });
    expect(JSON.stringify(row)).not.toContain('123456789012'); // the full number never leaves the server
    await request(env.app).post(`/api/admin/owners/${f.owner.id}/bank-verification`).set(support.auth).send({ verified: true }).expect(403);
    await request(env.app).post(`/api/admin/owners/${f.owner.id}/bank-verification`).set(finance.auth).send({ verified: true }).expect(200);
    expect((await request(env.app).get('/api/admin/owners').set(admin.auth)).body.owners.find((o: any) => o.id === f.owner.id).bank_verified).toBe(true);
    await request(env.app).post(`/api/admin/owners/${f.owner.id}/bank-verification`).set(finance.auth).send({ verified: false }).expect(200);
  });
});

describe('publish and deactivate show up for customers at once', () => {
  it('a deactivated venue disappears from the customer portal; publishing brings it back', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const listed = async () => (await request(env.app).get('/api/venues').expect(200)).body.venues.some((v: any) => v.id === f.venue.id);
    expect(await listed()).toBe(true);
    await request(env.app).post(`/api/owner/venues/${f.venue.id}/unpublish`).set(f.owner.auth).expect(200);
    expect(await listed()).toBe(false);
    await request(env.app).get(`/api/venues/${f.venue.id}`).expect(404); // and its page is gone too
    await request(env.app).post(`/api/owner/venues/${f.venue.id}/publish`).set(f.owner.auth).expect(200);
    expect(await listed()).toBe(true);
    await request(env.app).get(`/api/venues/${f.venue.id}`).expect(200);
  });
});

describe('venue sports (chosen on the venue, areas pick from them)', () => {
  it('a venue sets the sports it offers; its areas can only use those; a sport in use cannot be removed', async () => {
    const admin = await createAdmin(env);
    const f: any = await createApprovedVenue(env, admin);
    const own = f.owner.auth;
    const sports = (await request(env.app).get('/api/sports')).body.sports as { id: number; slug: string }[];
    const bad = sports.find((s) => s.slug === 'badminton')!;
    // the helper's venue starts with the sports its area already uses (football, cricket)
    await request(env.app).put(`/api/owner/venues/${f.venue.id}/sports`).set(own).send({ sportIds: [] }).expect(400); // at least one
    await request(env.app).put(`/api/owner/venues/${f.venue.id}/sports`).set(own).send({ sportIds: [f.football.id] }).expect(409); // cricket is still on the area
    await request(env.app).put(`/api/owner/venues/${f.venue.id}/sports`).set(own).send({ sportIds: [f.football.id, f.cricket.id, bad.id] }).expect(200);
    expect((await request(env.app).get(`/api/owner/venues/${f.venue.id}`).set(own)).body.venue.sportIds.sort()).toEqual([f.football.id, f.cricket.id, bad.id].sort());
    await request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(own).send({ name: 'Court 2', sportIds: [bad.id] }).expect(201);
    const other = sports.find((s) => s.slug === 'hockey')!;
    const refused = await request(env.app).post(`/api/owner/venues/${f.venue.id}/areas`).set(own).send({ name: 'Court 3', sportIds: [other.id] }).expect(400);
    expect(refused.body.error.code).toBe('sport_not_offered_by_venue');
  });
});
