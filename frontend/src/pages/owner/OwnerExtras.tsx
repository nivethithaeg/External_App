import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, PasswordInput, QueryBoundary, Select, Table, Textarea } from '../../components/ui';
import { fmtDateTime, fmtRange, money, titleCase } from '../../lib/utils';

/* ------------------------------------------------------------- Activity log */
/** One plain sentence for an activity row: who did what, to what. Unknown actions fall back to their name. */
const money0 = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) ? money(Number(v)) : '');
export function describeActivity(a: any): string {
  const who = a.actor_name ?? 'The system'; const m = (a.metadata ?? {}) as Record<string, any>; const t = (a.target ?? {}) as Record<string, any>;
  const booking = t.reference ? `booking ${t.reference}` : 'a booking'; const at = t.venue ? ` at ${t.area ? `${t.area}, ` : ''}${t.venue}` : '';
  const person = t.person ?? m.fullName ?? m.name ?? 'a staff member'; const venue = t.venue ?? m.name ?? 'a venue'; const area = t.area ? `${t.area}${t.venue ? ` (${t.venue})` : ''}` : 'a playing area';
  const staffSide = a.actor_role === 'staff';
  const S: Record<string, string> = {
    'user.login': `${who} signed in${staffSide ? ' to the staff portal' : ''}.`, 'user.login_google': `${who} signed in with Google.`, 'user.logout_all': `${who} signed out on every device.`,
    'user.password_change': `${who} changed their password.`, 'user.password_reset': `${who} reset their password with an emailed code.`, 'user.password_set': `${who} set a password for the account.`,
    'user.mfa_failed': `${who} entered a wrong two-step sign-in code.`, 'user.mfa_enabled': `${who} turned on two-step sign-in.`, 'user.register': `${who} created the account.`, 'user.register_google': `${who} created the account with Google.`,
    'user.signup_completed': `${who} finished setting up the account.`, 'user.account_closed': `${who} closed the account.`,
    'staff.create': `${who} added a staff login for ${person}.`, 'staff.remove': `${who} removed the staff login of ${person}.`,
    'staff.permissions_changed': `${who} changed what ${person} is allowed to do.`, 'staff.venues_changed': `${who} changed which venues ${person} can work at.`,
    'booking.check_in': `${who} checked in ${t.customer ?? 'the player'} for ${booking}${at}.`, 'booking.edited': `${who} edited ${booking}${at}.`, 'booking.deleted': `${who} deleted ${booking}${at}.`,
    'booking.restored': `${who} restored ${booking}${at}.`, 'booking.admin_cancel': `PlaynX cancelled ${booking}${at}.`,
    'booking.payment_recorded': `${who} recorded a payment${m.amount ? ` of ${money0(m.amount)}` : ''}${m.mode ? ` by ${String(m.mode).toUpperCase()}` : ''} for ${t.title ? `the event "${t.title}"` : booking}${at}.`,
    'booking.payment_recorded_by_staff': `${who} recorded a payment${m.amount ? ` of ${money0(m.amount)}` : ''}${m.mode ? ` by ${String(m.mode).toUpperCase()}` : ''} for ${t.title ? `the event "${t.title}"` : booking}${at}.`,
    'block.created_by_staff': `${who} blocked ${t.area ?? 'a slot'}${t.venue ? ` at ${t.venue}` : ''}${m.reason ? ` because of "${m.reason}"` : ''}.`, 'block.removed_by_staff': `${who} opened a blocked slot again.`,
    'slots.bulk_block': `${who} blocked time on one or more playing areas.`,
    'venue.create': `${who} added the venue ${venue}.`, 'venue.publish': `${who} published ${venue} so customers can book it.`, 'venue.unpublish': `${who} hid ${venue} from customers.`,
    'venue.send_for_approval': `${who} sent ${venue} to PlaynX for approval.`, 'venue.submit': `${who} sent ${venue} to PlaynX for approval.`, 'venue.change_requested': `${who} asked PlaynX to approve changes to ${venue}.`,
    'venue.contact_updated': `${who} changed the contact numbers of ${venue}.`, 'venue.sports_set': `${who} changed the sports offered at ${venue}.`, 'venue.discount': `${who} changed the discount at ${venue}.`,
    'venue.price_adjustment': `${who} added a special-date price change at ${venue}.`, 'venue.price_adjustment_removed': `${who} removed a special-date price change at ${venue}.`, 'venue.geo_video': `${who} added a location video for ${venue}.`,
    'area.deletion_requested': `${who} asked PlaynX to delete ${area}.`, 'area.deletion_cancelled': `${who} took back the request to delete ${area}.`,
    'pricing.update': `${who} changed the prices of ${area}.`, 'pricing.date_updated': `${who} set prices for particular dates on ${area}.`,
    'application.personal_saved': `${who} saved their personal details in the application.`, 'application.business_saved': `${who} saved the business details in the application.`, 'application.identity_saved': `${who} saved the identity documents in the application.`,
    'owner.bank_added': `${who} added a bank account for payouts.`, 'bank.viewed': `${who} viewed the full bank account number.`, 'owner.payment_collection_changed': `${who} changed how customers pay when they book.`,
    'owner.business_type_change_requested': `${who} asked to change the business type.`, 'owner.business_type_change_cancelled': `${who} cancelled the request to change the business type.`,
    'owner_profile.change_requested': `${who} asked to change profile details.`, 'owner_profile.change_withdrawn': `${who} withdrew a profile change request.`,
    'owner_profile.change_approved': 'PlaynX approved a profile change.', 'owner_profile.change_rejected': 'PlaynX turned down a profile change.',
    'owner_document.view': `${who} opened an uploaded document.`, 'document.view': `${who} opened an uploaded document.`, 'jusgo.linked_existing': `${who} linked the JusGo account.`, 'sync_key.created': `${who} made a new API key for JusGo booking sync.`, 'sync_key.revoked': `${who} removed the JusGo booking sync key.`,
  };
  return S[a.action] ?? `${who}: ${titleCase(String(a.action).replace(/[._]/g, ' '))}.`;
}

