import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, del, get, patch, post, put } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, QueryBoundary, Select, Stat, Table, Textarea } from '../../components/ui';
import { TicketThread } from '../customer/Account';
import { cx, downloadBlob, fmtDateTime, money, titleCase, todayISO, payMethodLabel } from '../../lib/utils';
import { useAuth } from '../../lib/auth';

export function AdminPayments() {
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['admin-payments', status], queryFn: () => get<any>('/admin/payments', { status: status || undefined, limit: 100 }) });
  return (
    <div><PageHeader title="Payments" subtitle="Razorpay transactions" actions={<div className="w-44"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['captured', 'created', 'failed', 'refunded', 'partially_refunded'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></div>} />
      <QueryBoundary q={q} empty={(d) => d.payments.length === 0 && <Empty icon="💳" title="No payments" />}>{(d) => (<div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3"><Stat label="Total captured" value={money(d.summary.captured)} accent /><Stat label="Failed payments" value={d.summary.failed} /><Stat label="Shown" value={d.payments.length} /></div>
        <Table rows={d.payments} columns={[{ key: 'reference', header: 'Booking', render: (p: any) => <b>{p.reference}</b> }, { key: 'customer_name', header: 'Customer' }, { key: 'venue_name', header: 'Venue' }, { key: 'amount', header: 'Amount', render: (p: any) => money(p.amount) },
          { key: 'method', header: 'Method', render: (p: any) => payMethodLabel(p.method) }, { key: 'razorpay_payment_id', header: 'Razorpay ID', render: (p: any) => <code className="text-xs">{p.razorpay_payment_id ?? p.razorpay_order_id}</code> }, { key: 'status', header: 'Status', render: (p: any) => <Badge status={p.status} /> }, { key: 'created_at', header: 'Date', render: (p: any) => fmtDateTime(p.created_at) }]} /></div>)}</QueryBoundary></div>
  );
}

export function AdminRefunds() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [status, setStatus] = useState(''); const [open, setOpen] = useState(false); const [f, setF] = useState({ bookingId: '', amount: '', reason: '' });
  const q = useQuery({ queryKey: ['admin-refunds', status], queryFn: () => get<{ refunds: any[] }>('/admin/refunds', { status: status || undefined }) });
  const retry = useMutation({ mutationFn: (id: string) => post(`/admin/refunds/${id}/retry`), onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['admin-refunds'] }); toast(r.refund.status === 'processed' ? 'Refund processed' : 'Gateway still failing', r.refund.status === 'processed' ? 'success' : 'error'); }, onError: (e) => toast(apiError(e), 'error') });
  const manual = useMutation({ mutationFn: () => post('/admin/refunds', { bookingId: f.bookingId.trim(), reason: f.reason, ...(f.amount ? { amount: +f.amount } : {}) }), onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['admin-refunds'] }); toast('Refund issued'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Refunds" subtitle="Track, retry and issue refunds" actions={<><div className="w-40"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="processed">Processed</option><option value="failed">Failed</option></Select></div><Button className="self-end" onClick={() => setOpen(true)}>Manual refund</Button></>} />
      <QueryBoundary q={q} empty={(d) => d.refunds.length === 0 && <Empty icon="↩️" title="No refunds" />}>{(d) => <Table rows={d.refunds} columns={[{ key: 'reference', header: 'Booking', render: (r) => <b>{r.reference}</b> }, { key: 'customer_name', header: 'Customer' }, { key: 'amount', header: 'Amount', render: (r) => money(r.amount) }, { key: 'reason', header: 'Reason' },
        { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> }, { key: 'created_at', header: 'Requested', render: (r) => fmtDateTime(r.created_at) }, { key: 'a', header: '', render: (r) => r.status !== 'processed' ? <Button className="!py-1" loading={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}>Retry</Button> : null }]} />}</QueryBoundary>
      <Modal open={open} onClose={() => setOpen(false)} title="Issue manual refund"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); manual.mutate(); }}><Input label="Booking ID (UUID)" value={f.bookingId} onChange={(e) => setF({ ...f, bookingId: e.target.value })} required /><Input label="Amount ₹ (blank = full remaining)" type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><Textarea label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={3} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={manual.isPending}>Issue refund</Button></div></form></Modal></div>
  );
}

