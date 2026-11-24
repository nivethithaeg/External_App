import { Router } from 'express';
import { escrowByOwner, emptyEscrow, holdHours } from '../lib/escrow.js';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireActiveOwner, requireRole } from '../middleware/auth.js';
import { HttpError, badRequest, forbidden } from '../errors.js';
import { csv, page, parse } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { cancelBooking } from '../lib/bookings.js';
import { ownerAreaDays } from '../lib/ownerDay.js';
import { normalizePhone, INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE } from '../lib/phone.js';

const LIVE = `('confirmed','completed')`;
const ACTIVE = `('pending','confirmed','completed','blocked')`;
const iso = z.iso.datetime({ offset: true });

export function ownerInsightRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('owner'), requireActiveOwner(ctx, ['/application', '/activity', '/account/close', '/account/close-info']));
  const uid = (req: any) => req.user!.id as string;
  const mask = (s?: string | null) => (s ? `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : null);

  /** Open playing areas with free slots that have no price today or tomorrow (the hours are set, the price is not). */
  function unpricedOf(days: Awaited<ReturnType<typeof ownerAreaDays>>) {
    const out: { id: string; name: string; venueId: string; venueName: string; today: number; tomorrow: number }[] = [];
    for (const d of days) {
      if (!d.unpriced) continue;
      let o = out.find((x) => x.id === d.areaId);
      if (!o) { o = { id: d.areaId, name: d.areaName, venueId: d.venueId, venueName: d.venueName, today: 0, tomorrow: 0 }; out.push(o); }
      if (d.dayOffset === 0) o.today = d.unpriced; else o.tomorrow = d.unpriced;
    }
    return out;
  }
  /** The portal stays closed (only pricing and hours open) while an area has opening hours today but no price for its slots. */
  r.get('/pricing-gate', async (req, res) => {
    const areas = (await ownerAreaDays(ctx.db, uid(req), { onlyLive: false, days: [0] })).filter((d) => d.unpriced > 0)
      .map((d) => ({ id: d.areaId, name: d.areaName, venueId: d.venueId, venueName: d.venueName, today: d.unpriced, tomorrow: 0 }));
    res.json({ blocked: areas.length > 0, areas });
  });

  // ------------------------------------------------------------ overview
  r.get('/overview', async (req, res) => {
    const id = uid(req);
    const local = (col: string) => `(${col} AT TIME ZONE v.timezone)`;
    const nowLocal = `(now() AT TIME ZONE v.timezone)`;
    const q = (sql: string, p: unknown[] = [id]) => ctx.db.query(sql, p);
    const [counts, today, month, upcoming, awaiting, slots, status, schedule, next, popular, tx, venues, d, w, m, y, gtv] = await Promise.all([
      q(`SELECT (SELECT count(*)::int FROM venues WHERE owner_id=$1) AS venues, (SELECT count(*)::int FROM venues WHERE owner_id=$1 AND status='approved') AS active_venues,
            (SELECT count(*)::int FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE v.owner_id=$1) AS areas,
            (SELECT count(*)::int FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE v.owner_id=$1 AND a.is_active) AS active_areas`),
      q(`SELECT count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue FROM bookings b JOIN venues v ON v.id=b.venue_id
          WHERE v.owner_id=$1 AND b.status IN ${LIVE} AND ${local('lower(b.during)')}::date = ${nowLocal}::date`),
      q(`SELECT count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue FROM bookings b JOIN venues v ON v.id=b.venue_id
          WHERE v.owner_id=$1 AND b.status IN ${LIVE} AND date_trunc('month', ${local('lower(b.during)')}) = date_trunc('month', ${nowLocal})`),
      q(`SELECT count(*)::int AS n FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status='confirmed' AND upper(b.during) > now()`),
      q(`SELECT count(*)::int AS n FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status='pending' AND b.expires_at > now()`),
      q(`WITH a AS (
           SELECT pa.id, pa.slot_minutes,
             ((${nowLocal})::date + ar.open_time) AT TIME ZONE v.timezone AS o_start, ((${nowLocal})::date + ar.close_time) AT TIME ZONE v.timezone AS o_end
           FROM playing_areas pa JOIN venues v ON v.id=pa.venue_id AND v.status='approved' AND v.owner_id=$1
           JOIN playing_area_hours ar ON ar.playing_area_id=pa.id AND ar.day_of_week = extract(dow FROM ${nowLocal})::int AND NOT ar.is_closed WHERE pa.is_active)
         SELECT COALESCE(sum(extract(epoch FROM (o_end - o_start)) / 60 / slot_minutes),0)::float8 AS total,
           COALESCE(sum((SELECT COALESCE(sum(extract(epoch FROM (upper(x.r) - lower(x.r))) / 60),0) FROM (
              SELECT b.during * tstzrange(a.o_start, a.o_end) AS r FROM bookings b WHERE b.area_id = a.id AND b.status IN ${ACTIVE} AND b.during && tstzrange(a.o_start, a.o_end)) x) / slot_minutes),0)::float8 AS booked FROM a`),
      q(`SELECT b.status, count(*)::int AS n FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status <> 'blocked' GROUP BY b.status`),
      q(`SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, COALESCE(u.full_name, b.walkin_name) AS customer_name, v.name AS venue_name, v.timezone, a.name AS area_name, sp.name AS sport
          FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id LEFT JOIN sports sp ON sp.id=b.sport_id
          WHERE v.owner_id=$1 AND b.status IN ('pending','confirmed','completed') AND ${local('lower(b.during)')}::date = ${nowLocal}::date ORDER BY lower(b.during)`),
      q(`SELECT b.id, b.reference, b.status, lower(b.during) AS starts_at, upper(b.during) AS ends_at, COALESCE(u.full_name, b.walkin_name) AS customer_name, v.name AS venue_name, v.timezone, a.name AS area_name, sp.name AS sport
          FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id LEFT JOIN sports sp ON sp.id=b.sport_id
          WHERE v.owner_id=$1 AND b.status='confirmed' AND lower(b.during) > now() ORDER BY lower(b.during) LIMIT 8`),
      q(`SELECT a.id, a.name, v.name AS venue_name, count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue FROM bookings b JOIN playing_areas a ON a.id=b.area_id JOIN venues v ON v.id=b.venue_id
          WHERE v.owner_id=$1 AND b.status IN ${LIVE} GROUP BY a.id, a.name, v.name ORDER BY bookings DESC LIMIT 5`),
      q(`SELECT p.id, p.amount, p.status, p.method, COALESCE(p.paid_at, p.created_at) AS at, b.reference, b.owner_amount FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN venues v ON v.id=b.venue_id
          WHERE v.owner_id=$1 AND p.status <> 'created' ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT 6`),
      q(`SELECT id, name, city, status, rejection_reason FROM venues WHERE owner_id=$1 ORDER BY created_at DESC`),
      ...(['day', 'week', 'month', 'year'] as const).map((g) => q(
        `SELECT to_char(date_trunc('${g}', ${local('lower(b.during)')}), '${g === 'year' ? 'YYYY' : g === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}') AS period, count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue
           FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status IN ${LIVE} AND lower(b.during) >= now() - interval '${{ day: '30 days', week: '84 days', month: '365 days', year: '1825 days' }[g]}'
           GROUP BY 1 ORDER BY 1`)),
      q(`SELECT COALESCE(sum(b.total),0)::float8 AS gtv FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status IN ${LIVE}`), // Total Revenue (GTV): what customers paid or owe for live bookings
    ]);
    const total = slots.rows[0].total, booked = slots.rows[0].booked;
    // notices on the dashboard (as JusGo): areas the owner closed, and open areas with free slots that have no price today or tomorrow
    const areaRows = (await ctx.db.query(
      `SELECT a.id, a.is_active, a.name, a.venue_id FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE v.owner_id=$1 AND v.status='approved' AND a.approval_status='approved' ORDER BY v.name, a.name`, [uid(req)])).rows;
    const closedAreas = areaRows.filter((a: any) => !a.is_active).map((a: any) => ({ id: a.id, name: a.name, venueId: a.venue_id }));
    const liveDays = await ownerAreaDays(ctx.db, uid(req), { onlyLive: true, days: [0, 1] });
    const unpricedAreas = unpricedOf(liveDays);
    // Open slots today, as "open / all": open = free slots still to come that a customer can book; all = every slot of today
    const todayDays = liveDays.filter((d) => d.dayOffset === 0);
    const slotsOpen = todayDays.reduce((n, d) => n + d.open, 0), slotsAll = todayDays.reduce((n, d) => n + d.total, 0);
    const trend = (await ctx.db.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS period, COALESCE(c.n, 0)::int AS bookings
         FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 29, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') AS d(day)
         LEFT JOIN (SELECT (lower(b.during) AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS n FROM bookings b JOIN venues v ON v.id=b.venue_id
                     WHERE v.owner_id=$1 AND b.block_kind IS NULL AND b.status IN ('confirmed','completed') GROUP BY 1) c ON c.day = d.day::date ORDER BY d.day`, [uid(req)])).rows;
    res.json({
      slotsToday: { open: slotsOpen, total: slotsAll }, trend, closedAreas, unpricedAreas,
      counts: { ...counts.rows[0], gtv: gtv.rows[0].gtv }, today: today.rows[0], month: month.rows[0], upcoming: upcoming.rows[0].n, awaitingPayment: awaiting.rows[0].n,
      slots: { total: Math.round(total), booked: Math.round(booked), available: Math.max(0, Math.round(total - booked)), occupancyPct: total > 0 ? Math.round((booked / total) * 1000) / 10 : 0 },
      statusBreakdown: status.rows, schedule: schedule.rows, nextBookings: next.rows, popularAreas: popular.rows, recentTransactions: tx.rows, venues: venues.rows,
      revenue: { day: d.rows, week: w.rows, month: m.rows, year: y.rows },
    });
  });

  // ------------------------------------------------- cross-venue listings
  r.get('/areas', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT a.id, a.name, a.surface, a.capacity, a.slot_minutes, a.min_duration_minutes, a.max_duration_minutes, a.is_active, v.id AS venue_id, v.name AS venue_name, v.status AS venue_status,
         (SELECT COALESCE(json_agg(sp.name ORDER BY sp.name), '[]') FROM playing_area_sports s JOIN sports sp ON sp.id=s.sport_id WHERE s.playing_area_id=a.id) AS sports,
         (SELECT COALESCE(json_agg(s.sport_id ORDER BY s.sport_id), '[]') FROM playing_area_sports s WHERE s.playing_area_id=a.id) AS sport_ids,
         (SELECT min(price_per_hour) FROM pricing_rules p WHERE p.area_id=a.id)::float8 AS min_price, (SELECT max(price_per_hour) FROM pricing_rules p WHERE p.area_id=a.id)::float8 AS max_price,
         (SELECT count(*)::int FROM playing_area_hours d WHERE d.playing_area_id=a.id AND NOT d.is_closed) AS open_days,
         (SELECT count(*)::int FROM bookings b WHERE b.area_id=a.id AND b.status IN ${LIVE}) AS bookings
       FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE v.owner_id=$1 ORDER BY v.name, a.name`, [uid(req)]);
    res.json({ areas: rows });
  });

  r.get('/media', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT i.id, i.url, i.kind, i.is_cover, v.id AS venue_id, v.name AS venue_name FROM venue_images i JOIN venues v ON v.id=i.venue_id WHERE v.owner_id=$1 ORDER BY v.name, i.is_cover DESC, i.sort_order`, [uid(req)]);
    res.json({ media: rows });
  });

  r.get('/documents', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT d.id, d.doc_type, CASE WHEN d.url LIKE 'private:%' THEN NULL ELSE d.url END AS url, d.status, d.note, d.created_at, v.id AS venue_id, v.name AS venue_name FROM venue_documents d JOIN venues v ON v.id=d.venue_id WHERE v.owner_id=$1 ORDER BY d.created_at DESC`, [uid(req)]);
    res.json({ documents: rows });
  });

  // ------------------------------------------------------------ calendar
  r.get('/calendar', async (req, res) => {
    const f = parse(z.object({ from: iso, to: iso, venueId: z.uuid().optional(), areaId: z.uuid().optional() }), req.query);
    if (new Date(f.to).getTime() - new Date(f.from).getTime() > 62 * 86400000) throw badRequest('Choose a range of at most 62 days');
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.status, b.block_kind, b.reference, b.notes, lower(b.during) AS starts_at, upper(b.during) AS ends_at, b.area_id, a.name AS area_name, v.id AS venue_id, v.name AS venue_name, v.timezone,
              COALESCE(u.full_name, b.walkin_name) AS customer_name, b.source, sp.name AS sport, b.total
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN users u ON u.id=b.customer_id LEFT JOIN sports sp ON sp.id=b.sport_id
        WHERE v.owner_id=$1 AND b.status IN ('pending','confirmed','completed','blocked') AND ($4::uuid IS NULL OR v.id=$4) AND ($5::uuid IS NULL OR a.id=$5)
          AND b.during && tstzrange($2::timestamptz, $3::timestamptz, '[)') AND (b.status <> 'pending' OR b.expires_at > now()) ORDER BY lower(b.during)`,
      [uid(req), f.from, f.to, f.venueId ?? null, f.areaId ?? null]);
    res.json({ items: rows });
  });

  // ------------------------------------------------ blocked slots / maintenance
  r.get('/blocks', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT b.id, b.block_kind AS kind, b.notes AS reason, lower(b.during) AS starts_at, upper(b.during) AS ends_at, a.id AS area_id, a.name AS area_name, v.name AS venue_name, v.timezone
         FROM bookings b JOIN playing_areas a ON a.id=b.area_id JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status='blocked' AND upper(b.during) > now() ORDER BY lower(b.during)`, [uid(req)]);
    res.json({ blocks: rows });
  });

  /** Block or schedule maintenance on several areas at once, optionally repeating weekly. Each slot is validated independently by the DB constraint. */
  r.post('/blocks/bulk', async (req, res) => {
    const b = parse(z.object({
      areaIds: z.array(z.uuid()).min(1).max(20), startsAt: iso, endsAt: iso, kind: z.enum(['blocked', 'maintenance']).default('blocked'),
      reason: z.string().trim().max(200).optional(), repeatWeeks: z.number().int().min(0).max(26).default(0),
      // a date range with chosen weekdays (JusGo's "start date / end date / select days")
      endDate: z.iso.date().optional(), weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      // an event or academy that pays for the time: who, how much, how it was paid
      customerName: z.string().trim().min(2).max(100).optional(), customerPhone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE).optional(),
      amount: z.number().min(0).max(1000000).optional(), amountPaid: z.number().min(0).max(1000000).optional(), paymentMethod: z.enum(['cash', 'upi', 'card', 'unpaid']).default('cash'),
      eventKind: z.enum(['event', 'academic']).default('event'),
      cancelBookings: z.boolean().default(false), // booked slots inside the block: cancel them (with the usual refund) instead of skipping
    }).refine((x) => new Date(x.endsAt) > new Date(x.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] })
      .refine((x) => !x.customerName || !!x.customerPhone, { message: 'Enter the customer mobile number', path: ['customerPhone'] }), req.body);
    const areas = (await ctx.db.query(`SELECT a.id, a.venue_id, a.name, v.owner_id FROM playing_areas a JOIN venues v ON v.id=a.venue_id WHERE a.id = ANY($1)`, [b.areaIds])).rows;
    if (areas.length !== new Set(b.areaIds).size) throw badRequest('One or more playing areas do not exist', 'bad_area');
    if (areas.some((a: any) => a.owner_id !== uid(req))) throw forbidden();
    // the dates to block: every chosen weekday from the start date to the end date, or the old "repeat weekly" way
    const first = new Date(b.startsAt), len = new Date(b.endsAt).getTime() - first.getTime();
    const IST = 330 * 60000; const days: Date[] = [];
    if (b.endDate) {
      const lastMs = new Date(`${b.endDate}T00:00:00+05:30`).getTime();
      const span = Math.floor((lastMs - new Date(`${new Date(first.getTime() + IST).toISOString().slice(0, 10)}T00:00:00+05:30`).getTime()) / 86400000);
      if (span < 0) throw badRequest('The end date cannot be before the start date', 'validation_error');
      if (span > 120) throw badRequest('Block at most 120 days at a time', 'validation_error');
      for (let d = 0; d <= span; d++) { const s = new Date(first.getTime() + d * 86400000); if (!b.weekdays?.length || b.weekdays.includes(new Date(s.getTime() + IST).getUTCDay())) days.push(s); }
      if (!days.length) throw badRequest('None of the chosen days fall between the start and end dates', 'validation_error');
    } else for (let w = 0; w <= b.repeatWeeks; w++) days.push(new Date(first.getTime() + w * 7 * 86400000));
    const event = !!b.customerName; const amount = b.amount ?? 0;
    const paid = event ? Math.min(amount, b.amountPaid ?? (b.paymentMethod === 'unpaid' ? 0 : amount)) : 0;
    const created: string[] = []; const conflicts: { area: string; startsAt: string }[] = []; let cancelled = 0;
    for (const a of areas) for (const s of days) {
      const e = new Date(s.getTime() + len);
      if (b.cancelBookings) { // free the time: cancel the live bookings that overlap it, the way a venue cancellation always works (full refund)
        const clash = (await ctx.db.query(`SELECT id FROM bookings WHERE area_id=$1 AND status='confirmed' AND during && tstzrange($2::timestamptz,$3::timestamptz,'[)')`, [a.id, s.toISOString(), e.toISOString()])).rows;
        for (const c of clash) {
          try { await cancelBooking(ctx, req.user!, c.id, b.reason ? `The venue blocked this time: ${b.reason}` : 'The venue blocked this time'); cancelled++; }
          catch (err: any) { if (!(err instanceof HttpError)) throw err; } // e.g. its refund could not be issued: leave that booking alone; the slot is then reported as a conflict below
        }
      }
      try {
        const ins = await ctx.db.query(
          `INSERT INTO bookings (reference, venue_id, area_id, during, status, notes, block_kind, source, walkin_name, walkin_phone, subtotal, total, commission_rate, commission_amount, owner_amount, payment_method, amount_paid, event_kind, event_title)
           VALUES ($1,$2,$3,tstzrange($4::timestamptz,$5::timestamptz,'[)'),'blocked',$6,$7, $8,$9,$10, $11,$11,0,0,$11, $12,$13,$14,$15) RETURNING id`,
          [`BLK-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100000)}`, a.venue_id, a.id, s.toISOString(), e.toISOString(), b.reason ?? null, b.kind,
           event ? 'offline' : 'online', event ? b.customerName : null, event ? normalizePhone(b.customerPhone!) : null, event ? amount : 0, event ? b.paymentMethod : null, event ? paid : null, event ? b.eventKind : null, event ? (b.reason ?? null) : null]);
        created.push(ins.rows[0].id);
      } catch (err: any) { if (err?.code === '23P01') conflicts.push({ area: a.name, startsAt: s.toISOString() }); else throw err; }
    }
    // a block over a date range with chosen weekdays is also kept as a weekly block (weekly_blocks): what was blocked, for which days and period
    const t0 = new Date(first.getTime() + IST).toISOString().slice(11, 16), t1 = new Date(first.getTime() + len + IST).toISOString().slice(11, 16);
    if (b.endDate && created.length && t1 > t0) {
      for (const a of areas) await ctx.db.query(
        `INSERT INTO weekly_blocks (playing_area_id, days_of_week, start_time, end_time, reason, note, created_by, valid_from, valid_until, event_details) VALUES ($1,$2::smallint[],$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [a.id, b.weekdays?.length ? b.weekdays : [0, 1, 2, 3, 4, 5, 6], t0, t1, (b.reason ?? (b.kind === 'maintenance' ? 'Maintenance' : 'Blocked')).slice(0, 60).padEnd(2, ' '), b.reason ? b.reason.slice(0, 200) : null, uid(req),
         new Date(first.getTime() + IST).toISOString().slice(0, 10), b.endDate, event ? JSON.stringify({ customerName: b.customerName, customerPhone: normalizePhone(b.customerPhone!), amount, amountPaid: paid, kind: b.eventKind }) : null]);
    }
    for (const v of new Set(areas.map((a: any) => a.venue_id))) ctx.realtime.toVenue(v as string, 'slots:changed', {});
    await audit(ctx.db, req, 'slots.bulk_block', 'venue', null, { kind: b.kind, created: created.length, conflicts: conflicts.length, cancelledBookings: cancelled, event });
    res.status(created.length ? 201 : 409).json({ created: created.length, conflicts, cancelled });
  });

  // -------------------------------------------------------------- refunds
  r.get('/refunds', async (req, res) => {
    const { limit, offset } = page(req.query, 100);
    const { rows } = await ctx.db.query(
      `SELECT rf.id, rf.amount, rf.status, rf.reason, rf.created_at, rf.processed_at, b.reference, b.total AS booking_total, v.name AS venue_name, v.cancellation_hours, p.razorpay_payment_id
         FROM refunds rf JOIN bookings b ON b.id=rf.booking_id JOIN venues v ON v.id=b.venue_id JOIN payments p ON p.id=rf.payment_id WHERE v.owner_id=$1 ORDER BY rf.created_at DESC LIMIT $2 OFFSET $3`, [uid(req), limit, offset]);
    // bookings the owner made: cancelled with money already collected at the venue, so the owner gives it back and records it
    const walkIns = (await ctx.db.query(
      `SELECT b.id, b.reference, b.walkin_name AS name, b.walkin_phone AS mobile, v.name AS venue_name, a.name AS area_name, lower(b.during) AS starts_at, upper(b.during) AS ends_at, v.timezone,
              b.amount_paid::float8 AS paid, b.refund_amount::float8 AS refunded, b.refund_mode, (b.amount_paid - b.refund_amount)::float8 AS to_give_back, b.cancel_reason, b.deleted_at
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id
        WHERE v.owner_id=$1 AND b.source='offline' AND b.status='cancelled' AND b.deleted_at IS NULL AND (b.block_kind IS NULL OR b.event_kind IS NOT NULL) ORDER BY b.cancelled_at DESC NULLS LAST LIMIT 200`, [uid(req)])).rows;
    res.json({ walkIns, refunds: rows.map((x: any) => ({ ...x, razorpay_payment_id: x.razorpay_payment_id ? `…${String(x.razorpay_payment_id).slice(-6)}` : null })) });
  });

  // --------------------------------------------------------- settlements
  r.get('/settlements', async (req, res) => {
    const id = uid(req);
    const [earn, payouts, bank] = await Promise.all([
      ctx.db.query(`SELECT COALESCE(sum(b.owner_amount),0)::float8 AS total, COALESCE(sum(b.owner_amount) FILTER (WHERE b.status='completed'),0)::float8 AS settleable
                      FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE v.owner_id=$1 AND b.status IN ${LIVE} AND b.source='online'`, [id]),
      ctx.db.query('SELECT id, amount, period_start, period_end, status, reference, paid_at, created_at, is_test FROM owner_payouts WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 200', [id]),
      ctx.db.query('SELECT bank_account_name, bank_account_number, bank_ifsc, upi_id, bank_verified FROM owner_profiles WHERE user_id=$1', [id]),
    ]);
    const paid = payouts.rows.filter((p: any) => p.status === 'paid').reduce((s: number, p: any) => s + Number(p.amount), 0);
    const pending = payouts.rows.filter((p: any) => p.status === 'pending' || p.status === 'processing').reduce((s: number, p: any) => s + Number(p.amount), 0);
    const b = bank.rows[0];
    const e = (await escrowByOwner(ctx.db, ctx.now(), id)).get(id) ?? emptyEscrow;
    res.json({
      // customers pay KickOff first: money is released to the owner holdHours after the game, unless the customer has an open complaint
      summary: { totalEarnings: earn.rows[0].total, completed: Math.round(paid * 100) / 100, testPaid: Math.round(payouts.rows.filter((p: any) => p.status === 'paid' && p.is_test).reduce((n: number, p: any) => n + Number(p.amount), 0) * 100) / 100, pending: Math.round(pending * 100) / 100, available: Math.max(0, Math.round((e.released - paid - pending) * 100) / 100), holding: e.holding, disputed: e.disputed, holdHours: await holdHours(ctx.db) },
      payouts: payouts.rows, bank: { accountName: b.bank_account_name, accountNumber: mask(b.bank_account_number), ifsc: b.bank_ifsc, upi: b.upi_id, verified: b.bank_verified },
    });
  });
  r.get('/settlements/statement.csv', async (req, res) => {
    const { rows } = await ctx.db.query(`SELECT id AS settlement_ref, period_start, period_end, amount, status, reference AS bank_reference, paid_at FROM owner_payouts WHERE owner_id=$1 ORDER BY created_at DESC`, [uid(req)]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="settlement-statement.csv"');
    res.send(rows.length ? csv(rows) : 'No settlements yet');
  });

  // ----------------------------------------------------------- analytics
  /** What is left before the owner's venue can take bookings, in the order to do it. */
  r.get('/checklist', async (req, res) => {
    const id = uid(req);
    const op = (await ctx.db.query('SELECT verification_status, bank_account_number FROM owner_profiles WHERE user_id=$1', [id])).rows[0];
    const v = (await ctx.db.query(`SELECT id, name, status FROM venues WHERE owner_id=$1 AND status <> 'suspended' ORDER BY created_at DESC LIMIT 1`, [id])).rows[0] ?? null;
    type Item = { id: string; label: string; done: boolean; link: string };
    const items: Item[] = [
      { id: 'verified', label: 'Business details verified by KickOff', done: op?.verification_status === 'verified', link: '/owner/account/business' },
      { id: 'bank', label: 'Bank account added for payouts', done: !!op?.bank_account_number, link: '/owner/account/bank' },
      { id: 'venue', label: 'Create your venue', done: !!v, link: '/owner/venues/new' }];
    if (v) {
      const c = (await ctx.db.query(
        `SELECT (SELECT count(*)::int FROM venue_images WHERE venue_id=$1 AND area_id IS NULL AND kind='image') AS images,
                (SELECT count(*)::int FROM venue_documents WHERE venue_id=$1 AND doc_type='Electricity bill' AND status <> 'rejected') AS docs,
                (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active) AS areas,
                (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active AND EXISTS (SELECT 1 FROM playing_area_sports s WHERE s.playing_area_id=a.id)) AS with_sports,
                (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active AND EXISTS (SELECT 1 FROM pricing_rules p WHERE p.area_id=a.id)) AS priced,
                (SELECT count(*)::int FROM playing_areas a WHERE a.venue_id=$1 AND a.is_active AND NOT EXISTS (SELECT 1 FROM venue_images i WHERE i.area_id=a.id AND i.geo_lat IS NOT NULL)) AS no_geo`, [v.id])).rows[0];
      items.push({ id: 'photos', label: 'Add venue photos', done: c.images > 0, link: `/owner/venues/${v.id}` });
      items.push({ id: 'bill', label: 'Upload the electricity bill', done: c.docs > 0, link: '/owner/account/business' });
      items.push({ id: 'area', label: 'Add a playing area with its sports', done: c.with_sports > 0, link: '/owner/areas' });
      items.push({ id: 'prices', label: 'Set prices and opening hours', done: c.areas > 0 && c.priced === c.areas, link: '/owner/hours' });
      if (ctx.cfg.REQUIRE_AREA_GEOTAG === 'true') items.push({ id: 'geo', label: 'Take a live photo of each playing area', done: c.areas > 0 && c.no_geo === 0, link: '/owner/areas' });
      items.push({ id: 'submit', label: 'Send the venue for approval', done: ['pending', 'ready', 'approved'].includes(v.status), link: `/owner/venues/${v.id}` });
      items.push({ id: 'live', label: 'Approved and live for customers', done: v.status === 'approved', link: '/owner/venues' });
    }
    const done = items.filter((i) => i.done).length;
    res.json({ venue: v, items, done, total: items.length, complete: done === items.length });
  });

  /** Who keeps coming back: customers with two or more online bookings, and the best ones. */
  r.get('/reports/customers', async (req, res) => {
    const f = parse(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT b.customer_id, u.full_name, count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS spend, max(lower(b.during)) AS last_at
         FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.customer_id
        WHERE v.owner_id=$1 AND b.source='online' AND b.status IN ('confirmed','completed')
          AND ($2::date IS NULL OR lower(b.during)::date >= $2::date) AND ($3::date IS NULL OR lower(b.during)::date <= $3::date)
        GROUP BY b.customer_id, u.full_name ORDER BY count(*) DESC, sum(b.owner_amount) DESC`, [uid(req), f.from ?? null, f.to ?? null]);
    const repeat = rows.filter((r: any) => r.bookings >= 2).length;
    res.json({ customers: rows.length, repeatCustomers: repeat, repeatRate: rows.length ? Math.round((repeat / rows.length) * 1000) / 10 : 0,
      avgBookings: rows.length ? Math.round((rows.reduce((n: number, r: any) => n + r.bookings, 0) / rows.length) * 10) / 10 : 0,
      top: rows.slice(0, 8) });
  });

  /** Side-by-side numbers for each of the owner's venues over a date range, so branches can be compared. */
  r.get('/reports/venues-compare', async (req, res) => {
    const f = parse(z.object({ from: z.iso.date(), to: z.iso.date() }), req.query);
    if (new Date(f.to).getTime() - new Date(f.from).getTime() > 400 * 86400000) throw badRequest('Choose a range of at most 400 days');
    const p = [uid(req), f.from, f.to];
    const [money, occ, rating] = await Promise.all([
      ctx.db.query(`SELECT v.id, v.name, v.city,
          count(*) FILTER (WHERE b.status IN ${LIVE})::int AS bookings, count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled,
          COALESCE(sum(b.owner_amount) FILTER (WHERE b.status IN ${LIVE}),0)::float8 AS revenue, COALESCE(avg(b.total) FILTER (WHERE b.status IN ${LIVE}),0)::float8 AS avg_value,
          count(DISTINCT b.customer_id) FILTER (WHERE b.status IN ${LIVE} AND b.source='online')::int AS customers
         FROM venues v LEFT JOIN bookings b ON b.venue_id=v.id AND b.status <> 'blocked' AND (lower(b.during) AT TIME ZONE v.timezone)::date BETWEEN $2::date AND $3::date
        WHERE v.owner_id=$1 AND v.status IN ('approved','suspended') GROUP BY v.id, v.name, v.city`, p),
      ctx.db.query(`WITH days AS (SELECT d::date AS d FROM generate_series($2::date, $3::date, interval '1 day') d),
          s AS (SELECT v.id AS venue_id, pa.id AS area_id, days.d, ar.open_time, ar.close_time, v.timezone FROM playing_areas pa JOIN venues v ON v.id=pa.venue_id JOIN days ON true
                JOIN playing_area_hours ar ON ar.playing_area_id=pa.id AND ar.day_of_week = extract(dow FROM days.d)::int AND NOT ar.is_closed WHERE v.owner_id=$1 AND pa.is_active)
        SELECT venue_id, COALESCE(sum(extract(epoch FROM (close_time - open_time)) / 60),0)::float8 AS open_min,
          COALESCE(sum((SELECT COALESCE(sum(extract(epoch FROM (upper(x.r) - lower(x.r))) / 60),0) FROM (
            SELECT b.during * tstzrange((s.d + s.open_time) AT TIME ZONE s.timezone, (s.d + s.close_time) AT TIME ZONE s.timezone) AS r FROM bookings b
             WHERE b.area_id = s.area_id AND b.status IN ${LIVE} AND b.during && tstzrange((s.d + s.open_time) AT TIME ZONE s.timezone, (s.d + s.close_time) AT TIME ZONE s.timezone)) x)),0)::float8 AS booked_min
          FROM s GROUP BY venue_id`, p),
      ctx.db.query(`SELECT venue_id, round(avg(rating)::numeric, 1)::float8 AS rating, count(*)::int AS reviews FROM reviews WHERE venue_id IN (SELECT id FROM venues WHERE owner_id=$1) AND NOT is_hidden GROUP BY venue_id`, [uid(req)]),
    ]);
    const o = new Map(occ.rows.map((x: any) => [x.venue_id, x])); const rt = new Map(rating.rows.map((x: any) => [x.venue_id, x]));
    const venues = money.rows.map((v: any) => {
      const oc = o.get(v.id) as any; const rr = rt.get(v.id) as any; const total = v.bookings + v.cancelled;
      return { id: v.id, name: v.name, city: v.city, bookings: v.bookings, revenue: v.revenue, avgValue: Math.round(v.avg_value * 100) / 100, customers: v.customers,
        cancelRate: total ? Math.round((v.cancelled / total) * 1000) / 10 : 0, occupancyPct: oc && oc.open_min > 0 ? Math.round((oc.booked_min / oc.open_min) * 1000) / 10 : 0,
        rating: rr?.rating ?? null, reviews: rr?.reviews ?? 0 };
    }).sort((a: any, b: any) => b.revenue - a.revenue);
    const best = (k: 'revenue' | 'occupancyPct' | 'bookings') => (venues.length > 1 && venues[0] ? [...venues].sort((a: any, b: any) => b[k] - a[k])[0]?.name ?? null : null);
    res.json({ venues, totals: { revenue: venues.reduce((n: number, v: any) => n + v.revenue, 0), bookings: venues.reduce((n: number, v: any) => n + v.bookings, 0) },
      leaders: { revenue: best('revenue'), occupancy: best('occupancyPct'), bookings: best('bookings') } });
  });

  r.get('/analytics', async (req, res) => {
    const f = parse(z.object({ from: z.iso.date(), to: z.iso.date(), venueId: z.uuid().optional(), sportId: z.coerce.number().int().optional(), areaId: z.uuid().optional(), status: z.enum(['confirmed', 'completed', 'cancelled', 'pending']).optional(), source: z.enum(['online', 'offline']).optional(), groupBy: z.enum(['day', 'week', 'month']).default('day') }), req.query);
    if (new Date(f.to).getTime() - new Date(f.from).getTime() > 400 * 86400000) throw badRequest('Choose a range of at most 400 days');
    const p = [uid(req), f.from, f.to, f.venueId ?? null, f.sportId ?? null, f.areaId ?? null, f.status ?? null, f.source ?? null];
    const base = `FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id LEFT JOIN sports sp ON sp.id=b.sport_id
      WHERE v.owner_id=$1 AND b.status <> 'blocked' AND (b.status <> 'pending' OR b.expires_at > now()) AND (b.status <> 'expired')
        AND (lower(b.during) AT TIME ZONE v.timezone)::date BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR v.id=$4) AND ($5::int IS NULL OR b.sport_id=$5)
        AND ($6::uuid IS NULL OR a.id=$6) AND ($7::text IS NULL OR b.status=$7) AND ($8::text IS NULL OR (CASE WHEN b.source='offline' THEN 'offline' ELSE 'online' END)=$8)`;
    const [summary, trend, byVenue, byArea, bySport, peak, occ] = await Promise.all([
      ctx.db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE b.status='confirmed')::int AS confirmed, count(*) FILTER (WHERE b.status='completed')::int AS completed,
          count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled, count(*) FILTER (WHERE b.status='pending')::int AS pending,
          COALESCE(sum(b.total) FILTER (WHERE b.status IN ${LIVE}),0)::float8 AS gross, COALESCE(sum(b.owner_amount) FILTER (WHERE b.status IN ${LIVE}),0)::float8 AS net,
          COALESCE(avg(b.total) FILTER (WHERE b.status IN ${LIVE}),0)::float8 AS avg_value ${base}`, p),
      ctx.db.query(`SELECT to_char(date_trunc('${f.groupBy}', lower(b.during) AT TIME ZONE v.timezone), 'YYYY-MM-DD') AS period, count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue ${base} AND b.status IN ${LIVE} GROUP BY 1 ORDER BY 1`, p),
      ctx.db.query(`SELECT v.name, count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue ${base} AND b.status IN ${LIVE} GROUP BY v.id, v.name ORDER BY revenue DESC`, p),
      ctx.db.query(`SELECT a.name || ' · ' || v.name AS name, count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue ${base} AND b.status IN ${LIVE} GROUP BY a.id, a.name, v.name ORDER BY bookings DESC LIMIT 10`, p),
      ctx.db.query(`SELECT COALESCE(sp.name,'Unknown') AS name, count(*)::int AS bookings, COALESCE(sum(b.owner_amount),0)::float8 AS revenue ${base} AND b.status IN ${LIVE} GROUP BY sp.name ORDER BY bookings DESC`, p),
      ctx.db.query(`SELECT extract(hour FROM lower(b.during) AT TIME ZONE v.timezone)::int AS hour, count(*)::int AS bookings ${base} AND b.status IN ${LIVE} GROUP BY 1 ORDER BY 1`, p),
      ctx.db.query(`WITH days AS (SELECT d::date AS d FROM generate_series($2::date, $3::date, interval '1 day') d),
          s AS (SELECT pa.id AS area_id, days.d, ar.open_time, ar.close_time, v.timezone FROM playing_areas pa JOIN venues v ON v.id=pa.venue_id JOIN days ON true
                JOIN playing_area_hours ar ON ar.playing_area_id=pa.id AND ar.day_of_week = extract(dow FROM days.d)::int AND NOT ar.is_closed
                WHERE v.owner_id=$1 AND pa.is_active AND ($4::uuid IS NULL OR v.id=$4))
        SELECT COALESCE(sum(extract(epoch FROM (close_time - open_time)) / 60),0)::float8 AS open_min,
          COALESCE(sum((SELECT COALESCE(sum(extract(epoch FROM (upper(x.r) - lower(x.r))) / 60),0) FROM (
            SELECT b.during * tstzrange((s.d + s.open_time) AT TIME ZONE s.timezone, (s.d + s.close_time) AT TIME ZONE s.timezone) AS r FROM bookings b
             WHERE b.area_id = s.area_id AND b.status IN ${LIVE} AND ($5::int IS NULL OR b.sport_id=$5) AND b.during && tstzrange((s.d + s.open_time) AT TIME ZONE s.timezone, (s.d + s.close_time) AT TIME ZONE s.timezone)) x)),0)::float8 AS booked_min FROM s`, p.slice(0, 5)),
    ]);
    const o = occ.rows[0];
    const out = { summary: { ...summary.rows[0], occupancyPct: o.open_min > 0 ? Math.round((o.booked_min / o.open_min) * 1000) / 10 : 0 }, trend: trend.rows, byVenue: byVenue.rows, byArea: byArea.rows, bySport: bySport.rows, peakHours: peak.rows };
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="analytics-${f.from}-${f.to}.csv"`);
      return res.send(out.trend.length ? csv(out.trend) : 'No data');
    }
    res.json(out);
  });

  // ------------------------------------------------------------ security
  r.get('/security/login-history', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT action, ip, created_at FROM audit_logs WHERE actor_id=$1 AND action IN ('user.login','user.login_google','user.password_change','user.logout_all','user.password_reset') ORDER BY created_at DESC, id DESC LIMIT 30`, [uid(req)]);
    res.json({ events: rows });
  });

  // ------------------------------------------------------ pricing history
  r.get('/pricing/history', async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT l.created_at, l.metadata, a.name AS area_name, v.name AS venue_name FROM audit_logs l JOIN playing_areas a ON a.id::text = l.entity_id JOIN venues v ON v.id=a.venue_id
        WHERE l.action='pricing.update' AND v.owner_id=$1 ORDER BY l.created_at DESC LIMIT 50`, [uid(req)]);
    res.json({ history: rows });
  });

  // -------------------------------------------------------- bank (masked)
  r.get('/bank', async (req, res) => {
    const b = (await ctx.db.query('SELECT bank_account_name, bank_account_number, bank_ifsc, upi_id, bank_verified FROM owner_profiles WHERE user_id=$1', [uid(req)])).rows[0];
    res.json({ accountName: b.bank_account_name, accountNumber: mask(b.bank_account_number), ifsc: b.bank_ifsc, upi: b.upi_id, verified: b.bank_verified });
  });

  return r;
}
