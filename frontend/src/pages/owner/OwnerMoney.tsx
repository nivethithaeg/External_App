import { downloadXlsx, parseCsv } from '../../lib/xlsx';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, get, patch, post } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { BarChart } from '../../components/BarChart';
import { OwnerPendingPaymentsPage } from './OwnerCustomers';
import { DeleteBookingModal, EditBookingModal } from './BookingEdit';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Input, Modal, PageHeader, QueryBoundary, Select, Stat, Table, Tabs, Textarea, EmbeddedCtx } from '../../components/ui';
import { downloadBlob, durationLabel, fmtDate, fmtDateTime, fmtRange, fmtTime, money, titleCase, todayISO, payMethodLabel } from '../../lib/utils';

const TZ = 'Asia/Kolkata';
const istDate = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PAY_LABEL: Record<string, string> = { captured: 'Customer paid', created: 'Payment pending', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Partially refunded' };

/** Opens a print-ready receipt. All values are HTML-escaped. */
function printReceipt(r: { title: string; rows: [string, string][] }) {
  const w = window.open('', '_blank', 'width=640,height=800');
  if (!w) return alert('Allow pop-ups to print the receipt.');
  w.document.write(`<!doctype html><title>${esc(r.title)}</title><style>body{font:14px Arial;max-width:520px;margin:30px auto;color:#111}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:8px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-weight:600}.m{color:#666;font-size:12px}</style>
    <h1>PlaynX</h1><div class="m">${esc(r.title)}</div><table>${r.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table><p class="m">Generated ${esc(new Date().toLocaleString('en-IN'))}. This is a computer-generated receipt.</p>`);
  w.document.close(); w.focus(); w.print();
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage(p: number): void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className="mt-4 flex items-center justify-between text-sm text-muted"><span>{total} record{total === 1 ? '' : 's'}</span><span className="flex items-center gap-2"><Button variant="ghost" className="!py-1" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</Button>Page {page} of {pages}<Button variant="ghost" className="!py-1" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</Button></span></div>;
}

/* ------------------------------------------------------------- Bookings */
const VIEWS = { all: { title: 'Bookings', sub: 'Manage your venue bookings.' }, upcoming: { title: 'Upcoming bookings', sub: 'Confirmed and pending games that have not finished' },
  history: { title: 'Booking history', sub: 'Games that have been played' }, cancelled: { title: 'Cancelled bookings', sub: 'Cancelled and expired bookings' } } as const;
const SIZE = 20;

export function BookingsPage({ view }: { view: keyof typeof VIEWS }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const [sp] = useSearchParams();
  // the overview cards link here with ?preset=today or ?status=completed
  const presetRange = (p: string): [string, string] => (({ today: [istDate(), istDate()], tomorrow: [istDate(1), istDate(1)], week: [istDate(), istDate(6)], month: [istDate().slice(0, 8) + '01', istDate()] } as Record<string, [string, string]>)[p] ?? ['', '']);
  const p0 = sp.get('preset') ?? ''; const [from0, to0] = presetRange(p0);
  const [f, setF] = useState({ q: sp.get('q') ?? '', venueId: '', areaId: '', sportId: '', status: sp.get('status') ?? '', payment: '', from: from0, to: to0, preset: from0 ? p0 : '' });
  const [page, setPage] = useState(1);
  // what each booking is worth, what the venue gets after PlaynX's fee, and what the customer still has to pay
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const live = (b: any) => ['confirmed', 'completed'].includes(b.status);
  // an advance booking: the customer paid the advance online and pays the rest at the venue, which the owner records here
  const isAdvance = (b: any) => b.booking_source !== 'offline' && b.advance_amount != null;
  const collects = (b: any) => b.booking_source === 'offline' || isAdvance(b); // money the owner collects at the venue
  const pendingOf = (b: any) => (!live(b) || !collects(b) ? 0 : Math.max(0, Math.round((n(b.total) - n(b.amount_paid) - n(b.payment_discount)) * 100) / 100));
  const receivedOf = (b: any) => (!live(b) ? 0 : collects(b) ? n(b.amount_paid) : n(b.total));
  // what the owner has from the booking so far: everything received, less PlaynX's fee (an online booking pays the fee)
  const youGetOf = (b: any) => (b.booking_source === 'offline' ? n(b.owner_amount) : isAdvance(b) ? Math.max(0, Math.round((receivedOf(b) - n(b.commission_amount)) * 100) / 100) : n(b.owner_amount));
  const [collect, setCollect] = useState<{ b: any; amount: string; mode: string; err: string } | null>(null);
  const markPaid = useMutation({ mutationFn: (x: { b: any; amount: number; mode: string }) => post(`/owner/bookings/${x.b.id}/payments`, { amount: x.amount, mode: x.mode, note: 'Paid at the venue after playing' }),
    onSuccess: (_r, x) => { setCollect(null); qc.invalidateQueries({ queryKey: ['owner-bookings'] }); qc.invalidateQueries({ queryKey: ['owner-pending-payments'] }); const left = Math.round((pendingOf(x.b) - x.amount) * 100) / 100; toast(left > 0 ? `${money(x.amount)} recorded for ${x.b.reference}. ${money(left)} is still pending.` : `${x.b.reference} is fully paid. ${money(x.amount)} is added to the amount received.`); },
    onError: (e) => toast(apiError(e), 'error') });
  const [open, setOpen] = useState<any>(null); const [editB, setEditB] = useState<any>(null); const [delB, setDelB] = useState<any>(null); const [cancelFor, setCancelFor] = useState<any>(null); const [reason, setReason] = useState('');
  const [scan, setScan] = useState(false); const [code, setCode] = useState(''); const [scanRes, setScanRes] = useState<any>(null); const [scanErr, setScanErr] = useState('');
  const areasQ = useQuery({ queryKey: ['owner-areas'], queryFn: () => get<{ areas: any[] }>('/owner/areas') });
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: any[] }>('/sports'), staleTime: Infinity });
  const q = useQuery({ queryKey: ['owner-bookings', view, f, page], queryFn: () => get<{ bookings: any[]; total: number }>('/owner/bookings', { view, ...Object.fromEntries(Object.entries({ ...f, preset: undefined }).filter(([, v]) => v)), limit: SIZE, page }), placeholderData: (p) => p });
  const venues = [...new Map((areasQ.data?.areas ?? []).map((a) => [a.venue_id, a.venue_name]))];
  const set = (k: string, v: string) => { setF({ ...f, [k]: v, ...(k === 'venueId' ? { areaId: '' } : {}), ...(k === 'from' || k === 'to' ? { preset: 'custom' } : {}) }); setPage(1); };
  const preset = (p: string) => {
    const [from, to] = presetRange(p);
    setF({ ...f, preset: p, from, to }); setPage(1);
  };
  const cancel = useMutation({ mutationFn: () => post(`/owner/bookings/${cancelFor.id}/cancel`, { reason }), onSuccess: (r: any) => { setCancelFor(null); setOpen(null); setReason(''); qc.invalidateQueries({ queryKey: ['owner-bookings'] }); qc.invalidateQueries({ queryKey: ['owner-overview'] }); toast(`Cancelled. Customer refunded ${money(r.refundAmount)}.`); }, onError: (e) => toast(apiError(e), 'error') });
  const check = async (text: string) => { setScanErr(''); setScanRes(null); try { setScanRes(await post('/owner/bookings/verify', { reference: text.trim() })); } catch (e) { setScanErr(apiError(e)); } };
  const verify = () => check(code);
  const receipt = (b: any) => printReceipt({ title: `Booking receipt ${b.reference}`, rows: [['Booking reference', b.reference], ['Customer', b.customer_name], ['Venue', `${b.venue_name} · ${b.area_name}`], ['Sport', b.sport ?? '—'], ['When', fmtRange(b.starts_at, b.ends_at, b.timezone)],
    ['Booking amount', money(b.subtotal)], ['Discount', `−${money(b.discount)}`], ['Customer paid', money(b.total)], ['Platform fee', `−${money(b.commission_amount)}`], ['Your earnings', money(b.owner_amount)], ['Payment', PAY_LABEL[b.payment_status] ?? 'Not required'], ['Status', titleCase(b.status)]] });
  const areas = (areasQ.data?.areas ?? []).filter((a) => !f.venueId || a.venue_id === f.venueId);
  const dur = (b: any) => durationLabel(Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000));

  return (
    <div><PageHeader title={VIEWS[view].title} subtitle={VIEWS[view].sub} actions={<Button variant="ghost" onClick={() => setScan(true)}>🔍 Check a booking</Button>} />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Date presets">{[['', 'Any date'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['month', 'This month']].map(([id, l]) => (
        <button key={id} onClick={() => preset(id)} aria-pressed={f.preset === id} className={`chip !px-3 !py-1.5 text-sm ${f.preset === id ? '!border-brand bg-brand/15 text-ink' : ''}`}>{l}</button>))}</div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1"><Input label="Search" placeholder="Booking ID, customer, venue or area" value={f.q} onChange={(e) => set('q', e.target.value)} /></div>
        <Select label="Venue" value={f.venueId} onChange={(e) => set('venueId', e.target.value)}><option value="">All venues</option>{venues.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        <Select label="Playing area" value={f.areaId} onChange={(e) => set('areaId', e.target.value)}><option value="">All areas</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <Select label="Sport" value={f.sportId} onChange={(e) => set('sportId', e.target.value)}><option value="">All sports</option>{sports.data?.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        {view === 'all' && <Select label="Booking status" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All</option>{['pending', 'confirmed', 'completed', 'cancelled', 'expired'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}
        <Select label="Payment status" value={f.payment} onChange={(e) => set('payment', e.target.value)}><option value="">All</option>{Object.entries(PAY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input label="From date" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} /><Input label="To date" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} />
      </div>
      <QueryBoundary q={q} empty={(d) => d.bookings.length === 0 && <Empty icon="📅" title="No bookings found" hint="Try changing the filters." />}>{(d) => (<>
        <Table animated pageKey={page} rows={d.bookings} onRow={setOpen} columns={[
          { key: 'reference', header: 'Booking ID', render: (b) => <div><b>{b.reference}</b>{b.source === 'offline' && <div><span className="chip !px-2 !py-0.5 text-[10px]" title="A venue event you added. Paid at the venue, not through PlaynX.">Event</span></div>}</div> },
          { key: 'venue', header: 'Venue', watch: (b) => b.venue_name, render: (b) => b.venue_name },
          { key: 'area', header: 'Playing Area', watch: (b) => [b.area_name, b.sport], render: (b) => <div>{b.area_name}<div className="text-xs text-muted">{b.sport}</div></div> },
          { key: 'date', header: 'Date', watch: (b) => b.starts_at, render: (b) => fmtDate(b.starts_at) },
          { key: 'time', header: 'Time', watch: (b) => [b.starts_at, b.ends_at], render: (b) => <span className="whitespace-nowrap text-xs">{fmtRange(b.starts_at, b.ends_at, b.timezone).split(' · ').slice(-1)[0]}</span> },
          { key: 'amount', header: 'Total amount', watch: (b) => [b.total, b.discount], render: (b) => <div><b>{money(n(b.total))}</b>{b.discount > 0 && <div className="text-xs text-ok">−{money(b.discount)} off</div>}<div className="text-xs text-muted">{b.booking_source === 'offline' ? 'Venue event' : 'PlaynX'}</div>{isAdvance(b) && <div className="text-xs text-muted">Advance {money(n(b.advance_amount))} paid online</div>}</div> },
          { key: 'owner', header: 'You get', watch: (b) => [b.owner_amount, b.status], render: (b) => live(b) ? <span className="font-semibold text-ok">{money(youGetOf(b))}{isAdvance(b) && pendingOf(b) > 0 && <span className="block text-xs font-normal text-muted">of {money(n(b.owner_amount))} after the balance</span>}</span> : <span className="text-muted">{money(0)}<span className="block text-xs">{b.status === 'cancelled' ? 'Cancelled' : 'Not booked'}</span></span> },
          { key: 'fee', header: 'Platform fee', watch: (b) => b.commission_amount, render: (b) => (live(b) ? money(n(b.commission_amount)) : <span className="text-muted">{money(0)}</span>) },
          { key: 'pending', header: 'Pending', watch: (b) => [b.amount_paid, b.payment_discount, b.status], render: (b) => { const p = pendingOf(b), r = receivedOf(b); if (!live(b)) return <span className="text-muted" aria-label="Nothing pending">—</span>; return <div>{p > 0 ? <span className="font-semibold text-danger">{money(p)}</span> : <span className="font-semibold text-ok">{money(0)}</span>}{r > 0 && <div className="text-xs text-muted">Received {money(r)}</div>}</div>; } },
          { key: 'status', header: 'Status', render: (b) => <Badge status={b.status} /> },
          { key: 'actions', header: 'Actions', render: (b) => !live(b) && b.booking_source !== 'offline' ? <span className="text-xs text-muted">{b.status === 'cancelled' ? 'Cancelled, nothing to collect' : 'Not booked, nothing to collect'}</span> : b.booking_source !== 'offline' && !(isAdvance(b) && pendingOf(b) > 0) ? <span className="text-xs font-semibold text-ok">{isAdvance(b) ? 'Fully paid' : 'Paid through PlaynX'}</span> : isAdvance(b) ? <div onClick={(e) => e.stopPropagation()}><Button className="!px-2 !py-1" aria-label={`Collect balance for ${b.reference}`} onClick={() => setCollect({ b, amount: String(pendingOf(b)), mode: 'cash', err: '' })}>Collect balance</Button></div> : <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>{pendingOf(b) > 0 && <Button className="!px-2 !py-1" aria-label={`Mark ${b.reference} as paid`} onClick={() => setCollect({ b, amount: String(pendingOf(b)), mode: 'cash', err: '' })}>Mark as paid</Button>}<Button variant="ghost" className="!px-2 !py-1" aria-label={`Edit ${b.reference}`} onClick={() => setEditB(b)}>Edit</Button><Button variant="ghost" className="!px-2 !py-1 text-danger" aria-label={`Delete ${b.reference}`} onClick={() => setDelB(b)}>Delete</Button></div> }]} />
        <Pager page={page} total={d.total} size={SIZE} onPage={setPage} /></>)}</QueryBoundary>

      <Modal open={!!collect} onClose={() => setCollect(null)} title={collect ? `Payment for ${collect.b.reference}` : ''}>{collect && (() => { const due = pendingOf(collect.b); return (
        <form className="space-y-3 text-sm" noValidate onSubmit={(e) => { e.preventDefault(); const a = Number(collect.amount); if (!(a > 0)) return setCollect({ ...collect, err: 'Enter the amount received.' }); if (a > due + 0.001) return setCollect({ ...collect, err: `Only ${money(due)} is pending.` }); markPaid.mutate({ b: collect.b, amount: Math.round(a * 100) / 100, mode: collect.mode }); }}>
          <dl className="grid grid-cols-3 gap-2"><div><dt className="text-xs text-muted">Total</dt><dd className="font-bold">{money(n(collect.b.total))}</dd></div><div><dt className="text-xs text-muted">Received</dt><dd className="font-bold">{money(receivedOf(collect.b))}</dd></div><div><dt className="text-xs text-muted">Pending</dt><dd className="font-bold text-danger">{money(due)}</dd></div></dl>
          <Input mandatory label="Amount received (₹)" type="number" min={1} max={due} inputMode="decimal" value={collect.amount} onChange={(e) => setCollect({ ...collect, amount: e.target.value, err: '' })} hint="The full pending amount is filled in. Change it if the customer paid less." />
          <Select label="Paid by" value={collect.mode} onChange={(e) => setCollect({ ...collect, mode: e.target.value })}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></Select>
          {collect.err && <p role="alert" className="text-danger">{collect.err}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCollect(null)}>Cancel</Button><Button type="submit" loading={markPaid.isPending}>Mark as paid</Button></div>
        </form>); })()}</Modal>
      {editB && <EditBookingModal b={editB} onClose={() => setEditB(null)} onSaved={(m) => { setEditB(null); toast(m); }} />}
      {delB && <DeleteBookingModal b={delB} onClose={() => setDelB(null)} onDeleted={(m) => { setDelB(null); toast(m); }} />}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Booking ${open.reference}` : ''} wide>{open && (<div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">{([['Customer', `${open.customer_name} · ${open.customer_phone ?? ''} ${open.customer_email}`], ['Venue', `${open.venue_name} · ${open.area_name}`], ['Sport', open.sport ?? '—'], ['When', `${fmtRange(open.starts_at, open.ends_at, open.timezone)} (${dur(open)})`],
          ['Booking amount', money(open.subtotal)], ['Discount', money(open.discount)], ['Customer paid', money(open.total)], ['Platform fee', money(open.commission_amount)], ['Your earnings', money(open.owner_amount)], ['Your payout', open.release_state === 'complaint' ? 'On hold while the complaint is open' : open.release_at ? `${open.release_state === 'released' ? 'Released' : 'Releases'} ${fmtDate(open.release_at)}` : '—'], ['Payment', open.payment_status ? PAY_LABEL[open.payment_status] : 'Not required'],
          ['Source', 'Online (customer app)'], ['Created', fmtDateTime(open.created_at)], ['Refunded', open.refunded ? money(open.refunded) : '—']] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>
        {open.cancel_reason && <p className="rounded-xl bg-surface2 p-3"><b>Cancellation reason:</b> {open.cancel_reason}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => receipt(open)}>Download receipt</Button>
          {open.status === 'confirmed' && new Date(open.ends_at) > new Date() && <Button variant="danger" onClick={() => setCancelFor(open)}>Cancel booking</Button>}</div></div>)}</Modal>
      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title="Cancel booking"><p className="mb-3 text-sm text-muted">The customer is notified and refunded in full. Use this only when you cannot host the game.</p>
        <Textarea label="Reason (shown to customer)" value={reason} onChange={(e) => setReason(e.target.value)} /><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCancelFor(null)}>Back</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel & refund</Button></div></Modal>
      <Modal open={scan} onClose={() => { setScan(false); setScanRes(null); setScanErr(''); }} title="Check a booking">
        <p className="mb-3 text-sm text-muted">Type the booking reference the player shows you (for example <code>PX-AB12CD3</code>).</p>
        <div className="flex gap-2"><input className="field uppercase" aria-label="Booking reference" placeholder="PX-XXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} /><Button onClick={verify} disabled={code.trim().length < 6}>Check</Button></div>
        {scanErr && <p role="alert" className="mt-3 text-sm text-danger">{scanErr}</p>}
        {scanRes && <div className={`mt-4 rounded-xl border p-4 ${scanRes.valid ? 'border-ok/50 bg-ok/10' : 'border-danger/50 bg-danger/10'}`}><p className="text-lg font-bold">{scanRes.valid ? '✓ Valid booking' : '✗ Not valid for entry'}</p><p className="text-sm">{scanRes.booking.customer_name} · {scanRes.booking.area_name}</p><p className="text-xs text-muted">{fmtRange(scanRes.booking.starts_at, scanRes.booking.ends_at)} · {titleCase(scanRes.booking.status)}</p></div>}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Payments */
const RELEASE: Record<string, [string, string]> = { released: ['Ready to pay', 'text-ok'], holding: ['On hold until', 'text-warn'], complaint: ['Dispute: complaint', 'text-danger'] };
/** When a booking's share reaches the owner: after the hold period, and only while the customer has no open complaint. */
function ReleaseCell({ t }: { t: any }) {
  const r = RELEASE[t.release_state as string];
  if (!r) return <span className="text-xs text-muted">—</span>;
  return <span className="block min-w-[8.5rem] text-xs"><b className={`whitespace-nowrap ${r[1]}`}>{r[0]}</b>{t.release_state === 'holding' && t.release_at && <span className="block whitespace-nowrap text-muted">{fmtDate(t.release_at)}</span>}{t.release_state === 'released' && <span className="block text-muted">reaches your bank when PlaynX pays you</span>}</span>;
}

export function PaymentsPage() {
  const { toast } = useToast();
  const [f, setF] = useState({ q: '', status: '', from: '', to: '' }); const [page, setPage] = useState(1); const [open, setOpen] = useState<any>(null);
  const q = useQuery({ queryKey: ['owner-tx', f, page], queryFn: () => get<{ transactions: any[]; total: number }>('/owner/transactions', { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), limit: SIZE, page }), placeholderData: (p) => p });
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const [setl, setSetl] = useState('');
  const [month, setMonth] = useState(() => todayISO().slice(0, 7)); const [dl, setDl] = useState(false);
  const statement = async () => { setDl(true); try { const r = await api.get('/owner/statements/monthly.csv', { params: { month }, responseType: 'blob' }); downloadBlob(r.data, `statement-${month}.csv`); } catch (e) { toast(apiError(e), 'error'); } finally { setDl(false); } };
  const ps = useQuery({ queryKey: ['owner-payout-status'], queryFn: () => get<{ totals: { gross: number; on_hold: number; ready_to_pay: number; dispute: number } }>('/owner/payout-status') });
  const bal = useQuery({ queryKey: ['owner-settlements'], queryFn: () => get<{ summary: { available: number; holding: number; disputed: number; pending: number; completed: number; holdHours: number }; payouts: any[] }>('/owner/settlements') });
  const rcpt = (t: any) => printReceipt({ title: `Payment receipt ${t.transaction_id}`, rows: [['Transaction', t.transaction_id], ['Booking', t.reference], ['Customer', t.customer_name], ['Venue', t.venue_name], ['Date', fmtDateTime(t.paid_at ?? t.created_at)], ['Method', payMethodLabel(t.method)],
    ['Gross booking amount', money(t.subtotal)], ['Discount', `−${money(t.discount)}`], ['Customer paid', money(t.amount)], ['Platform fee', `−${money(t.commission_amount)}`], ['Your earnings', money(t.owner_amount)], ['Refunded', money(t.refunded)], ['Status', PAY_LABEL[t.status] ?? t.status]] });
  return (
    <div><PageHeader title="Payments & transactions" subtitle="Online payments for your bookings. Card and UPI details are never stored." />
      {bal.data && (<section aria-label="Your balance" className="mb-5">
        {/* how a booking's money moves: gross value -> on hold -> (ready to pay | dispute) -> paid to your bank */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Gross value" value={money(ps.data?.totals.gross ?? 0)} hint="What customers paid for PlaynX bookings" />
          <Stat label="On hold" value={money(bal.data.summary.holding)} hint={`Your share, kept for ${bal.data.summary.holdHours} hours after the game. Then it moves to Ready to pay, or to Dispute if the customer complains.`} />
          <Stat label="Ready to pay" value={money(bal.data.summary.available)} accent hint="No complaint: due to you (gross value less the platform fee), not yet sent" />
          <Stat label="Dispute" value={money(ps.data?.totals.dispute ?? bal.data.summary.disputed)} hint="A customer complained: held, or refunded to the customer" />
          <div className="col-span-2 md:col-span-1"><Stat label="Paid to your bank" value={money(bal.data.summary.completed)} hint={(bal.data.summary as any).testPaid > 0 ? `Includes ${money((bal.data.summary as any).testPaid)} paid in TEST mode: no real money was sent to your bank` : 'Sent by PlaynX to your bank account'} /></div>
        </div>
        <p className="mt-2 text-xs text-muted">Customers pay PlaynX first. Your share stays on hold for {bal.data.summary.holdHours} hours after the game. With no complaint it becomes <b>Ready to pay</b>; it moves to <b>Paid to your bank</b> only when PlaynX transfers it and records the bank reference. Venue events are paid to you directly and are not part of this.</p></section>)}
      {bal.data && (<section aria-label="Settlements" className="mb-6">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold">Settlements</h2><p className="text-xs text-muted">Each amount PlaynX has sent, or is sending, to your bank. The admin enters the amount and the bank reference when they pay you.</p></div>
          <div className="w-44"><Select label="Settlement" value={setl} onChange={(e) => setSetl(e.target.value)}><option value="">All</option><option value="paid">Paid to my bank</option><option value="pending">Pending</option><option value="failed">Failed</option></Select></div></div>
        {(() => { const rows = bal.data.payouts.filter((p) => !setl || p.status === setl);
          return rows.length === 0 ? <p className="text-sm text-muted">{bal.data.payouts.length === 0 ? 'No settlements yet. Once the admin sends you money it is listed here with the amount and bank reference.' : 'No settlements match this filter.'}</p>
            : <Table rows={rows} columns={[{ key: 'when', header: 'Date', render: (p: any) => fmtDate(p.paid_at ?? p.created_at) }, { key: 'period', header: 'For games between', render: (p: any) => `${String(p.period_start).slice(0, 10)} → ${String(p.period_end).slice(0, 10)}` }, { key: 'amount', header: 'Amount sent', render: (p: any) => <b>{money(p.amount)}</b> }, { key: 'reference', header: 'Bank reference', render: (p: any) => p.reference ?? '—' }, { key: 'status', header: 'Status', render: (p: any) => <><Badge status={p.status === 'paid' ? 'completed' : p.status === 'failed' ? 'cancelled' : 'pending'}>{p.status === 'paid' ? 'Paid' : p.status === 'failed' ? 'Failed' : 'Pending'}</Badge>{p.is_test && <span className="ml-1 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold uppercase text-warn">Test: no real transfer</span>}</> }]} />; })()}
      </section>)}
      <section aria-label="Monthly statement" className="card mb-5 flex flex-wrap items-end justify-between gap-3 p-4">
        <div><h2 className="text-xl font-bold">Monthly statement</h2><p className="text-xs text-muted">Every online booking for the month: what it made, what PlaynX kept, what you earn and when each payout is released.</p></div>
        <div className="flex items-end gap-2"><div className="w-44"><Input label="Month" type="month" max={todayISO().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} /></div><Button variant="ghost" loading={dl} disabled={!month} onClick={statement}>Download CSV</Button></div></section>
      <div className="mb-4 grid gap-3 sm:grid-cols-4"><Input label="Search" placeholder="Booking, customer, payment ID" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <Select label="Status" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All</option>{['captured', 'failed', 'refunded', 'partially_refunded'].map((s) => <option key={s} value={s}>{PAY_LABEL[s]}</option>)}</Select>
        <Input label="From" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /><Input label="To" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></div>
      <QueryBoundary q={q} empty={(d) => d.transactions.length === 0 && <Empty icon="💳" title="No transactions found" />}>{(d) => (<>
        <Table rows={d.transactions} onRow={setOpen} columns={[{ key: 'transaction_id', header: 'Transaction', render: (t) => <code className="text-xs">{t.transaction_id}</code> }, { key: 'reference', header: 'Booking', render: (t) => <b>{t.reference}</b> },
          { key: 'customer_name', header: 'Customer' }, { key: 'venue_name', header: 'Venue' }, { key: 'subtotal', header: 'Gross', render: (t) => money(t.subtotal) }, { key: 'discount', header: 'Discount', render: (t) => (t.discount ? `−${money(t.discount)}` : '—') },
          { key: 'commission_amount', header: 'Platform fee', render: (t) => money(t.commission_amount) }, { key: 'owner_amount', header: 'You earn', render: (t) => <b>{money(t.owner_amount)}</b> }, { key: 'method', header: 'Method', render: (t) => payMethodLabel(t.method) },
          { key: 'status', header: 'Customer payment', render: (t) => <Badge status={t.status}>{PAY_LABEL[t.status] ?? t.status}</Badge> }, { key: 'release_state', header: 'Your payout', render: (t) => <ReleaseCell t={t} /> }, { key: 'at', header: 'Date', render: (t) => { const d = t.paid_at ?? t.created_at; return <span className="block whitespace-nowrap text-xs">{fmtDate(d)}<span className="block text-muted">{fmtTime(d)}</span></span>; } }]} />
        <Pager page={page} total={d.total} size={SIZE} onPage={setPage} /></>)}</QueryBoundary>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Transaction details">{open && <div className="space-y-3 text-sm"><dl className="grid grid-cols-2 gap-3">{([['Transaction', open.transaction_id], ['Booking', open.reference], ['Customer', open.customer_name], ['Method', open.method ?? '—'], ['Customer paid', money(open.amount)], ['Platform fee', money(open.commission_amount)], ['Your earnings', money(open.owner_amount)], ['Refunded', money(open.refunded)]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs uppercase text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl><div className="flex justify-end"><Button onClick={() => rcpt(open)}>Download receipt</Button></div></div>}</Modal></div>
  );
}

/* -------------------------------------------------------------- Refunds */
function RecordRefundModal({ w, onClose }: { w: any; onClose(): void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [amount, setAmount] = useState(String(w.refunded || w.paid)); const [mode, setMode] = useState(w.refund_mode ?? ''); const [error, setError] = useState('');
  const save = useMutation({ mutationFn: () => patch(`/owner/bookings/${w.id}`, { refund: { amount: Number(amount), ...(Number(amount) > 0 ? { mode } : {}) } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner-refunds'] }); toast(`Refund recorded on ${w.reference}.`); onClose(); }, onError: (e) => setError(apiError(e)) });
  const go = () => { setError(''); if (!(Number(amount) >= 0) || amount.trim() === '') return setError('Enter the refund amount.'); if (Number(amount) > w.paid) return setError(`The refund cannot be more than the ${money(w.paid)} paid.`); if (Number(amount) > 0 && !mode) return setError('Please select the mode of refund.'); save.mutate(); };
  return (
    <Modal open onClose={onClose} title={`Refund · ${w.reference}`}>
      <div className="space-y-3"><p className="text-sm text-muted">{w.name} · {w.venue_name} · {w.area_name}. The customer paid {money(w.paid)}.</p>
        <Input mandatory label="Refund amount (₹)" type="number" min={0} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} hint="0 removes the refund." />
        {Number(amount) > 0 && <Select mandatory label="Mode of refund" value={mode} onChange={(e) => setMode(e.target.value)}><option value="" disabled>Select mode</option><option value="online">Online</option><option value="offline">Offline</option></Select>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} onClick={go}>Save</Button></div></div>
    </Modal>);
}

export function RefundsPage() {
  const q = useQuery({ queryKey: ['owner-refunds'], queryFn: () => get<{ refunds: any[]; walkIns: any[] }>('/owner/refunds') }); const [rec, setRec] = useState<any>(null);
  const [search, setSearch] = useState('');
  return (
    <div><PageHeader title="Refunds" subtitle="Every cancelled booking, with the money to give back: what was refunded, and what is still to give back." />
      <div className="mb-4 max-w-md"><Input label="Search" placeholder="Customer name, mobile or booking ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <p className="mb-4 rounded-xl border border-line bg-surface p-3 text-sm text-muted">Refunds are issued automatically by the platform: in full when a customer cancels before your cancellation window or when you or PlaynX cancel, and not at all inside the window. You can't issue refunds manually. For exceptions, <Link className="underline" to="/owner/support">contact support</Link>.</p>
      {rec && <RecordRefundModal w={rec} onClose={() => setRec(null)} />}
      <QueryBoundary q={q} empty={(d) => d.refunds.length === 0 && (d.walkIns ?? []).length === 0 && <Empty icon="↩️" title="No refunds" hint="Refunds appear here after a booking is cancelled." />}>
        {(d) => <>{(d.walkIns ?? []).length > 0 && (
        <section aria-label="Cancelled bookings to give back" className="mb-6"><h2 className="mb-2 text-2xl font-bold">Cancelled bookings</h2><p className="mb-3 text-sm text-muted">Bookings you made that were cancelled after the customer paid you. Give the money back and record it here.</p>
          <Table rows={d.walkIns.filter((w: any) => !search || [w.name, w.mobile, w.reference].some((x) => x && String(x).toLowerCase().includes(search.toLowerCase())))} columns={[{ key: 'reference', header: 'Booking', render: (w: any) => <b>{w.reference}</b> }, { key: 'name', header: 'Customer', render: (w: any) => <div>{w.name}<div className="text-xs text-muted">{w.mobile}</div></div> }, { key: 'where', header: 'Venue / area', render: (w: any) => `${w.venue_name} · ${w.area_name}` },
            { key: 'paid', header: 'Paid', render: (w: any) => money(w.paid) }, { key: 'refunded', header: 'Refunded', render: (w: any) => (w.refunded > 0 ? <div>{money(w.refunded)}<div className="text-xs text-muted">{w.refund_mode === 'online' ? 'Online' : 'Offline'}</div></div> : '—') },
            { key: 'give', header: 'To give back', render: (w: any) => <b className={w.to_give_back > 0 ? 'text-warn' : 'text-ok'}>{money(w.to_give_back)}</b> },
            { key: 'act', header: '', render: (w: any) => w.paid > 0 ? <Button variant="ghost" className="!py-1" onClick={() => setRec(w)}>{w.refunded > 0 ? 'Edit refund' : 'Record refund'}</Button> : <span className="text-xs text-muted">Nothing paid</span> }]} /></section>)}{d.refunds.length > 0 && <Table rows={d.refunds.filter((r: any) => !search || Object.values(r).some((x) => typeof x === 'string' && x.toLowerCase().includes(search.toLowerCase())))} columns={[{ key: 'id', header: 'Refund ID', render: (r) => <code className="text-xs">{r.id.slice(0, 8)}</code> }, { key: 'reference', header: 'Booking', render: (r) => <b>{r.reference}</b> }, { key: 'razorpay_payment_id', header: 'Original payment', render: (r) => <code className="text-xs">{r.razorpay_payment_id ?? '—'}</code> },
          { key: 'amount', header: 'Refund amount', render: (r) => <div>{money(r.amount)}<div className="text-xs text-muted">of {money(r.booking_total)}</div></div> }, { key: 'reason', header: 'Reason', render: (r) => r.reason ?? '—' }, { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: 'created_at', header: 'Date', render: (r) => fmtDateTime(r.processed_at ?? r.created_at) }]} />}</>}</QueryBoundary></div>
  );
}

/* ------------------------------------------------------------ Analytics */
/** Branch comparison: one row per venue for the same dates, best value in each column highlighted. Needs two or more venues. */
function VenueCompare({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['venues-compare', from, to], queryFn: () => get<{ venues: { id: string; name: string; city: string; bookings: number; revenue: number; avgValue: number; customers: number; cancelRate: number; occupancyPct: number; rating: number | null; reviews: number }[] }>('/owner/reports/venues-compare', { from, to }), enabled: from <= to });
  const v = q.data?.venues ?? [];
  if (v.length < 2) return null;
  const top = (k: 'revenue' | 'bookings' | 'occupancyPct' | 'customers') => Math.max(...v.map((x) => x[k]));
  const low = Math.min(...v.map((x) => x.cancelRate));
  const best = 'font-bold text-ok';
  return (
    <Card className="mt-4 p-5">
      <h2 className="mb-1 text-2xl font-bold">Compare your venues</h2>
      <p className="mb-3 text-sm text-muted">Same dates, side by side. The best value in each column is highlighted.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-3">Venue</th><th className="pr-3 text-right">Bookings</th><th className="pr-3 text-right">Revenue</th><th className="pr-3 text-right">Occupancy</th><th className="pr-3 text-right">Players</th><th className="pr-3 text-right">Cancelled</th><th className="text-right">Rating</th></tr></thead>
        <tbody className="divide-y divide-line">{v.map((x) => (
          <tr key={x.id}>
            <td className="py-2 pr-3"><div className="font-semibold">{x.name}</div><div className="text-xs text-muted">{x.city}</div></td>
            <td className={`pr-3 text-right ${x.bookings === top('bookings') ? best : ''}`}>{x.bookings}</td>
            <td className={`pr-3 text-right ${x.revenue === top('revenue') ? best : ''}`}>{money(x.revenue)}</td>
            <td className={`pr-3 text-right ${x.occupancyPct === top('occupancyPct') ? best : ''}`}>{x.occupancyPct}%</td>
            <td className={`pr-3 text-right ${x.customers === top('customers') ? best : ''}`}>{x.customers}</td>
            <td className={`pr-3 text-right ${x.cancelRate === low ? best : ''}`}>{x.cancelRate}%</td>
            <td className="text-right">{x.rating ? `★ ${x.rating} (${x.reviews})` : '—'}</td>
          </tr>))}</tbody>
      </table></div>
    </Card>);
}

export function AnalyticsPage() {
  const { toast } = useToast();
  const custQ = useQuery({ queryKey: ['owner-customers-report'], queryFn: () => get<{ customers: number; repeatCustomers: number; repeatRate: number; avgBookings: number; top: { customer_id: string; full_name: string; bookings: number; spend: number }[] }>('/owner/reports/customers') });
  const [f, setF] = useState({ from: todayISO(-29), to: todayISO(), venueId: '', areaId: '', sportId: '', status: '', source: '', groupBy: 'day' });
  const areasQ = useQuery({ queryKey: ['owner-areas'], queryFn: () => get<{ areas: any[] }>('/owner/areas') });
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: any[] }>('/sports'), staleTime: Infinity });
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const q = useQuery({ queryKey: ['owner-analytics', f], queryFn: () => get<any>('/owner/analytics', params), enabled: f.from <= f.to });
  const venues = [...new Map((areasQ.data?.areas ?? []).map((a) => [a.venue_id, a.venue_name]))];
  const exportCsv = async (url: string, name: string, p: object) => { try { const r = await api.get(url, { params: p, responseType: 'blob' }); const rows = parseCsv(await (r.data as Blob).text()); const [h, ...body] = rows; if (rows.length > 1 && h) downloadXlsx(name, h.map(String), body); else downloadBlob(r.data, name); } catch (e) { toast(apiError(e), 'error'); } };
  return (
    <div><PageHeader title="Reports & analytics" subtitle="Revenue counts only confirmed and completed paid bookings; unpaid holds and cancelled bookings are excluded." actions={<>
      <Button variant="ghost" onClick={() => exportCsv('/owner/analytics', `analytics-${f.from}-${f.to}.xlsx`, { ...params, format: 'csv' })}>⬇ Trend (Excel)</Button>
      <Button variant="ghost" onClick={() => exportCsv('/owner/reports/bookings.csv', `bookings-${f.from}-${f.to}.xlsx`, { from: f.from, to: f.to })}>⬇ Bookings (Excel)</Button><Button variant="ghost" onClick={() => window.print()}>🖨 Print / Save as PDF</Button></>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4 lg:grid-cols-8 print:hidden"><Input label="From date" type="date" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To date" type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Select label="Venue" value={f.venueId} onChange={(e) => setF({ ...f, venueId: e.target.value, areaId: '' })}><option value="">All venues</option>{venues.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        <Select label="Playing area" value={f.areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })}><option value="">All playing areas</option>{(areasQ.data?.areas ?? []).filter((x) => !f.venueId || x.venue_id === f.venueId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        <Select label="Sport" value={f.sportId} onChange={(e) => setF({ ...f, sportId: e.target.value })}><option value="">All sports</option>{sports.data?.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select label="Booking status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{['confirmed', 'completed', 'cancelled', 'pending'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select>
        <Select label="Group by" value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select></div>
      {f.from > f.to ? <ErrorBox error={new Error('The start date must be before the end date')} /> : (
        <QueryBoundary q={q}>{(d) => (<div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"><Stat label="Gross booking value" value={money(d.summary.gross)} /><Stat label="Your earnings" value={money(d.summary.net)} accent /><Stat label="Average booking value" value={money(d.summary.avg_value)} /><Stat label="Slot occupancy" value={`${d.summary.occupancyPct}%`} hint="Booked hours ÷ open hours" /></div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5"><Stat label="Total bookings" value={d.summary.total} /><Stat label="Confirmed" value={d.summary.confirmed} /><Stat label="Completed" value={d.summary.completed} /><Stat label="Pending payment" value={d.summary.pending} /><Stat label="Cancelled" value={d.summary.cancelled} /></div>
          <Card className="p-5">{d.trend.length === 0 ? <p className="py-8 text-center text-sm text-muted">No revenue in this period.</p> : <BarChart title={`Earnings per ${f.groupBy}`} data={d.trend} valueKey="revenue" labelKey="period" height={200} />}</Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5"><h2 className="mb-2 text-2xl font-bold">Revenue by venue</h2>{d.byVenue.length === 0 ? <p className="text-sm text-muted">No data.</p> : <ul className="divide-y divide-line text-sm">{d.byVenue.map((v: any) => <li key={v.name} className="flex justify-between py-2"><span>{v.name} <span className="text-muted">({v.bookings})</span></span><b>{money(v.revenue)}</b></li>)}</ul>}</Card>
            <Card className="p-5"><h2 className="mb-2 text-2xl font-bold">Most booked playing areas</h2>{d.byArea.length === 0 ? <p className="text-sm text-muted">No data.</p> : <ul className="divide-y divide-line text-sm">{d.byArea.map((v: any) => <li key={v.name} className="flex justify-between py-2"><span>{v.name}</span><span><b>{v.bookings}</b> · {money(v.revenue)}</span></li>)}</ul>}</Card>
            <Card className="p-5"><h2 className="mb-2 text-2xl font-bold">Popular sports</h2>{d.bySport.length === 0 ? <p className="text-sm text-muted">No data.</p> : <ul className="divide-y divide-line text-sm">{d.bySport.map((v: any) => <li key={v.name} className="flex justify-between py-2"><span>{v.name}</span><span><b>{v.bookings}</b> · {money(v.revenue)}</span></li>)}</ul>}</Card>
            <Card className="p-5"><h2 className="mb-2 text-2xl font-bold">Peak booking hours</h2>{d.peakHours.length === 0 ? <p className="text-sm text-muted">No data.</p> : <BarChart title="Bookings by start hour" data={d.peakHours.map((h: any) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }))} valueKey="bookings" labelKey="label" currency={false} height={140} />}</Card>
            <Card className="p-5 lg:col-span-2"><section aria-label="Repeat customers"><h2 className="mb-1 text-2xl font-bold">Repeat customers</h2><p className="mb-3 text-xs text-muted">Players who booked online with you more than once, over all time.</p>
              {!custQ.data?.top || custQ.data.customers === 0 ? <p className="text-sm text-muted">No online customers yet.</p> : (<>
                <div className="mb-4 grid grid-cols-3 gap-3 text-center"><div><p className="font-display text-3xl font-bold">{custQ.data.customers}</p><p className="text-xs text-muted">customers</p></div><div><p className="font-display text-3xl font-bold text-[rgb(var(--brand-text))]">{custQ.data.repeatRate}%</p><p className="text-xs text-muted">came back ({custQ.data.repeatCustomers})</p></div><div><p className="font-display text-3xl font-bold">{custQ.data.avgBookings}</p><p className="text-xs text-muted">bookings each, on average</p></div></div>
                <ul className="divide-y divide-line text-sm">{custQ.data.top.map((c) => <li key={c.customer_id} className="flex items-center justify-between gap-3 py-2"><span><b>{c.full_name}</b> <span className="text-muted">· {c.bookings} booking{c.bookings === 1 ? '' : 's'}</span></span><b>{money(c.spend)}</b></li>)}</ul></>)}</section></Card>
          </div></div>)}</QueryBoundary>)}
      <VenueCompare from={f.from} to={f.to} /></div>
  );
}

/* ------------------------------------------------------- Report & Payments (one page, two tabs) */
const RP_SUBTITLE: Record<string, string> = { report: 'How your venues and playing areas are performing.', payments: 'What each booking costs, what has been paid, what is still pending and what was refunded.' };
const PAY_VIEWS = [['', 'All payments'], ['pending', 'Pending'], ['refunds', 'Refunds']] as const;
export function ReportPaymentsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'payments' ? 'payments' : 'report'; const status = sp.get('status') ?? '';
  const go = (t: string, st = '') => setSp(t === 'payments' ? { tab: 'payments', ...(st ? { status: st } : {}) } : {}, { replace: true });
  return (
    <div><PageHeader title="Report & Payments" subtitle={RP_SUBTITLE[tab]} />
      <div className="mb-5"><Tabs tabs={[{ id: 'report', label: 'Report' }, { id: 'payments', label: 'Payments' }]} value={tab} onChange={(t) => go(t)} /></div>
      <EmbeddedCtx.Provider value>
        {tab === 'report' ? <AnalyticsPage /> : (<div>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Payments view">{PAY_VIEWS.map(([id, l]) => <button key={id} type="button" aria-pressed={status === id} onClick={() => go('payments', id)} className={`chip !px-3 !py-1.5 text-sm ${status === id ? '!border-brand bg-brand/15 text-ink' : ''}`}>{l}</button>)}</div>
          {status === 'pending' ? <OwnerPendingPaymentsPage /> : status === 'refunds' ? <RefundsPage /> : <PaymentsPage />}</div>)}
      </EmbeddedCtx.Provider>
    </div>
  );
}