const d_hold = (d: any) => d?.holdHours ?? 48;
export function AdminPayouts() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-payouts'], queryFn: () => get<any>('/admin/payouts') });
  const [sel, setSel] = useState<any>(null); const [amount, setAmount] = useState(''); const [range, setRange] = useState({ s: todayISO(-30), e: todayISO() });
  const create = useMutation({ mutationFn: () => post('/admin/payouts', { ownerId: sel.owner_id, amount: +amount, periodStart: range.s, periodEnd: range.e }), onSuccess: () => { setSel(null); qc.invalidateQueries({ queryKey: ['admin-payouts'] }); toast('Payout created'); }, onError: (e) => toast(apiError(e), 'error') });
  const sendBank = useMutation({ mutationFn: (id: string) => post(`/admin/payouts/${id}/send`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-payouts'] }); toast('Sent to the bank. It shows as Paid when the bank confirms.'); }, onError: (e) => toast(apiError(e), 'error') });
  const mark = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => { const ref = status === 'paid' ? window.prompt('Bank / UTR reference for this payout') : null; if (status === 'paid' && !ref) throw new Error('A reference is required'); return patch(`/admin/payouts/${id}`, { status, reference: ref || undefined }); }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-payouts'] }); toast('Payout updated'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Owner payouts" subtitle={`Customers pay PlaynX first. An owner's share can be paid out ${d_hold(q.data)} hours after the game, unless the customer has an open complaint.`} />
      <QueryBoundary q={q}>{(d) => (<div className="space-y-6">
        <p className="rounded-xl border border-line bg-surface2 p-3 text-sm" role="status">{d.bank?.enabled ? `Bank payouts are on. Use “Send via bank” on a pending payout.${d.bank.auto ? ` Automatic payouts are on for balances of ${money(d.bank.autoMin)} or more.` : ' Automatic payouts are off (turn them on in Commission & settings).'}` : 'Bank payouts are not set up, so payouts are marked paid by hand after you transfer the money. To enable them, set RAZORPAYX_ACCOUNT_NUMBER on the server.'}</p>
        <section><h2 className="mb-2 text-2xl font-bold">Owner balances</h2>{d.balances.length === 0 ? <p className="text-sm text-muted">Nothing held or payable right now.</p> : <Table rows={d.balances.map((b: any) => ({ ...b, id: b.owner_id }))} columns={[{ key: 'business_name', header: 'Owner', render: (b: any) => <div><b>{b.business_name}</b><div className="text-xs text-muted">{b.full_name}</div></div> }, { key: 'payable', header: 'Ready to pay', render: (b: any) => <b>{money(b.payable)}</b> }, { key: 'holding', header: `In ${d.holdHours}h hold`, render: (b: any) => money(b.holding) }, { key: 'disputed', header: 'Complaint hold', render: (b: any) => b.disputed > 0 ? <span className="font-semibold text-warn">{money(b.disputed)}</span> : money(0) }, { key: 'a', header: '', render: (b: any) => b.payable > 0 ? <Button className="!py-1" onClick={() => { setSel(b); setAmount(String(b.payable)); }}>Create payout</Button> : <span className="text-xs text-muted">Nothing to pay yet</span> }]} />}</section>
        <section><h2 className="mb-2 text-2xl font-bold">Payout history</h2>{d.payouts.length === 0 ? <p className="text-sm text-muted">No payouts yet.</p> : <Table rows={d.payouts} columns={[{ key: 'business_name', header: 'Owner' }, { key: 'period', header: 'Period', render: (p: any) => `${p.period_start.slice(0, 10)} → ${p.period_end.slice(0, 10)}` }, { key: 'amount', header: 'Amount', render: (p: any) => money(p.amount) }, { key: 'status', header: 'Status', render: (p: any) => <Badge status={p.status} /> }, { key: 'reference', header: 'Reference' },
          { key: 'a', header: '', render: (p: any) => p.status === 'pending' ? <span className="flex gap-1">{q.data?.bank?.enabled && <Button className="!py-1" loading={sendBank.isPending && sendBank.variables === p.id} onClick={() => sendBank.mutate(p.id)}>Send via bank</Button>}<Button variant={q.data?.bank?.enabled ? 'ghost' : 'primary'} className="!py-1" onClick={() => mark.mutate({ id: p.id, status: 'paid' })}>Mark paid</Button><Button variant="danger" className="!py-1" onClick={() => mark.mutate({ id: p.id, status: 'failed' })}>Failed</Button></span> : null }]} />}</section></div>)}</QueryBoundary>
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Payout · ${sel?.business_name ?? ''}`}><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}><Input label="Amount ₹" type="number" step="0.01" min={1} max={sel?.payable} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3"><Input label="Period start" type="date" value={range.s} onChange={(e) => setRange({ ...range, s: e.target.value })} /><Input label="Period end" type="date" value={range.e} onChange={(e) => setRange({ ...range, e: e.target.value })} /></div><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setSel(null)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create</Button></div></form></Modal></div>
  );
}

