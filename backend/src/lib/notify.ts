import type { Db } from '../db.js';
import type { Realtime } from './realtime.js';
import type { Mailer } from './mailer.js';
import { renderEmail, type EmailRole } from './emailTemplate.js';
import type { Push } from './push.js';
import { can } from '../middleware/auth.js';

export type AlertCategory = 'bookings' | 'reminders' | 'announcements' | 'venue_updates';
export const ALERT_CATEGORIES: AlertCategory[] = ['bookings', 'reminders', 'announcements', 'venue_updates'];
/** Which preference switch governs an alert type. Admin alerts and everything else count as booking and account updates. */
export const categoryOf = (type?: string): AlertCategory => (type === 'booking_reminder' ? 'reminders' : type === 'announcement' ? 'announcements' : type === 'venue_status' || type === 'area_status' || type === 'venue_changes' ? 'venue_updates' : 'bookings'); // venue_updates: venues, playing areas, hours and blocks

export interface NotifyInput { title: string; body: string; type?: string; data?: Record<string, unknown>; email?: boolean }
export interface Notifier {
  notify(userId: string, n: NotifyInput): Promise<void>;
  /** Alerts every active admin whose role includes the permission (e.g. 'venues'); super admins always receive it. */
  notifyAdmins(permission: string, n: NotifyInput): Promise<void>;
}

/** In-app (DB + socket), push (FCM) and email delivery. Delivery failures never break the caller. */
export function createNotifier(db: Db, realtime: Realtime, mailer: Mailer, push: Push): Notifier {
  const self: Notifier = {
    async notify(userId, n) {
      try {
        const { rows } = await db.query(
          `INSERT INTO notifications (user_id, title, body, type, data) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [userId, n.title, n.body, n.type ?? 'general', JSON.stringify(n.data ?? {})]);
        realtime.toUser(userId, 'notification', rows[0]);
        // the in-app alert above always stays; email and push can be switched off per category in the person's settings
        const me = (await db.query<{ email: string; full_name: string; role: string; notification_prefs: Record<string, boolean> | null }>('SELECT email, full_name, role, notification_prefs FROM users WHERE id=$1', [userId])).rows[0];
        if (me?.notification_prefs?.[categoryOf(n.type)] === false) return;
        // phone push is not used: in-app and email only
        if (n.email && me?.email) await mailer.send(me.email, n.title, await emailFor(db, mailer, me, n));
      } catch (e) { console.error('[notify] failed', e); }
    },
    async notifyAdmins(permission, n) {
      try {
        const { rows } = await db.query<{ id: string; admin_role: string; admin_permissions: string[] | null }>(`SELECT id, admin_role, admin_permissions FROM users WHERE role='admin' AND is_active`);
        await Promise.all(rows.filter((a) => can(a.admin_role, permission, a.admin_permissions)).map((a) => self.notify(a.id, n)));
      } catch (e) { console.error('[notify] admin alert failed', e); }
    },
  };
  return self;
}
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const fmtWhen = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: tz || 'Asia/Kolkata', ...o }).format(d);
const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The email for one notification: the PlaynX design, with the booking's details and a button to the right page. */
async function emailFor(db: Db, mailer: Mailer, me: { full_name: string; role: string }, n: NotifyInput): Promise<string> {
  const appUrl = mailer.appUrl ?? 'http://localhost:5173';
  const role = me.role as EmailRole;
  const bookingId = typeof n.data?.bookingId === 'string' ? n.data.bookingId : undefined;
  let details: [string, string][] | undefined; let note: string | undefined; let reference: string | undefined;
  if (bookingId) {
    try {
      const b = (await db.query<{ reference: string; total: number; advance_amount: number | null; s: Date; e: Date; venue_name: string; area_name: string; timezone: string }>(
        `SELECT b.reference, b.total::float8 AS total, b.advance_amount::float8 AS advance_amount, lower(b.during) AS s, upper(b.during) AS e, v.name AS venue_name, a.name AS area_name, v.timezone
           FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN playing_areas a ON a.id=b.area_id WHERE b.id=$1`, [bookingId])).rows[0];
      if (b) {
        reference = b.reference;
        const s = new Date(b.s), e = new Date(b.e);
        details = [['Turf Name', `${b.venue_name} (${b.area_name})`], ['Date', `${fmtWhen(s, b.timezone, { day: 'numeric', month: 'short', year: 'numeric' })} (${fmtWhen(s, b.timezone, { weekday: 'short' })})`],
          ['Time', `${fmtWhen(s, b.timezone, { hour: '2-digit', minute: '2-digit', hour12: true })} – ${fmtWhen(e, b.timezone, { hour: '2-digit', minute: '2-digit', hour12: true })}`.toUpperCase()], ['Booking ID', b.reference]];
        note = b.advance_amount != null
          ? `Booking total ${rupees(b.total)}. Paid online ${rupees(b.advance_amount)} (advance), ${rupees(Math.max(0, b.total - b.advance_amount))} to pay at the venue.`
          : `Booking total ${rupees(b.total)}.`;
      }
    } catch { /* the email still goes without the details box */ }
  }
  const link = typeof n.data?.link === 'string' && n.data.link.startsWith('/') ? n.data.link : undefined;
  const cta = role === 'admin' ? { label: 'Open in admin portal', url: `${appUrl}${link ?? '/admin'}` }
    : role === 'owner' ? { label: bookingId ? 'View booking' : 'Open owner portal', url: `${appUrl}${bookingId && reference ? `/owner/bookings?q=${encodeURIComponent(reference)}` : link ?? '/owner'}` }
    : role === 'staff' ? { label: 'Open staff portal', url: `${appUrl}/staff` }
    : bookingId ? { label: 'View My Booking', url: `${appUrl}/bookings/${bookingId}` }
    : n.type === 'wallet' ? { label: 'Open my wallet', url: `${appUrl}/wallet` }
    : { label: 'Open PlaynX', url: `${appUrl}${link ?? '/home'}` };
  return renderEmail({ appUrl, ...mailer.brand, type: n.type, title: n.title, text: n.body, name: me.full_name, role, details, detailsNote: note, cta });
}