const CAT_LABEL: Record<string, string> = { account: 'Sign-in & account', application: 'Application', venue: 'Venues', booking: 'Bookings', staff: 'Staff', payout: 'Payouts' };
export function OwnerActivityPage() {
  const [open, setOpen] = useState<any | null>(null); // the row whose details are on show
  const [category, setCategory] = useState(''); const [search, setSearch] = useState(''); const [by, setBy] = useState(''); const [resource, setResource] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const q = useQuery({ queryKey: ['owner-activity', category, search, by, resource, from, to], queryFn: () => get<{ activity: any[]; categories: string[]; resources: string[] }>('/owner/activity', { ...(category ? { category } : {}), ...(search ? { search } : {}), ...(by ? { by } : {}), ...(resource ? { resource } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Activity Log" subtitle="What you and your staff did on your account: who, what and when." />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Show activity" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All activities</option>{Object.entries(CAT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select label="Done by" value={by} onChange={(e) => setBy(e.target.value)}><option value="">Everyone</option><option value="owner">You</option><option value="staff">All staff</option></Select>
        <Select label="Resource" value={resource} onChange={(e) => setResource(e.target.value)}><option value="">Any resource</option>{(q.data?.resources ?? []).map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select>
        <Input label="Search" placeholder="Name, venue, booking or what happened" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Input label="From (optional)" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /><Input label="To (optional)" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>
      <QueryBoundary q={q} empty={(d) => d.activity.length === 0 && <Empty icon="🧾" title="No activity yet" hint="Sign-ins, application steps, venue changes and staff actions appear here." />}>
        {(d) => <Table rows={d.activity.map((a) => ({ ...a, id: String(a.id) }))} onRow={(a: any) => setOpen(a)} columns={[
          { key: 'created_at', header: 'When', render: (a: any) => fmtDateTime(a.created_at) },
          { key: 'actor_name', header: 'Done by', render: (a: any) => <div><b>{a.actor_name ?? 'System'}</b>{a.actor_role && <div className="text-xs text-muted">{titleCase(a.actor_role)}</div>}</div> },
          { key: 'action', header: 'What', render: (a: any) => <Badge status="pending">{titleCase(String(a.action).replace(/[._]/g, ' '))}</Badge> },
          { key: 'ip', header: 'IP address', render: (a: any) => a.ip ?? 'Not recorded' }]} />}
      </QueryBoundary>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Activity details">{open && (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dd className="col-span-2 mb-2 rounded-xl bg-surface2/60 p-3 text-base" role="note">{describeActivity(open)}</dd>
          <dt className="text-muted">What</dt><dd><b>{titleCase(String(open.action).replace(/[._]/g, ' '))}</b></dd>
          <dt className="text-muted">When</dt><dd>{fmtDateTime(open.created_at)}</dd>
          <dt className="text-muted">Done by</dt><dd>{open.actor_name ?? 'System'}{open.actor_role ? ` (${titleCase(open.actor_role)})` : ''}</dd>
          <dt className="text-muted">Resource</dt><dd>{open.entity ? titleCase(String(open.entity).replace(/_/g, ' ')) : 'Not recorded'}</dd>
          {open.target?.reference && <><dt className="text-muted">Booking</dt><dd><b>{open.target.reference}</b>{open.target.title ? ` · ${open.target.title}` : ''}</dd></>}
          {open.target?.customer && <><dt className="text-muted">Customer</dt><dd>{open.target.customer}</dd></>}
          {open.target?.venue && <><dt className="text-muted">Venue</dt><dd>{open.target.venue}</dd></>}
          {open.target?.area && <><dt className="text-muted">Playing area</dt><dd>{open.target.area}</dd></>}
          {open.target?.startsAt && <><dt className="text-muted">Slot</dt><dd>{fmtRange(open.target.startsAt, open.target.endsAt, open.target.timezone)}</dd></>}
          {open.target?.person && <><dt className="text-muted">Person</dt><dd>{open.target.person}{open.target.role ? ` (${titleCase(open.target.role)})` : ''}</dd></>}
          {open.entity_id && <><dt className="text-muted">Resource ID</dt><dd className="break-all font-mono text-xs">{open.entity_id}</dd></>}
          <dt className="text-muted">IP address</dt><dd>{open.ip ?? 'Not recorded'}{open.ip && <span className="block text-xs text-muted">The internet address of the device used. It shows the network (e.g. Jio, Airtel), not an exact location.</span>}</dd>
          {open.metadata && Object.keys(open.metadata).length > 0 && <><dt className="text-muted">Details</dt><dd><ul className="space-y-0.5">{Object.entries(open.metadata as Record<string, unknown>).filter(([k]) => !/password|token|secret|otp/i.test(k)).map(([k, v]) => <li key={k}><span className="text-muted">{titleCase(k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '))}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</li>)}</ul></dd></>}
        </dl>)}</Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Close account */
export function OwnerCloseAccountPage() {
  const { logout } = useAuth(); const nav = useNavigate();
  const info = useQuery({ queryKey: ['owner-close-info'], queryFn: () => get<{ reasons: string[] }>('/owner/account/close-info') });
  const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [password, setPassword] = useState(''); const [confirmWord, setConfirmWord] = useState(''); const [error, setError] = useState('');
  const close = useMutation({ mutationFn: () => post('/owner/account/close', { confirm: 'DELETE', ...(reason.trim() ? { reason: reason.trim() } : {}) }), onSuccess: () => { logout(); nav('/', { replace: true }); }, onError: (e) => setError(apiError(e)) });
  const go = () => { setError(''); if (confirmWord.trim().toUpperCase() !== 'DELETE') return setError('Type DELETE to confirm'); close.mutate(); };
  return (
    <div>
      <PageHeader title="Delete account" subtitle="Permanently close your PlaynX account and delete your personal information." />
      <Card className="max-w-2xl space-y-4 p-5">
        <div className="text-sm"><b>What happens</b>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            <li>Your account closes straight away and you can no longer sign in.</li>
            <li>Your venues are hidden from customers and your staff logins stop working.</li>
            <li>Booking and payment records that the law requires us to keep (for GST and income tax) are kept for the period the law sets, without your personal details.</li>
            <li>You cannot close your account while you have upcoming confirmed bookings.</li></ul></div>
        <Textarea label="Why are you leaving? (optional)" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}  placeholder="Optional. Helps us improve." />
        <Input label="Type DELETE to confirm" autoComplete="off" autoCapitalize="characters" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} />
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button variant="danger" onClick={go} loading={close.isPending} disabled={confirmWord.trim().toUpperCase() !== 'DELETE'}>Delete my account</Button>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- JusGo booking sync */
/** The values the owner types into JusGo → Booking sync, and the API key that lets JusGo read this owner's venues and bookings. */
export function OwnerSyncPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-sync-key'], queryFn: () => get<{ key: { prefix: string; createdAt: string; lastUsedAt: string | null } | null }>('/owner/sync-key') });
  const [fresh, setFresh] = useState<string | null>(null); const [confirmNew, setConfirmNew] = useState(false);
  const make = useMutation({ mutationFn: () => post<{ key: string }>('/owner/sync-key'), onSuccess: (r) => { setFresh(r.key); setConfirmNew(false); qc.invalidateQueries({ queryKey: ['owner-sync-key'] }); }, onError: (e) => toast(apiError(e), 'error') });
  const remove = useMutation({ mutationFn: () => del('/owner/sync-key'), onSuccess: () => { setFresh(null); toast('Key removed. JusGo can no longer read your bookings.'); qc.invalidateQueries({ queryKey: ['owner-sync-key'] }); }, onError: (e) => toast(apiError(e), 'error') });
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast('Copy did not work. Select the text and copy it.', 'error'); } };
  const ROWS: [string, string][] = [['API base URL', `${window.location.origin}/api`], ['Bookings path', '/playnx/bookings'], ['Venues path', '/playnx/venues'], ['Auth header', 'Authorization'], ['Header value', 'Bearer <API key>'], ['Check for changes', 'Every 5 minutes']];
  const key = q.data?.key;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="JusGo sync" subtitle="Let JusGo read your PlaynX bookings, so a slot booked here is closed on JusGo too." />
      <Card className="space-y-3 p-5"><h2 className="text-xl font-bold">1. Fill these in on JusGo</h2>
        <p className="text-sm text-muted">In JusGo, open <b>Booking sync</b> and enter these values.</p>
        <dl className="divide-y divide-line rounded-xl border border-line">{ROWS.map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"><dt className="text-muted">{k}</dt>
            <dd className="flex items-center gap-2"><code className="rounded bg-surface2 px-2 py-0.5">{v}</code>{!v.startsWith('Every') && <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => copy(v)} aria-label={`Copy ${k}`}>Copy</Button>}</dd></div>))}</dl>
      </Card>
      <Card className="space-y-3 p-5"><h2 className="text-xl font-bold">2. API key for JusGo</h2>
        <QueryBoundary q={q}>{() => (<>
          {fresh ? (<div role="status" className="space-y-2 rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm">
            <p><b>Your new key.</b> Copy it now and paste it into JusGo's <b>API key for JusGo</b> box. It is shown only this once.</p>
            <div className="flex flex-wrap items-center gap-2"><code className="break-all rounded bg-surface px-2 py-1 font-mono">{fresh}</code><Button className="!py-1.5" onClick={() => copy(fresh)}>Copy key</Button></div></div>)
            : key ? <p className="text-sm">A key is set up (starts with <code className="rounded bg-surface2 px-1">{key.prefix}…</code>), made {fmtDateTime(key.createdAt)}. {key.lastUsedAt ? <>JusGo last read your bookings {fmtDateTime(key.lastUsedAt)}.</> : 'JusGo has not used it yet.'}</p>
            : <p className="text-sm text-muted">No key yet. Make one and paste it into JusGo.</p>}
          <p className="text-xs text-muted">JusGo can only read your own venues and bookings with it, never change them. Each booking's customer name, mobile and price go to your JusGo calendar so you see them there; emails are never sent. Blocked times are not sent: block them in JusGo too.</p>
          {confirmNew ? (<div className="flex flex-wrap items-center gap-2 rounded-xl bg-warn/10 p-3 text-sm"><span>The old key stops working at once. You must paste the new one into JusGo.</span>
            <Button loading={make.isPending} onClick={() => make.mutate()}>Make a new key</Button><Button variant="ghost" onClick={() => setConfirmNew(false)}>Cancel</Button></div>)
            : <div className="flex flex-wrap gap-2"><Button loading={make.isPending} onClick={() => (key ? setConfirmNew(true) : make.mutate())}>{key ? 'Make a new key' : 'Make API key'}</Button>
              {key && <Button variant="ghost" loading={remove.isPending} onClick={() => window.confirm('Remove the key? JusGo will stop seeing your PlaynX bookings.') && remove.mutate()}>Remove key</Button>}</div>}
        </>)}</QueryBoundary>
      </Card>
    </div>
  );
}