/** How each coupon is doing: bookings it brought, discount it gave away, the booking value, and how many different customers used it. */
function CouponPerformance() {
  const q = useQuery({ queryKey: ['admin-coupon-performance'], queryFn: () => get<{ coupons: any[] }>('/admin/coupons/performance') });
  const used = (q.data?.coupons ?? []).filter((c) => c.bookings > 0 || c.used_count > 0);
  if (!q.data || q.data.coupons.length === 0) return null;
  const top = Math.max(1, ...used.map((c) => c.revenue));
  return (
    <section aria-label="Coupon performance" className="mb-6"><h2 className="mb-2 text-2xl font-bold">Coupon performance</h2>
      {used.length === 0 ? <p className="text-sm text-muted">No coupon has been used yet. Results appear here after the first booking with a code.</p> : (
        <Table rows={used.map((c) => ({ ...c, id: c.id }))} columns={[
          { key: 'code', header: 'Code', render: (c) => <div><b className="tracking-wider">{c.code}</b><div className="text-xs text-muted">{c.venue_name ?? 'All venues'}</div></div> },
          { key: 'bookings', header: 'Bookings', render: (c) => c.bookings }, { key: 'customers', header: 'Customers', render: (c) => c.customers },
          { key: 'discount_given', header: 'Discount given', render: (c) => money(c.discount_given) },
          { key: 'revenue', header: 'Booking value', render: (c) => <div className="min-w-[8rem]">{money(c.revenue)}<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-brand" style={{ width: `${(c.revenue / top) * 100}%` }} /></div></div> },
          { key: 'cost', header: 'Cost per ₹100 sold', render: (c) => (c.revenue + c.discount_given > 0 ? money((c.discount_given / (c.revenue + c.discount_given)) * 100) : '—') }]} />)}</section>);
}

export function AdminCoupons() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-coupons'], queryFn: () => get<{ coupons: any[] }>('/admin/coupons') });
  const [open, setOpen] = useState(false); const [err, setErr] = useState('');
  const [f, setF] = useState({ code: '', description: '', discountType: 'percent', value: '10', minAmount: '0', validTo: '', usageLimit: '', perUserLimit: '1' });
  const create = useMutation({ mutationFn: () => post('/admin/coupons', { code: f.code, description: f.description || undefined, discountType: f.discountType, value: +f.value, minAmount: +f.minAmount || 0, perUserLimit: +f.perUserLimit || 1, ...(f.usageLimit ? { usageLimit: +f.usageLimit } : {}), validTo: new Date(f.validTo + 'T23:59:59').toISOString() }),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['admin-coupons'] }); toast('Coupon created'); }, onError: (e) => setErr(apiError(e)) });
  const toggle = useMutation({ mutationFn: (c: any) => patch(`/admin/coupons/${c.id}`, { isActive: !c.is_active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-coupons'] }), onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Coupons" subtitle="Platform-wide promotions" actions={<Button onClick={() => { setErr(''); setOpen(true); }}>+ New coupon</Button>} />
      <CouponPerformance />
      <QueryBoundary q={q} empty={(d) => d.coupons.length === 0 && <Empty icon="🏷️" title="No coupons" />}>{(d) => <Table rows={d.coupons} columns={[{ key: 'code', header: 'Code', render: (c) => <b className="tracking-wider">{c.code}</b> }, { key: 'scope', header: 'Scope', render: (c) => c.venue_name ?? 'All venues' },
        { key: 'off', header: 'Discount', render: (c) => (c.discount_type === 'percent' ? `${c.value}%${c.max_discount ? ` (max ${money(c.max_discount)})` : ''}` : money(c.value)) }, { key: 'used', header: 'Used', render: (c) => `${c.used_count}${c.usage_limit ? `/${c.usage_limit}` : ''}` }, { key: 'valid_to', header: 'Expires', render: (c) => c.valid_to.slice(0, 10) },
        { key: 'a', header: '', render: (c) => <Button variant="ghost" className="!py-1" onClick={() => toggle.mutate(c)}>{c.is_active ? 'Disable' : 'Enable'}</Button> }]} />}</QueryBoundary>
      <Modal open={open} onClose={() => setOpen(false)} title="New coupon"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setErr(''); create.mutate(); }}>
        <Input label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required pattern="[A-Za-z0-9_-]{3,20}" /><Input label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3"><Select label="Type" value={f.discountType} onChange={(e) => setF({ ...f, discountType: e.target.value })}><option value="percent">Percent off</option><option value="flat">Flat ₹ off</option></Select><Input label="Value" type="number" min={1} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required /></div>
        <div className="grid grid-cols-2 gap-3"><Input label="Min order ₹" type="number" value={f.minAmount} onChange={(e) => setF({ ...f, minAmount: e.target.value })} /><Input label="Total uses" type="number" value={f.usageLimit} onChange={(e) => setF({ ...f, usageLimit: e.target.value })} /><Input label="Per user" type="number" min={1} value={f.perUserLimit} onChange={(e) => setF({ ...f, perUserLimit: e.target.value })} /></div>
        <Input label="Valid until" type="date" min={todayISO()} value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} required />{err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create</Button></div></form></Modal></div>
  );
}

