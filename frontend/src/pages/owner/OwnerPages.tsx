import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, get, patch, post, put } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { BarChart } from '../../components/BarChart';
import { Badge, Button, Card, ConfirmButton, Empty, Input, Modal, PageHeader, QueryBoundary, Select, Stars, Stat, Table, Tabs, Textarea } from '../../components/ui';
import { downloadBlob, fmtDateTime, fmtRange, money, titleCase, todayISO } from '../../lib/utils';

export function OwnerDashboard() {
  const q = useQuery({ queryKey: ['owner-dashboard'], queryFn: () => get<any>('/owner/dashboard'), refetchInterval: 60000 });
  return (
    <div><PageHeader title="Dashboard" subtitle="How your venues are performing" />
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-6">
          {d.verification !== 'verified' && (
            <div role="status" className={`rounded-2xl border p-4 text-sm ${d.verification === 'rejected' ? 'border-danger/40 bg-danger/10' : 'border-warn/40 bg-warn/10'}`}>
              <b>Account {d.verification}.</b> {d.verification === 'pending' ? 'Complete your business details; our team will verify your account before venues can go live.' : 'Please review your details and resubmit.'} <Link className="underline" to="/owner/profile">Update business details</Link></div>)}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat label="Today's bookings" value={d.today.bookings} hint={money(d.today.earnings) + ' earned'} /><Stat label="This month" value={money(d.month.earnings)} hint={`${d.month.bookings} bookings`} accent />
            <Stat label="Upcoming games" value={d.upcomingBookings} /><Stat label="Payable balance" value={money(d.payableBalance)} hint="From completed games, not yet paid out" />
          </div>
          <Card className="p-5"><BarChart title="Earnings, last 14 days" data={d.trend.map((t: any) => ({ ...t, label: t.day.slice(5) }))} valueKey="earnings" labelKey="label" /></Card>
          {d.venuesByStatus.length === 0 && <Empty title="Add your first venue" hint="List a turf to start receiving bookings." action={<Link to="/owner/venues/new" className="btn-primary">Add venue</Link>} />}
        </div>)}</QueryBoundary></div>
  );
}

