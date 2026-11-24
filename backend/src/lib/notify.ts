import type { Db } from '../db.js';
import type { Realtime } from './realtime.js';
import type { Mailer } from './mailer.js';
import { emailLayout } from './mailer.js';
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
        const me = (await db.query<{ email: string; notification_prefs: Record<string, boolean> | null }>('SELECT email, notification_prefs FROM users WHERE id=$1', [userId])).rows[0];
        if (me?.notification_prefs?.[categoryOf(n.type)] === false) return;
        const user = { rows: me && n.email ? [{ email: me.email }] : [] as { email: string }[] }; // phone push is not used: in-app and email only
        if (n.email && user.rows[0]) await mailer.send(user.rows[0].email, n.title, emailLayout(n.title, `<p>${escapeHtml(n.body)}</p>`));
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