/** A city to aim something at. Leave it empty for everyone; the cities that already have turfs are suggested. */
function CityField({ value, onChange, hint }: { value: string; onChange(v: string): void; hint: string }) {
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => get<{ cities: { city: string; venues: number }[] }>('/cities'), staleTime: 300000 });
  const id = useId();
  return (<><Input label="City (optional)" list={id} placeholder="All cities" value={value} maxLength={80} hint={hint} onChange={(e) => onChange(e.target.value)} />
    <datalist id={id}>{(cities.data?.cities ?? []).map((c) => <option key={c.city} value={c.city} />)}</datalist></>);
}

export function AdminNotify() {
  const { toast } = useToast();
  const [f, setF] = useState({ audience: 'all', title: '', body: '', city: '' });
  const send = useMutation({ mutationFn: () => post('/admin/notifications/broadcast', { ...f, city: f.city.trim() || undefined }), onSuccess: (r: any) => { setF({ ...f, title: '', body: '' }); toast(`Sent to ${r.recipients} user(s)`); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div className="max-w-xl"><PageHeader title="Broadcast notification" subtitle="In-app, push and real-time delivery" />
      <Card className="p-5"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (window.confirm(`Send to ${f.audience}${f.city.trim() ? ` in ${f.city.trim()}` : ''}?`)) send.mutate(); }}>
        <Select label="Audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="all">Everyone</option><option value="customers">All customers</option><option value="owners">All turf owners</option></Select>
        <CityField value={f.city} onChange={(v) => setF({ ...f, city: v })} hint="Customers living there and owners with a venue there" />
        <Input label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={100} /><Textarea label="Message" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required maxLength={500} /><Button type="submit" loading={send.isPending}>Send notification</Button></form></Card></div>
  );
}