export function OwnerBookingsPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ status: '', from: '', to: '' });
  const [cancelId, setCancelId] = useState<string | null>(null); const [reason, setReason] = useState('');
  const [scan, setScan] = useState(false); const [code, setCode] = useState(''); const [scanRes, setScanRes] = useState<any>(null); const [scanErr, setScanErr] = useState('');
  const q = useQuery({ queryKey: ['owner-bookings', f], queryFn: () => get<{ bookings: any[] }>('/owner/bookings', { ...f, limit: 100 }) });
  const cancel = useMutation({ mutationFn: () => post(`/owner/bookings/${cancelId}/cancel`, { reason }), onSuccess: (r: any) => { setCancelId(null); setReason(''); qc.invalidateQueries({ queryKey: ['owner-bookings'] }); toast(`Cancelled. Customer refunded ${money(r.refundAmount)}.`); }, onError: (e) => toast(apiError(e), 'error') });
  const verify = async () => { setScanErr(''); setScanRes(null); try { setScanRes(await post('/owner/bookings/verify', { reference: code.trim() })); } catch (e) { setScanErr(apiError(e)); } };
  return (
    <div><PageHeader title="Bookings" subtitle="Customers, payments and check-ins" actions={<Button variant="ghost" onClick={() => setScan(true)}>🔍 Check a booking</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{['confirmed', 'completed', 'pending', 'cancelled', 'expired'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
        <Input label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
      <QueryBoundary q={q} empty={(d) => d.bookings.length === 0 && <Empty icon="📅" title="No bookings found" />}>{(d) => (
        <Table rows={d.bookings} columns={[
          { key: 'reference', header: 'Ref', render: (b) => <b>{b.reference}</b> },
          { key: 'customer', header: 'Customer', render: (b) => <div><div className="font-semibold">{b.customer_name}</div><div className="text-xs text-muted">{b.customer_phone ?? b.customer_email}</div></div> },
          { key: 'where', header: 'Venue / area', render: (b) => <div>{b.venue_name}<div className="text-xs text-muted">{b.area_name} · {b.sport}</div></div> },
          { key: 'when', header: 'When', render: (b) => <span className="text-xs">{fmtRange(b.starts_at, b.ends_at, b.timezone)}</span> },
          { key: 'status', header: 'Status', render: (b) => <Badge status={b.status} /> },
          { key: 'net', header: 'You earn', render: (b) => <span className="font-semibold">{money(b.owner_amount)}</span> },
          { key: 'act', header: '', render: (b) => b.status === 'confirmed' && new Date(b.ends_at) > new Date() ? <Button variant="danger" className="!py-1" onClick={() => setCancelId(b.id)}>Cancel</Button> : null },
        ]} />)}</QueryBoundary>
      <Modal open={!!cancelId} onClose={() => setCancelId(null)} title="Cancel booking"><p className="mb-3 text-sm text-muted">The customer is notified and refunded in full. Use this only when you cannot host the game.</p>
        <Textarea label="Reason (shown to customer)" value={reason} onChange={(e) => setReason(e.target.value)} /><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCancelId(null)}>Back</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel & refund</Button></div></Modal>
      <Modal open={scan} onClose={() => { setScan(false); setScanRes(null); setScanErr(''); }} title="Check a booking">
        <p className="mb-3 text-sm text-muted">Type the booking reference the player shows you (for example <code>PX-AB12CD3</code>).</p>
        <div className="flex gap-2"><input className="field uppercase" aria-label="Booking reference" placeholder="PX-XXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} /><Button onClick={verify} disabled={code.trim().length < 6}>Check</Button></div>
        {scanErr && <p role="alert" className="mt-3 text-sm text-danger">{scanErr}</p>}
        {scanRes && <div className={`mt-4 rounded-xl border p-4 ${scanRes.valid ? 'border-ok/50 bg-ok/10' : 'border-danger/50 bg-danger/10'}`}><p className="text-lg font-bold">{scanRes.valid ? '✓ Valid booking' : '✗ Not valid for entry'}</p>
          <p className="text-sm">{scanRes.booking.customer_name} · {scanRes.booking.area_name}</p><p className="text-xs text-muted">{fmtRange(scanRes.booking.starts_at, scanRes.booking.ends_at)} · {titleCase(scanRes.booking.status)}</p></div>}
      </Modal>
    </div>
  );
}

export function OwnerEarningsPage() {
  const [tab, setTab] = useState<'summary' | 'transactions' | 'payouts'>('summary');
  const e = useQuery({ queryKey: ['owner-earnings'], queryFn: () => get<any>('/owner/earnings') });
  const t = useQuery({ queryKey: ['owner-tx'], queryFn: () => get<{ transactions: any[] }>('/owner/transactions', { limit: 100 }), enabled: tab === 'transactions' });
  const p = useQuery({ queryKey: ['owner-payouts'], queryFn: () => get<{ payouts: any[] }>('/owner/payouts'), enabled: tab === 'payouts' });
  return (
    <div><PageHeader title="Earnings" subtitle="Net of platform commission" />
      <div className="mb-5 max-w-lg"><Tabs tabs={[{ id: 'summary', label: 'Summary' }, { id: 'transactions', label: 'Transactions' }, { id: 'payouts', label: 'Payouts' }]} value={tab} onChange={setTab} /></div>
      {tab === 'summary' && <QueryBoundary q={e}>{(d) => (
        <div className="space-y-5"><div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4"><Stat label="Gross bookings" value={money(d.summary.gross)} /><Stat label="Commission" value={money(d.summary.commission)} /><Stat label="Net earnings" value={money(d.summary.net)} accent /><Stat label="Paid out" value={money(d.payouts.paid)} hint={`${money(d.payouts.pending)} pending`} /></div>
          <div className="grid gap-5 lg:grid-cols-2"><Card className="p-5"><h2 className="mb-3 text-2xl font-bold">By month</h2>{d.monthly.length === 0 ? <p className="text-sm text-muted">No earnings yet.</p> : <BarChart title="Net earnings per month" data={[...d.monthly].reverse()} valueKey="net" labelKey="month" />}</Card>
            <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">By venue</h2><ul className="divide-y divide-line text-sm">{d.byVenue.map((v: any) => <li key={v.id} className="flex justify-between py-2"><span>{v.name} <span className="text-muted">({v.bookings})</span></span><b>{money(v.net)}</b></li>)}{d.byVenue.length === 0 && <li className="py-2 text-muted">No data.</li>}</ul></Card></div></div>)}</QueryBoundary>}
      {tab === 'transactions' && <QueryBoundary q={t} empty={(d) => d.transactions.length === 0 && <Empty icon="💳" title="No transactions yet" />}>{(d) => <Table rows={d.transactions} columns={[
        { key: 'reference', header: 'Booking' }, { key: 'venue_name', header: 'Venue' }, { key: 'paid_at', header: 'Date', render: (r) => r.paid_at ? fmtDateTime(r.paid_at) : '—' },
        { key: 'amount', header: 'Paid', render: (r) => money(r.amount) }, { key: 'owner_amount', header: 'Your share', render: (r) => <b>{money(r.owner_amount)}</b> },
        { key: 'refunded', header: 'Refunded', render: (r) => (r.refunded ? money(r.refunded) : '—') }, { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> }]} />}</QueryBoundary>}
      {tab === 'payouts' && <QueryBoundary q={p} empty={(d) => d.payouts.length === 0 && <Empty icon="🏦" title="No payouts yet" hint="Payouts are issued by the platform for completed games." />}>{(d) => <Table rows={d.payouts} columns={[
        { key: 'period', header: 'Period', render: (r) => `${r.period_start.slice(0, 10)} → ${r.period_end.slice(0, 10)}` }, { key: 'amount', header: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
        { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> }, { key: 'reference', header: 'Reference' }, { key: 'paid_at', header: 'Paid on', render: (r) => (r.paid_at ? fmtDateTime(r.paid_at) : '—') }]} />}</QueryBoundary>}
    </div>
  );
}

export function OwnerOffersPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const venues = useQuery({ queryKey: ['owner-venues'], queryFn: () => get<{ venues: any[] }>('/owner/venues') });
  const q = useQuery({ queryKey: ['owner-coupons'], queryFn: () => get<{ coupons: any[] }>('/owner/coupons') });
  const [open, setOpen] = useState(false); const [err, setErr] = useState('');
  const [f, setF] = useState({ code: '', venueId: '', discountType: 'percent', value: '10', minAmount: '0', validTo: '', usageLimit: '' });
  const create = useMutation({ mutationFn: () => post('/owner/coupons', { code: f.code, venueId: f.venueId, discountType: f.discountType, value: +f.value, minAmount: +f.minAmount || 0, ...(f.usageLimit ? { usageLimit: +f.usageLimit } : {}), validTo: new Date(f.validTo + 'T23:59:59').toISOString() }),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['owner-coupons'] }); toast('Offer created'); }, onError: (e) => setErr(apiError(e)) });
  const toggle = useMutation({ mutationFn: (c: any) => patch(`/owner/coupons/${c.id}`, { isActive: !c.is_active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-coupons'] }), onError: (e) => toast(apiError(e), 'error') });
  const approved = venues.data?.venues.filter((v) => ['approved', 'pending', 'draft'].includes(v.status)) ?? [];
  return (
    <div><PageHeader title="Offers" subtitle="Discount codes customers can apply at your venues" actions={<Button onClick={() => { setErr(''); setF({ ...f, venueId: approved[0]?.id ?? '' }); setOpen(true); }} disabled={approved.length === 0}>+ New offer</Button>} />
      <QueryBoundary q={q} empty={(d) => d.coupons.length === 0 && <Empty icon="🏷️" title="No offers yet" hint="Create a code like WEEKDAY20 to fill quiet slots." />}>{(d) => <Table rows={d.coupons} columns={[
        { key: 'code', header: 'Code', render: (c) => <b className="tracking-wider">{c.code}</b> }, { key: 'venue_name', header: 'Venue' },
        { key: 'off', header: 'Discount', render: (c) => (c.discount_type === 'percent' ? `${c.value}%${c.max_discount ? ` (max ${money(c.max_discount)})` : ''}` : money(c.value)) },
        { key: 'used', header: 'Used', render: (c) => `${c.used_count}${c.usage_limit ? ` / ${c.usage_limit}` : ''}` }, { key: 'valid_to', header: 'Expires', render: (c) => c.valid_to.slice(0, 10) },
        { key: 'st', header: '', render: (c) => <Button variant="ghost" className="!py-1" onClick={() => toggle.mutate(c)}>{c.is_active ? 'Disable' : 'Enable'}</Button> }]} />}</QueryBoundary>
      <Modal open={open} onClose={() => setOpen(false)} title="New offer">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setErr(''); create.mutate(); }}>
          <Input label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required pattern="[A-Za-z0-9_-]{3,20}" hint="3–20 letters, digits, - or _" />
          <Select label="Venue" value={f.venueId} onChange={(e) => setF({ ...f, venueId: e.target.value })}>{approved.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
          <div className="grid grid-cols-2 gap-3"><Select label="Type" value={f.discountType} onChange={(e) => setF({ ...f, discountType: e.target.value })}><option value="percent">Percent off</option><option value="flat">Flat ₹ off</option></Select><Input label="Value" type="number" min={1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3"><Input label="Min order ₹" type="number" value={f.minAmount} onChange={(e) => setF({ ...f, minAmount: e.target.value })} /><Input label="Total uses" type="number" value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} /></div>
          <Input label="Valid until" type="date" min={todayISO()} value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} required />
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create</Button></div></form></Modal>
    </div>
  );
}

export function OwnerReviewsPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-reviews'], queryFn: () => get<{ reviews: any[] }>('/owner/reviews') });
  const [replying, setReplying] = useState<any>(null); const [text, setText] = useState('');
  const reply = useMutation({ mutationFn: () => post(`/owner/reviews/${replying.id}/reply`, { reply: text }), onSuccess: () => { setReplying(null); setText(''); qc.invalidateQueries({ queryKey: ['owner-reviews'] }); toast('Reply posted'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Reviews" subtitle="What players say about your venues" />
      <QueryBoundary q={q} empty={(d) => d.reviews.length === 0 && <Empty icon="⭐" title="No reviews yet" />}>{(d) => <div className="space-y-3">{d.reviews.map((r) => (
        <Card key={r.id} className="p-4"><div className="flex items-center justify-between"><div><b>{r.author}</b> <span className="text-sm text-muted">on {r.venue_name}</span></div><Stars value={r.rating} size={14} /></div>
          {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}<p className="mt-1 text-xs text-muted">{fmtDateTime(r.created_at)}</p>
          {r.owner_reply ? <p className="mt-2 rounded-lg bg-surface2 p-3 text-sm"><b>Your reply:</b> {r.owner_reply}</p> : <Button variant="ghost" className="mt-2 !py-1" onClick={() => setReplying(r)}>Reply</Button>}</Card>))}</div>}</QueryBoundary>
      <Modal open={!!replying} onClose={() => setReplying(null)} title="Reply to review"><Textarea label="Your reply (public)" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} /><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setReplying(null)}>Cancel</Button><Button disabled={!text.trim()} loading={reply.isPending} onClick={() => reply.mutate()}>Post reply</Button></div></Modal>
    </div>
  );
}

export function OwnerReportsPage() {
  const { toast } = useToast();
  const [f, setF] = useState({ from: todayISO(-30), to: todayISO() }); const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try { const r = await api.get('/owner/reports/bookings.csv', { params: f, responseType: 'blob' }); downloadBlob(r.data, `bookings-${f.from}-${f.to}.csv`); toast('Report downloaded'); }
    catch (e) { toast(apiError(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-xl"><PageHeader title="Reports" subtitle="Download your booking and earnings data as CSV" />
      <Card className="space-y-4 p-5"><div className="grid grid-cols-2 gap-3"><Input label="From" type="date" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To" type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <Button onClick={download} loading={busy}>⬇ Download bookings CSV</Button><p className="text-xs text-muted">Includes reference, customer, venue, area, sport, times, status, total, commission and your net amount.</p></Card></div>
  );
}

export function OwnerProfilePage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['profile'], queryFn: () => get<{ profile: any }>('/me/profile') });
  return <QueryBoundary q={q}>{(d) => <ProfileForm profile={d.profile} onSaved={() => { qc.invalidateQueries({ queryKey: ['profile'] }); qc.invalidateQueries({ queryKey: ['owner-dashboard'] }); toast('Saved'); }} />}</QueryBoundary>;
}
function ProfileForm({ profile, onSaved }: { profile: any; onSaved(): void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ businessName: profile.business_name ?? '', gstin: profile.gstin ?? '', pan: profile.pan ?? '', address: profile.address ?? '', bankAccountName: profile.bank_account_name ?? '', bankAccountNumber: profile.bank_account_number ?? '', bankIfsc: profile.bank_ifsc ?? '', upiId: profile.upi_id ?? '' });
  const save = useMutation({ mutationFn: () => put('/owner/profile', Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))), onSuccess: onSaved, onError: (e) => toast(apiError(e), 'error') });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="max-w-2xl space-y-5"><PageHeader title="Business & bank details" actions={<Badge status={profile.verification_status} />} />
      {profile.verification_note && <p className="rounded-xl border border-line p-3 text-sm"><b>Note from PlaynX:</b> {profile.verification_note}</p>}
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Card className="space-y-4 p-5"><h2 className="text-2xl font-bold">Business</h2><Input label="Business name" value={f.businessName} onChange={set('businessName')} required /><div className="grid grid-cols-2 gap-3"><Input label="GSTIN" value={f.gstin} onChange={set('gstin')} /><Input label="PAN" value={f.pan} onChange={set('pan')} /></div><Input label="Registered address" value={f.address} onChange={set('address')} /></Card>
        <Card className="space-y-4 p-5"><h2 className="text-2xl font-bold">Payout account</h2><Input label="Account holder" value={f.bankAccountName} onChange={set('bankAccountName')} /><div className="grid grid-cols-2 gap-3"><Input label="Account number" inputMode="numeric" value={f.bankAccountNumber} onChange={set('bankAccountNumber')} pattern="\d{6,20}" /><Input label="IFSC" value={f.bankIfsc} onChange={(e) => setF({ ...f, bankIfsc: e.target.value.toUpperCase() })} pattern="[A-Z]{4}0[A-Z0-9]{6}" /></div><Input label="UPI ID (optional)" value={f.upiId} onChange={set('upiId')} /></Card>
        <Button type="submit" loading={save.isPending}>Save details</Button></form></div>
  );
}
export { ConfirmButton };
