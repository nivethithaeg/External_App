import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, get, put } from '../lib/api';
import { useToast } from '../lib/toast';
import { Card } from './ui';

type Key = 'bookings' | 'reminders' | 'announcements' | 'venue_updates';
/** A venue owner's switches, as JusGo words them. */
const OWNER_ROWS: { key: Key; title: string; hint: string }[] = [
  { key: 'bookings', title: 'Booking notifications', hint: 'When a booking is created or cancelled.' },
  { key: 'venue_updates', title: 'Venue and playing area updates', hint: 'When venues, hours or blocks change.' }];
const ROWS: { key: Key; title: string; hint: string }[] = [
  { key: 'bookings', title: 'Booking and account updates', hint: 'Confirmations, cancellations, refunds, payouts and reschedules.' },
  { key: 'reminders', title: 'Game reminders', hint: 'A reminder about a day before, and another a couple of hours before.' },
  { key: 'announcements', title: 'Offers and news', hint: 'Announcements and promotions from KickOff.' }];

/** Email and push alerts can be switched off per category. Alerts inside the app stay on, and sign-in codes and password resets are always sent. */
export function NotificationPreferences({ owner = false }: { owner?: boolean }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notification-preferences'], queryFn: () => get<{ preferences: Record<Key, boolean> }>('/me/notification-preferences') });
  const save = useMutation({
    mutationFn: (patch: Partial<Record<Key, boolean>>) => put<{ preferences: Record<Key, boolean> }>('/me/notification-preferences', patch),
    onMutate: async (patch) => { await qc.cancelQueries({ queryKey: ['notification-preferences'] }); const prev = qc.getQueryData(['notification-preferences']); qc.setQueryData(['notification-preferences'], (o: any) => (o ? { preferences: { ...o.preferences, ...patch } } : o)); return { prev }; },
    onError: (e, _v, ctx) => { qc.setQueryData(['notification-preferences'], ctx?.prev); toast(apiError(e), 'error'); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });
  const prefs = q.data?.preferences;
  return (
    <Card className="p-6"><section aria-label="Notification preferences">
      <h2 className="text-2xl font-bold">{owner ? 'Notifications' : 'Email and push alerts'}</h2>
      <p className="mb-4 text-sm text-muted">Choose which alerts reach your email and phone. They always appear inside KickOff, and sign-in codes and password resets are always sent.</p>
      {!prefs ? <p className="text-sm text-muted">Loading…</p> : (
        <ul className="divide-y divide-line">{(owner ? OWNER_ROWS : ROWS.filter((r) => r.key !== 'venue_updates')).map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4 py-3">
            <div><p className="font-semibold">{r.title}</p><p className="text-xs text-muted">{r.hint}</p></div>
            <button type="button" role="switch" aria-checked={prefs[r.key]} aria-label={r.title} onClick={() => save.mutate({ [r.key]: !prefs[r.key] })}
              className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors duration-200 ${prefs[r.key] ? 'border-brand bg-brand' : 'border-line bg-surface2'}`}>
              <span aria-hidden="true" className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${prefs[r.key] ? 'translate-x-5' : ''}`} /></button>
          </li>))}</ul>)}
    </section></Card>
  );
}