export function AdminTickets() {
  const [status, setStatus] = useState(''); const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-tickets', status], queryFn: () => get<{ tickets: any[] }>('/admin/tickets', { status: status || undefined }) });
  return (
    <div><PageHeader title="Complaints & support" actions={<div className="w-44"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></div>} />
      <QueryBoundary q={q} empty={(d) => d.tickets.length === 0 && <Empty icon="🎧" title="Inbox zero" hint="No tickets with this status." />}>{(d) => <Table rows={d.tickets} onRow={(t) => setSel(t.id)} columns={[{ key: 'subject', header: 'Subject', render: (t) => <b>{t.subject}</b> }, { key: 'user_name', header: 'From', render: (t) => `${t.user_name} (${t.user_role})` }, { key: 'booking_reference', header: 'Booking', render: (t) => t.booking_reference ?? '—' }, { key: 'updated_at', header: 'Updated', render: (t) => fmtDateTime(t.updated_at) }, { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> }]} />}</QueryBoundary>
      {sel && <TicketThread id={sel} onClose={() => setSel(null)} base="/admin/tickets" admin />}</div>
  );
}

/** What each venue brought in and what PlaynX kept from it, for the period chosen above. */
function CommissionByVenue({ from, to }: { from: string; to: string }) {
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['admin-commission-venue', from, to], queryFn: () => get<{ rows: any[] }>('/admin/reports/commission-by-venue', { from, to }) });
  const dl = async () => { try { const r = await api.get('/admin/reports/commission-by-venue', { params: { from, to, format: 'csv' }, responseType: 'blob' }); downloadBlob(r.data, `commission-by-venue-${from}-${to}.csv`); } catch (e) { toast(apiError(e), 'error'); } };
  return (
    <section aria-label="Commission by venue" className="mt-8"><div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-2xl font-bold">Commission by venue</h2><Button variant="ghost" onClick={dl}>⬇ CSV</Button></div>
      <QueryBoundary q={q} empty={(d) => d.rows.length === 0 && <Empty icon="🏟️" title="No online bookings in this period" />}>{(d) => (
        <Table rows={d.rows} columns={[{ key: 'venue', header: 'Venue', render: (r: any) => <div><b>{r.venue}</b><div className="text-xs text-muted">{r.owner}</div></div> }, { key: 'bookings', header: 'Bookings' },
          { key: 'gross', header: 'Booking value', render: (r: any) => money(r.gross) }, { key: 'commission', header: 'PlaynX commission', render: (r: any) => <b>{money(r.commission)}</b> },
          { key: 'effective_rate', header: 'Rate', render: (r: any) => `${r.effective_rate}%` }, { key: 'owner_earnings', header: 'Owner earnings', render: (r: any) => money(r.owner_earnings) }]} />)}</QueryBoundary></section>);
}

export function AdminReports() {
  const { toast } = useToast();
  const [f, setF] = useState({ from: todayISO(-30), to: todayISO(), groupBy: 'day' });
  const q = useQuery({ queryKey: ['admin-report', f], queryFn: () => get<{ rows: any[] }>('/admin/reports/revenue', f) });
  const dl = async () => { try { const r = await api.get('/admin/reports/revenue', { params: { ...f, format: 'csv' }, responseType: 'blob' }); downloadBlob(r.data, `revenue-${f.from}-${f.to}.csv`); } catch (e) { toast(apiError(e), 'error'); } };
  return (
    <div><PageHeader title="Reports & analytics" subtitle="Revenue, commission and owner earnings" actions={<Button variant="ghost" onClick={dl}>⬇ CSV</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Input label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /><Select label="Group by" value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })}><option value="day">Day</option><option value="month">Month</option></Select></div>
      <QueryBoundary q={q} empty={(d) => d.rows.length === 0 && <Empty icon="📈" title="No data for this period" />}>{(d) => <Table rows={d.rows.map((r) => ({ ...r, id: r.period }))} columns={[{ key: 'period', header: 'Period' }, { key: 'bookings', header: 'Bookings' }, { key: 'gmv', header: 'Gross', render: (r: any) => money(r.gmv) }, { key: 'commission', header: 'Commission', render: (r: any) => <b>{money(r.commission)}</b> }, { key: 'owner_earnings', header: 'Owner earnings', render: (r: any) => money(r.owner_earnings) }]} />}</QueryBoundary>
      <CommissionByVenue from={f.from} to={f.to} /></div>
  );
}

