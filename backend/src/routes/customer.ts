import { Router } from 'express';
import { ALERT_CATEGORIES } from '../lib/notify.js';
import { z } from 'zod';
import type { Ctx } from '../types.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { page, parse } from '../lib/http.js';
import { publicUser } from './auth.js';
import { checkedFile, upload } from '../lib/upload.js';
import { reviewBody } from './customerPortal.js';
import { normalizePhone, phoneCandidates, INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE } from '../lib/phone.js';
import { describeChange } from '../lib/ownerProfile.js';
import { sendStoredFile } from '../lib/private-file.js';

export function accountRoutes(ctx: Ctx) {
  const r = Router();
  r.use(authenticate(ctx));

  // ---- profile (customers and owners share the user row)
  r.get('/profile', async (req, res) => {
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [req.user!.id])).rows[0];
    const profile = req.user!.role === 'customer'
      ? (await ctx.db.query('SELECT avatar_url, city, birth_date, gender, preferred_sports, lat, lng FROM customer_profiles WHERE user_id=$1', [u.id])).rows[0]
      : req.user!.role === 'owner' ? (await ctx.db.query(
          `SELECT business_name, business_type, gstin, pan, address, verification_status, verification_note, bank_account_name, CASE WHEN bank_account_number IS NULL THEN NULL ELSE repeat('•', greatest(length(bank_account_number) - 4, 0)) || right(bank_account_number, 4) END AS bank_account_number, bank_ifsc, upi_id, bank_verified, alternate_phone FROM owner_profiles WHERE user_id=$1`, [u.id])).rows[0] : null;
    let pendingChange = null, lastDecision = null;
    if (req.user!.role === 'owner') {
      const ch = (await ctx.db.query(`SELECT id, changes AS fields, status, review_note AS note, created_at AS requested_at, reviewed_at FROM owner_profile_change_requests WHERE owner_id=$1 AND status IN ('pending','approved','rejected') ORDER BY (status='pending') DESC, COALESCE(reviewed_at, created_at) DESC LIMIT 2`, [u.id])).rows;
      const cur = (await ctx.db.query('SELECT * FROM owner_profiles WHERE user_id=$1', [u.id])).rows[0];
      const p = ch.find((c: any) => c.status === 'pending');
      if (p) pendingChange = { id: p.id, requestedAt: p.requested_at, changes: describeChange(p, cur) };
      const d = ch.find((c: any) => c.status !== 'pending');
      if (d && !p) lastDecision = { status: d.status, note: d.note, at: d.reviewed_at, changes: describeChange(d, cur) };
    }
    res.json({ user: publicUser(u), profile, pendingChange, lastDecision });
  });

  r.put('/profile', async (req, res) => {
    const b = parse(z.object({
      fullName: z.string().trim().min(2).max(100).optional(), phone: z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE).optional(),
      city: z.string().trim().max(80).optional(), birthDate: z.iso.date().optional(), avatarUrl: z.url().max(500).optional(),
      gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']).optional(), preferredSports: z.array(z.string().trim().max(40)).max(12).optional(),
      email: z.email().max(254).optional(),
      alternatePhone: z.union([z.string().regex(INDIAN_MOBILE, INDIAN_MOBILE_MESSAGE), z.literal('')]).nullable().optional(), // turf owners only; '' or null removes it
      lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
    }), req.body);
    if (b.alternatePhone !== undefined && req.user!.role !== 'owner') throw forbidden('Only turf owners can add a second phone number');
    await ctx.db.tx(async (q) => {
      const cur = (await q.query('SELECT phone, email FROM users WHERE id=$1', [req.user!.id])).rows[0];
      if (b.phone && normalizePhone(b.phone) !== (cur.phone ? normalizePhone(cur.phone) : null)) {
        if ((await q.query('SELECT 1 FROM users WHERE phone = ANY($1) AND id<>$2', [phoneCandidates(b.phone), req.user!.id])).rows[0]) throw conflict('That mobile number is already registered to another account', 'phone_taken');
        await q.query('UPDATE users SET phone=$2, phone_verified=false, updated_at=now() WHERE id=$1', [req.user!.id, normalizePhone(b.phone)]); // must be verified again
      }
      if (b.email && b.email.toLowerCase() !== String(cur.email).toLowerCase()) {
        if ((await q.query('SELECT 1 FROM users WHERE lower(email)=lower($1) AND id<>$2', [b.email, req.user!.id])).rows[0]) throw conflict('That email address is already registered to another account', 'email_taken');
        await q.query('UPDATE users SET email=$2, email_verified=false, updated_at=now() WHERE id=$1', [req.user!.id, b.email.toLowerCase()]); // must be verified again
      }
      if (b.alternatePhone !== undefined) { // the owner's second contact number: live at once, no approval
        const alt = b.alternatePhone ? normalizePhone(b.alternatePhone) : null;
        const main = (await q.query('SELECT phone FROM users WHERE id=$1', [req.user!.id])).rows[0].phone;
        if (alt && main && normalizePhone(main) === alt) throw badRequest('The second number must be different from your main mobile number.', 'duplicate_phone');
        await q.query('UPDATE owner_profiles SET alternate_phone=$2 WHERE user_id=$1', [req.user!.id, alt]);
      }
      if (b.fullName) await q.query('UPDATE users SET full_name=$2, updated_at=now() WHERE id=$1', [req.user!.id, b.fullName]);
      if (req.user!.role === 'customer')
      {
        const slugs = b.preferredSports ? (await q.query('SELECT slug FROM sports WHERE slug = ANY($1)', [b.preferredSports])).rows.map((r: any) => r.slug) : null;
        await q.query(`UPDATE customer_profiles SET city=COALESCE($2,city), birth_date=COALESCE($3,birth_date), avatar_url=COALESCE($4,avatar_url), lat=COALESCE($5,lat), lng=COALESCE($6,lng), gender=COALESCE($7,gender), preferred_sports=COALESCE($8,preferred_sports) WHERE user_id=$1`,
          [req.user!.id, b.city ?? null, b.birthDate ?? null, b.avatarUrl ?? null, b.lat ?? null, b.lng ?? null, b.gender ?? null, slugs]);
      }
    });
    const u = (await ctx.db.query('SELECT * FROM users WHERE id=$1', [req.user!.id])).rows[0];
    res.json({ user: publicUser(u) });
  });

  // ---- push device tokens
  /** Profile picture: image only, checked by file signature, stored with the other public media. */
  r.post('/profile/avatar', upload.single('file'), async (req, res) => {
    if (req.user!.role !== 'customer') throw forbidden();
    const f = checkedFile(req.file, ['image/jpeg', 'image/png', 'image/webp']);
    const url = await ctx.storage.upload(`avatars/${req.user!.id}`, '', f.buffer, f.type);
    await ctx.db.query('UPDATE customer_profiles SET avatar_url=$2 WHERE user_id=$1', [req.user!.id, url]);
    res.json({ avatarUrl: url });
  });


  // ---- notifications
  r.get('/notifications', async (req, res) => {
    const { limit, offset } = page(req.query);
    const type = typeof req.query.type === 'string' ? req.query.type.slice(0, 40) : null;
    const [list, unread] = await Promise.all([
      ctx.db.query('SELECT * FROM notifications WHERE user_id=$1 AND ($4::text IS NULL OR type=$4) ORDER BY created_at DESC LIMIT $2 OFFSET $3', [req.user!.id, limit, offset, type]),
      ctx.db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user!.id]),
    ]);
    res.json({ notifications: list.rows, unread: unread.rows[0].n });
  });
  r.post('/notifications/read', async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(200).optional() }), req.body ?? {});
    await ctx.db.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`, [req.user!.id, ids ?? null]);
    res.status(204).end();
  });

  // ---- favourites (customers)
  r.get('/favourites', requireRole('customer'), async (req, res) => {
    const { rows } = await ctx.db.query(
      `SELECT v.id, v.name, v.city, v.address, v.rating_avg, v.rating_count,
         (SELECT url FROM venue_images i WHERE i.venue_id=v.id AND i.area_id IS NULL AND i.kind='image' AND NOT i.is_pending ORDER BY i.is_cover DESC, i.sort_order LIMIT 1) AS cover_image,
         (SELECT min(pr.price_per_hour) FROM pricing_rules pr JOIN playing_areas a ON a.id=pr.area_id WHERE a.venue_id=v.id) AS min_price
       FROM favourites f JOIN venues v ON v.id=f.venue_id WHERE f.user_id=$1 AND v.status='approved' ORDER BY f.created_at DESC`, [req.user!.id]);
    res.json({ venues: rows });
  });
  r.put('/favourites/:venueId', requireRole('customer'), async (req, res) => {
    const id = parse(z.uuid(), req.params.venueId);
    const v = await ctx.db.query(`SELECT 1 FROM venues WHERE id=$1 AND status='approved'`, [id]);
    if (!v.rows[0]) throw notFound('Venue not found');
    await ctx.db.query('INSERT INTO favourites (user_id, venue_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user!.id, id]);
    res.status(204).end();
  });
  r.delete('/favourites/:venueId', requireRole('customer'), async (req, res) => {
    await ctx.db.query('DELETE FROM favourites WHERE user_id=$1 AND venue_id=$2', [req.user!.id, parse(z.uuid(), req.params.venueId)]);
    res.status(204).end();
  });

  // ---- which email and push alerts the person wants (in-app alerts always stay on)
  r.get('/notification-preferences', async (req, res) => {
    const prefs = (await ctx.db.query('SELECT notification_prefs FROM users WHERE id=$1', [req.user!.id])).rows[0]?.notification_prefs ?? {};
    res.json({ preferences: Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, prefs[c] !== false])) });
  });
  r.put('/notification-preferences', async (req, res) => {
    const b = parse(z.object({ bookings: z.boolean().optional(), reminders: z.boolean().optional(), announcements: z.boolean().optional(), venue_updates: z.boolean().optional() }), req.body);
    await ctx.db.query(`UPDATE users SET notification_prefs = notification_prefs || $2::jsonb WHERE id=$1`, [req.user!.id, JSON.stringify(b)]);
    const prefs = (await ctx.db.query('SELECT notification_prefs FROM users WHERE id=$1', [req.user!.id])).rows[0].notification_prefs;
    res.json({ preferences: Object.fromEntries(ALERT_CATEGORIES.map((c) => [c, prefs[c] !== false])) });
  });

  // ---- reviews (only for own completed/past confirmed bookings, one per booking)
  r.post('/reviews', requireRole('customer'), async (req, res) => {
    const b = parse(reviewBody.extend({ bookingId: z.uuid() }), req.body);
    const review = await ctx.db.tx(async (q) => {
      const bk = (await q.query(`SELECT id, venue_id, customer_id, status, upper(during) AS e FROM bookings WHERE id=$1`, [b.bookingId])).rows[0];
      if (!bk || bk.customer_id !== req.user!.id) throw notFound('Booking not found');
      if (!(bk.status === 'completed' || (bk.status === 'confirmed' && new Date(bk.e) <= ctx.now()))) throw conflict('You can review a booking after the game has been played', 'not_reviewable');
      const rv = (await q.query(`INSERT INTO reviews (booking_id, venue_id, customer_id, rating, comment, ground_rating, cleanliness_rating, facilities_rating, staff_rating) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [b.bookingId, bk.venue_id, req.user!.id, b.rating, b.comment ?? null, b.groundRating ?? null, b.cleanlinessRating ?? null, b.facilitiesRating ?? null, b.staffRating ?? null])).rows[0];
      await q.query(`UPDATE venues SET rating_avg=(SELECT round(avg(rating)::numeric,2) FROM reviews WHERE venue_id=$1 AND NOT is_hidden), rating_count=(SELECT count(*) FROM reviews WHERE venue_id=$1 AND NOT is_hidden) WHERE id=$1`, [bk.venue_id]);
      return rv;
    });
    res.status(201).json({ review });
  });

  // ---- support tickets (customers and owners)
  r.get('/tickets', async (req, res) => {
    const { rows } = await ctx.db.query(`SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100`, [req.user!.id]);
    res.json({ tickets: rows });
  });
  r.post('/tickets', async (req, res) => {
    const b = parse(z.object({ subject: z.string().trim().min(3).max(150), message: z.string().trim().min(5).max(3000), bookingId: z.uuid().optional(), priority: z.enum(['low', 'normal', 'high']).default('normal') }), req.body);
    const t = await ctx.db.tx(async (q) => {
      if (b.bookingId) {
        const own = await q.query('SELECT 1 FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.id=$1 AND (b.customer_id=$2 OR v.owner_id=$2)', [b.bookingId, req.user!.id]);
        if (!own.rows[0]) throw forbidden();
      }
      const t = (await q.query(`INSERT INTO support_tickets (user_id, booking_id, subject, priority) VALUES ($1,$2,$3,$4) RETURNING *`, [req.user!.id, b.bookingId ?? null, b.subject, b.priority])).rows[0];
      await q.query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)', [t.id, req.user!.id, b.message]);
      return t;
    });
    await ctx.notifier.notifyAdmins('tickets', { title: `New support ticket from ${req.user!.role}`, body: `${req.user!.fullName}: ${b.subject}`, type: 'admin_ticket_created', data: { link: '/admin/tickets' } });
    res.status(201).json({ ticket: t });
  });
  r.get('/tickets/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const t = (await ctx.db.query('SELECT * FROM support_tickets WHERE id=$1 AND user_id=$2', [id, req.user!.id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    const msgs = (await ctx.db.query(`SELECT m.id, m.body, m.created_at, u.full_name AS author, u.role AS author_role FROM ticket_messages m JOIN users u ON u.id=m.author_id WHERE m.ticket_id=$1 ORDER BY m.created_at`, [id])).rows;
    const attachments = (await ctx.db.query('SELECT id, kind, content_type, size_bytes, created_at FROM ticket_attachments WHERE ticket_id=$1 ORDER BY created_at', [id])).rows;
    res.json({ ticket: t, messages: msgs, attachments });
  });
  /** Photos and videos for a ticket the person raised: up to 10, images up to 8 MB and videos up to 50 MB. */
  r.post('/tickets/:id/attachments', upload.single('file'), async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const t = (await ctx.db.query('SELECT id FROM support_tickets WHERE id=$1 AND user_id=$2', [id, req.user!.id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    if (+(await ctx.db.query('SELECT count(*)::int AS n FROM ticket_attachments WHERE ticket_id=$1', [id])).rows[0].n >= 10) throw badRequest('A ticket can have at most 10 photos and videos', 'too_many_files');
    const f = checkedFile(req.file, ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
    const key = await ctx.storage.putPrivate(`ticket-attachments/${id}`, f.buffer, f.type);
    const a = (await ctx.db.query(`INSERT INTO ticket_attachments (ticket_id, uploaded_by, kind, content_type, size_bytes, file_ref) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, kind, content_type, size_bytes, created_at`,
      [id, req.user!.id, f.type.startsWith('video/') ? 'video' : 'image', f.type, f.buffer.length, `private:${key}`])).rows[0];
    res.status(201).json({ attachment: a });
  });
  r.get('/tickets/:id/attachments/:attId/file', async (req, res) => {
    const a = (await ctx.db.query(`SELECT a.file_ref FROM ticket_attachments a JOIN support_tickets t ON t.id=a.ticket_id WHERE a.id=$1 AND a.ticket_id=$2 AND t.user_id=$3`,
      [parse(z.uuid(), req.params.attId), parse(z.uuid(), req.params.id), req.user!.id])).rows[0];
    if (!a) throw notFound('File not found');
    await sendStoredFile(ctx, res, a.file_ref);
  });
  r.post('/tickets/:id/messages', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const { message } = parse(z.object({ message: z.string().trim().min(1).max(3000) }), req.body);
    const t = (await ctx.db.query('SELECT status FROM support_tickets WHERE id=$1 AND user_id=$2', [id, req.user!.id])).rows[0];
    if (!t) throw notFound('Ticket not found');
    await ctx.db.query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)', [id, req.user!.id, message]);
    await ctx.db.query(`UPDATE support_tickets SET updated_at=now(), status=CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE status END WHERE id=$1`, [id]);
    res.status(201).json({ ok: true });
  });

  return r;
}