export function AdminSettings() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => get<any>('/admin/settings') });
  return <QueryBoundary q={q}>{(d) => <SettingsForm d={d} onSaved={() => { qc.invalidateQueries({ queryKey: ['admin-settings'] }); toast('Settings saved'); }} />}</QueryBoundary>;
}
function SettingsForm({ d, onSaved }: { d: any; onSaved(): void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ commissionPercent: String(d.commissionPercent), slotLockMinutes: String(d.slotLockMinutes), maxAdvanceBookingDays: String(d.maxAdvanceBookingDays), autoPayouts: !!d.autoPayouts, autoPayoutMin: String(d.autoPayoutMin ?? 500), gstRate: String(d.gstRate ?? 18), gstSac: String(d.gstSac ?? '999692'), payoutHoldHours: String(d.payoutHoldHours ?? 48) });
  const save = useMutation({ mutationFn: () => put('/admin/settings', { commissionPercent: +f.commissionPercent, slotLockMinutes: +f.slotLockMinutes, autoPayouts: f.autoPayouts, autoPayoutMin: +f.autoPayoutMin, gstRate: +f.gstRate, gstSac: f.gstSac, maxAdvanceBookingDays: +f.maxAdvanceBookingDays, payoutHoldHours: +f.payoutHoldHours }), onSuccess: onSaved, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div className="max-w-xl"><PageHeader title="Commission & settings" subtitle="Applies to new bookings only" />
      <Card className="p-5"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Input label="Platform commission %" type="number" step="0.5" min={0} max={50} value={f.commissionPercent} onChange={(e) => setF({ ...f, commissionPercent: e.target.value })} hint="Deducted from each booking's total. Per-owner overrides live under Turf owners." />
        <Input label="Slot hold time (minutes)" type="number" min={2} max={30} value={f.slotLockMinutes} onChange={(e) => setF({ ...f, slotLockMinutes: e.target.value })} hint="How long a slot is reserved while the customer pays" />
        <Input label="Owner payout hold (hours)" type="number" min={0} max={720} value={f.payoutHoldHours} onChange={(e) => setF({ ...f, payoutHoldHours: e.target.value })} hint="Customers pay PlaynX first. The owner's share is paid out only this many hours after the game, and never while the customer has an open complaint on that booking." />
        <label className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm"><span><b>Pay owners automatically</b><span className="block text-xs text-muted">Each hour, owners whose released balance reaches the minimum below are paid through the bank. Needs bank payouts to be set up on the server.</span></span><input type="checkbox" aria-label="Pay owners automatically" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={f.autoPayouts} onChange={(e) => setF({ ...f, autoPayouts: e.target.checked })} /></label>
        <Input label="Minimum automatic payout (₹)" type="number" min={100} value={f.autoPayoutMin} onChange={(e) => setF({ ...f, autoPayoutMin: e.target.value })} />
        <Input label="GST rate on bookings (%)" type="number" step="0.5" min={0} max={40} value={f.gstRate} onChange={(e) => setF({ ...f, gstRate: e.target.value })} hint="Shown on invoices for owners who have a GSTIN. Prices are GST-inclusive. Confirm the rate with your accountant." />
        <Input label="SAC code" value={f.gstSac} onChange={(e) => setF({ ...f, gstSac: e.target.value })} hint="Service accounting code printed on tax invoices (4–8 digits)." />
        <Input label="Max advance booking (days)" type="number" min={1} max={365} value={f.maxAdvanceBookingDays} onChange={(e) => setF({ ...f, maxAdvanceBookingDays: e.target.value })} /><Button type="submit" loading={save.isPending}>Save settings</Button></form></Card></div>
  );
}

export function AdminTeam() {
  const { toast } = useToast(); const qc = useQueryClient(); const { user } = useAuth();
  const q = useQuery({ queryKey: ['admin-team'], queryFn: () => get<{ admins: any[]; permissions: { id: string; label: string }[] }>('/admin/team') });
  const [pm, setPm] = useState<{ a: any; custom: boolean; list: string[] } | null>(null);
  const savePerms = useMutation({ mutationFn: () => patch(`/admin/team/${pm!.a.id}`, { permissions: pm!.custom ? pm!.list : null }), onSuccess: () => { setPm(null); qc.invalidateQueries({ queryKey: ['admin-team'] }); toast('Permissions saved. They are signed out and see the change on their next sign-in.'); }, onError: (e) => toast(apiError(e), 'error') });
  const [open, setOpen] = useState(false); const [f, setF] = useState({ fullName: '', email: '', password: '', adminRole: 'support' }); const [err, setErr] = useState('');
  const create = useMutation({ mutationFn: () => post('/admin/team', f), onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['admin-team'] }); toast('Admin created'); }, onError: (e) => setErr(apiError(e)) });
  const role = useMutation({ mutationFn: ({ id, adminRole }: { id: string; adminRole: string }) => patch(`/admin/team/${id}`, { adminRole }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-team'] }); toast('Role updated'); }, onError: (e) => toast(apiError(e), 'error') });
  const resetMfa = useMutation({ mutationFn: (id: string) => post(`/admin/team/${id}/reset-mfa`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-team'] }); toast('Two-step sign-in reset. They will scan a new QR code at their next sign-in.'); }, onError: (e) => toast(apiError(e), 'error') });
  const ROLES = [['super_admin', 'Super admin — everything'], ['operations', 'Operations — venues, users, bookings, coupons'], ['finance', 'Finance — payments, refunds, payouts, settings'], ['support', 'Support — tickets, read-only users & bookings']];
  return (
    <div><PageHeader title="Admin team" subtitle="Role-based permissions" actions={<Button onClick={() => { setErr(''); setOpen(true); }}>+ Add admin</Button>} />
      <QueryBoundary q={q}>{(d) => <Table rows={d.admins} columns={[{ key: 'full_name', header: 'Name', render: (a) => <div><b>{a.full_name}</b><div className="text-xs text-muted">{a.email}</div></div> },
        { key: 'admin_role', header: 'Role', render: (a) => a.id === user?.id ? <Badge status="approved">{titleCase(a.admin_role)} (you)</Badge> : <select aria-label={`Role for ${a.full_name}`} className="field !w-56 !py-1.5" value={a.admin_role} onChange={(e) => window.confirm(`Change ${a.full_name} to ${e.target.value}?`) && role.mutate({ id: a.id, adminRole: e.target.value })}>{ROLES.map(([v]) => <option key={v} value={v}>{titleCase(v)}</option>)}</select> },
        { key: 'perm', header: 'Permissions', render: (a) => (a.admin_role === 'super_admin' ? <span className="text-muted">Everything</span> : <span className="flex items-center gap-2"><span className="text-muted">{a.admin_permissions ? `${a.admin_permissions.length} chosen` : 'Role default'}</span>{a.id !== user?.id && <Button variant="ghost" className="!py-1" onClick={() => setPm({ a, custom: !!a.admin_permissions, list: a.admin_permissions ?? [] })}>Permissions</Button>}</span>) },
        { key: 'mfa', header: 'Two-step sign-in', render: (a) => <span className="flex flex-wrap items-center gap-2">{a.mfa_enabled ? <Badge status="approved">On</Badge> : <Badge status="pending">Not set up yet</Badge>}
          {a.mfa_enabled && a.id !== user?.id && <button type="button" className="text-xs font-semibold text-danger underline" onClick={() => { if (window.confirm(`Reset two-step sign-in for ${a.full_name}? They are signed out and set up a new authenticator at their next sign-in.`)) resetMfa.mutate(a.id); }}>Reset</button>}</span> },
        { key: 'created_at', header: 'Added', render: (a) => a.created_at.slice(0, 10) }]} />}</QueryBoundary>
      <Modal open={!!pm} onClose={() => setPm(null)} title={`Permissions for ${pm?.a.full_name ?? ''}`}>{pm && q.data && <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!pm.custom} onChange={(e) => setPm({ ...pm, custom: !e.target.checked })} /> Use the {titleCase(pm.a.admin_role)} role's permissions</label>
        {pm.custom && <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-semibold">Choose exactly what this admin can see and do</legend>{q.data.permissions.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pm.list.includes(p.id)} onChange={() => setPm({ ...pm, list: pm.list.includes(p.id) ? pm.list.filter((x) => x !== p.id) : [...pm.list, p.id] })} />{p.label}</label>)}{pm.list.length === 0 && <p className="text-xs text-muted">Nothing ticked: this admin can sign in but not open any page.</p>}</fieldset>}
        <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" onClick={() => setPm(null)}>Cancel</Button><Button loading={savePerms.isPending} onClick={() => savePerms.mutate()}>Save permissions</Button></div></div>}</Modal>
      <Card className="mt-5 p-5 text-sm"><h2 className="mb-2 text-xl font-bold">Role permissions</h2><ul className="space-y-1 text-muted">{ROLES.map(([v, d]) => <li key={v}>• {d}</li>)}</ul></Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add admin"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setErr(''); create.mutate(); }}><Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required /><Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /><Input label="Temporary password" type="password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required hint="At least 10 characters" />
        <Select label="Role" value={f.adminRole} onChange={(e) => setF({ ...f, adminRole: e.target.value })}>{ROLES.map(([v]) => <option key={v} value={v}>{titleCase(v)}</option>)}</Select>{err && <p role="alert" className="text-sm text-danger">{err}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create admin</Button></div></form></Modal></div>
  );
}

export function AdminAudit() {
  const [f, setF] = useState({ entity: '', action: '', q: '', from: '', to: '' }); const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => (x.q === term.trim() ? x : { ...x, q: term.trim() })), 350); return () => clearTimeout(t); }, [term]); // search as you type, without a request per key
  const q = useQuery({ queryKey: ['admin-audit', f], queryFn: () => get<{ logs: any[] }>('/admin/audit-logs', { entity: f.entity || undefined, action: f.action || undefined, q: f.q || undefined, from: f.from || undefined, to: f.to || undefined, limit: 100 }), placeholderData: (p) => p });
  return (
    <div><PageHeader title="Audit logs" subtitle="Immutable record of sensitive actions" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Input label="Search" placeholder="Action, ID, person or detail" value={term} onChange={(e) => setTerm(e.target.value)} /><Input label="From" type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To" type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF({ ...f, to: e.target.value })} /><Select label="Entity" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">All</option>{['user', 'venue', 'venue_document', 'booking', 'refund', 'payout', 'coupon', 'banner', 'settings', 'review', 'ticket', 'notification'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select><Input label="Action contains" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="e.g. approve" /></div>
      <QueryBoundary q={q} empty={(d) => d.logs.length === 0 && <Empty icon="🧾" title="No log entries" hint={f.q || f.from || f.to || f.entity || f.action ? 'Nothing matches these filters.' : undefined} />}>{(d) => <Table rows={d.logs.map((l) => ({ ...l, id: String(l.id) }))} columns={[{ key: 'created_at', header: 'When', render: (l: any) => fmtDateTime(l.created_at) }, { key: 'actor_name', header: 'Actor', render: (l: any) => l.actor_name ?? 'System' }, { key: 'action', header: 'Action', render: (l: any) => <code className="text-xs">{l.action}</code> }, { key: 'entity', header: 'Entity', render: (l: any) => `${l.entity}${l.entity_id ? ` · ${String(l.entity_id).slice(0, 8)}` : ''}` }, { key: 'metadata', header: 'Details', render: (l: any) => <span className="text-xs text-muted">{Object.keys(l.metadata).length ? JSON.stringify(l.metadata).slice(0, 80) : '—'}</span> }, { key: 'ip', header: 'IP' }]} />}</QueryBoundary></div>
  );
}
