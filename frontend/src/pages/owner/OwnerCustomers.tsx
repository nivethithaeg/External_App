import { downloadXlsx } from '../../lib/xlsx';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, post, put } from '../../lib/api';
import { Badge, Button, ConfirmButton, Empty, Input, Loading, Modal, PageHeader, QueryBoundary, Select, Stat, Table, Textarea } from '../../components/ui';
import { fmtDateTime, money, titleCase } from '../../lib/utils';
import { isIndianMobile, MOBILE_MESSAGE } from '../../lib/phone';

type Customer = { manual_id?: string; source?: string; key: string; name: string; mobile: string | null; email: string | null; city: string | null; bookings: number; cancelled: number; spent: number; last_booking: string | null };
type Data = { customers: Customer[]; summary: { customers: number; repeat: number; bookings: number; cancellations: number } };

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Everyone who booked with this owner, one row each, as on JusGo's Customers page. */
export function OwnerCustomersPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ id?: string; name: string; mobile: string; city: string; note: string } | null>(null); const [formErr, setFormErr] = useState('');
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Customer | null>(null);
  const q = useQuery({ queryKey: ['owner-customers', search], queryFn: () => get<Data>('/owner/customers', search ? { search } : {}), placeholderData: (prev) => prev });
  const history = useQuery({ queryKey: ['owner-customer-history', sel?.key], enabled: !!sel, queryFn: () => get<{ bookings: any[] }>('/owner/customers/history', { key: sel!.key }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['owner-customers'] });
  const saveCustomer = useMutation({
    mutationFn: () => { const body = { name: form!.name.trim(), mobile: form!.mobile.replace(/[\s-]/g, ''), city: form!.city.trim(), note: form!.note.trim() }; return form!.id ? put(`/owner/customers/${form!.id}`, body) : post('/owner/customers', body); },
    onSuccess: () => { setForm(null); refresh(); }, onError: (e) => setFormErr(apiError(e)),
  });
  const removeCustomer = useMutation({ mutationFn: (id: string) => del(`/owner/customers/${id}`), onSuccess: refresh });
  const goSave = () => { setFormErr(''); if (form!.name.trim().length < 2) return setFormErr('Enter the name'); if (!isIndianMobile(form!.mobile.replace(/[\s-]/g, ''))) return setFormErr(MOBILE_MESSAGE); if (form!.city.trim().length < 2) return setFormErr('Enter the city'); saveCustomer.mutate(); };
  const csv = () => q.data && downloadXlsx('customers.xlsx', ['Customer', 'Mobile', 'Email', 'City', 'Bookings', 'Cancelled', 'Total spent', 'Last booking'],
    q.data.customers.map((c) => [c.name, c.mobile, c.email, c.city, c.bookings, c.cancelled, c.spent, c.last_booking ? fmtDateTime(c.last_booking) : '']));
  return (
    <div>
      <PageHeader title="Customers" subtitle="Everyone who booked with you: booking customers, opponents and event customers, one row each."
        actions={<><Button variant="ghost" onClick={csv} disabled={!q.data?.customers.length}>⬇ Download Excel</Button></>} />
      <div className="mb-5 max-w-md"><Input label="Search" placeholder="Name, mobile or booking ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
            <Stat label="Customers" value={d.summary.customers} /><Stat label="Repeat customers" value={d.summary.repeat} accent />
            <Stat label="Total bookings" value={d.summary.bookings} /><Stat label="Cancellations" value={d.summary.cancellations} />
          </div>
          {d.customers.length === 0
            ? <Empty icon="👥" title={search ? 'No customers match' : 'No customers yet'} hint={search ? 'Try a different search.' : 'People who book with you appear here, with their bookings and payments.'} />
            : <Table rows={d.customers.map((c) => ({ ...c, id: c.key }))} onRow={(c: any) => setSel(c)} columns={[
              { key: 'name', header: 'Customer', render: (c: any) => <div><b>{c.name}</b>{c.bookings > 1 && <Badge status="approved">Repeat</Badge>}<div className="text-xs text-muted">{c.email ?? ''}</div></div> },
              { key: 'mobile', header: 'Mobile', render: (c: any) => c.mobile ?? '—' }, { key: 'city', header: 'City', render: (c: any) => c.city ?? '—' },
              { key: 'bookings', header: 'Bookings' }, { key: 'cancelled', header: 'Cancelled' },
              { key: 'spent', header: 'Total spent', render: (c: any) => money(c.spent) },
              { key: 'last_booking', header: 'Last booking', render: (c: any) => (c.last_booking ? fmtDateTime(c.last_booking) : '—') },
              { key: 'actions', header: '', render: (c: any) => c.manual_id ? (
                <span className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" className="!py-1" onClick={() => { setForm({ id: c.manual_id, name: c.name, mobile: c.mobile ?? '', city: c.city ?? '', note: c.note ?? '' }); setFormErr(''); }}>Edit</Button>
                  <ConfirmButton variant="danger" className="!py-1" message={`Delete ${c.name} from your customers? Their bookings are kept.`} onConfirm={() => removeCustomer.mutate(c.manual_id)}>Delete</ConfirmButton></span>) : null }]} />}
        </div>)}
      </QueryBoundary>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit customer' : 'Add customer'}>
        {form && <div className="space-y-3">
          <Input mandatory label="Customer name" autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input mandatory label="Mobile" type="tel" inputMode="tel" autoComplete="off" value={form.mobile} readOnly={!!form.id} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="9876543210" hint={form.id ? 'The mobile links this customer to their bookings, so it stays the same.' : undefined} />
          <Input mandatory label="City" autoComplete="off" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Textarea label="Note (optional)" rows={2} maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="For example: plays every Sunday morning" />
          <p className="-mt-2 text-xs text-muted">Up to 200 characters.</p>
          {formErr && <p role="alert" className="text-sm text-danger">{formErr}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button loading={saveCustomer.isPending} onClick={goSave}>Save</Button></div></div>}
      </Modal>
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? sel.name : ''}>
        {sel && (history.isLoading ? <Loading /> : (() => {
          const list = history.data?.bookings ?? []; const live = list.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show');
          const spent = live.reduce((n, b) => n + (b.total || 0), 0), paid = live.reduce((n, b) => n + (b.paid || 0), 0);
          const tx = list.filter((b) => (b.paid || 0) > 0).slice(0, 5);
          return (
            <div className="space-y-4 text-sm">
              <p className="text-muted">{[sel.mobile, sel.city, sel.email].filter(Boolean).join(' · ') || 'No contact details'}{(sel as any).note ? ` · ${(sel as any).note}` : ''}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[['Bookings', String(list.length)], ['Cancelled', String(list.length - live.length)], ['Total value', money(spent)], ['Pending', money(Math.max(0, spent - paid))]].map(([l, v]) => <div key={l} className="rounded-xl border border-line p-2.5"><p className="text-xs text-muted">{l}</p><p className="font-bold">{v}</p></div>)}
              </div>
              <section aria-label="Booking history"><h3 className="mb-1 font-bold">Booking history</h3>
                {list.length === 0 ? <p className="text-muted">No bookings.</p> : (
                  <ul className="max-h-72 divide-y divide-line overflow-auto rounded-xl border border-line">{list.map((b) => (
                    <li key={b.id} className="space-y-0.5 px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><b>{b.venue} · {b.area}{b.sport ? ` · ${b.sport}` : ''}</b><Badge status={b.status === 'cancelled' || b.status === 'no_show' ? 'rejected' : 'approved'}>{titleCase(b.status)}</Badge></div>
                      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>{fmtDateTime(b.starts_at)} · {b.reference}</span><span>{money(b.total)}{b.status !== 'cancelled' && (b.paid || 0) < b.total ? ` · ${money(b.total - (b.paid || 0))} pending` : ''}</span></div>
                      {b.cancel_reason && <p className="text-xs text-danger">Cancelled: {b.cancel_reason}</p>}</li>))}</ul>)}</section>
              <section aria-label="Recent transactions"><h3 className="mb-1 font-bold">Recent transactions</h3>
                {tx.length === 0 ? <p className="text-muted">No payments yet.</p> : <ul className="divide-y divide-line rounded-xl border border-line">{tx.map((b) => <li key={b.id} className="flex justify-between gap-2 px-3 py-2"><span>{b.reference}<span className="block text-xs text-muted">{fmtDateTime(b.starts_at)}{b.payment_method ? ` · ${titleCase(b.payment_method)}` : ''}</span></span><b>{money(b.paid)}</b></li>)}</ul>}</section>
            </div>); })())}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Pending payments (venue events paid in parts) */

export function OwnerPendingPaymentsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [rec, setRec] = useState<any | null>(null);
  const [amount, setAmount] = useState(''); const [discount, setDiscount] = useState(''); const [mode, setMode] = useState(''); const [error, setError] = useState('');
  const q = useQuery({ queryKey: ['owner-pending-payments'], queryFn: () => get<{ customers: any[]; totalPending: number }>('/owner/pending-payments') });
  const save = useMutation({
    mutationFn: () => post(`/owner/bookings/${rec.id}/payments`, { amount: Number(amount || 0), discount: Number(discount || 0), ...(Number(amount) > 0 ? { mode } : {}) }),
    onSuccess: () => { setRec(null); setAmount(''); setDiscount(''); qc.invalidateQueries({ queryKey: ['owner-pending-payments'] }); }, onError: (e) => setError(apiError(e)),
  });
  const csv = () => q.data && downloadXlsx('pending-payments.xlsx', ['Customer', 'Mobile', 'Booking', 'Date', 'Total', 'Paid', 'Pending'],
    q.data.customers.flatMap((c) => c.bills.map((b: any) => [c.name, c.mobile, b.reference, fmtDateTime(b.starts_at), b.total, b.paid, b.pending])));
  const go = () => { setError(''); const n = Number(amount || 0); const d = Number(discount || 0); if (!(n > 0 || d > 0)) return setError('Enter the amount received or a discount'); if (n > 0 && !mode) return setError('Please select the mode of payment.'); if (n + d > rec.pending + 0.001) return setError(`Only ${money(rec.pending)} is pending`); save.mutate(); };
  return (
    <div>
      <PageHeader title="Pending payments" subtitle="Venue events that are not fully paid. Record the money as it comes in, bills oldest first."
        actions={<Button variant="ghost" onClick={csv} disabled={!q.data?.customers.length}>⬇ Download Excel</Button>} />
      <div className="mb-5 max-w-md"><Input label="Search" placeholder="Name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <QueryBoundary q={q}>{(d) => {
        const list = d.customers.filter((c) => !search || `${c.name} ${c.mobile ?? ''}`.toLowerCase().includes(search.toLowerCase()));
        return (
          <div className="space-y-4">
            <Stat label="Total pending" value={money(d.totalPending)} accent />
            {list.length === 0 ? <Empty icon="✅" title={search ? 'No pending payments match' : 'Nothing pending'} hint={search ? 'Try a different search.' : 'Every recorded payment is complete.'} />
              : list.map((c) => (
                <div key={c.key} className="card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-lg">{c.name}</b><div className="text-xs text-muted">{c.mobile ?? '—'}</div></div>
                  <div className="text-right text-sm"><div>Total {money(c.total)} · Paid {money(c.paid)}</div><b className="text-warn">Pending {money(c.pending)}</b></div></div>
                  <ul className="mt-3 divide-y divide-line text-sm">{c.bills.map((b: any) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><b>{b.venue} · {b.area}</b><div className="text-xs text-muted">{fmtDateTime(b.starts_at)} · {b.reference}</div></div>
                      <div className="flex items-center gap-3"><span>{money(b.paid)} of {money(b.total)}</span><Button variant="ghost" onClick={() => { setRec(b); setAmount(String(b.pending)); setError(''); }}>Record payment</Button></div></li>))}</ul></div>))}
          </div>);
      }}</QueryBoundary>
      <Modal open={!!rec} onClose={() => setRec(null)} title={rec ? `Record payment · ${rec.reference}` : 'Record payment'}>
        {rec && <div className="space-y-3"><p className="text-sm text-muted">{rec.venue} · {rec.area}. Pending {money(rec.pending)}.</p>
          <Input label="Amount received (₹) (optional)" type="number" min={0} inputMode="decimal" placeholder="Amount paid now" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {Number(amount) > 0 && <Select mandatory label="Mode of payment" value={mode} onChange={(e) => setMode(e.target.value)}><option value="" disabled>Select mode</option><option value="online">Online</option><option value="offline">Offline</option></Select>}
          <Input label="Discount (₹) (optional)" type="number" min={0} inputMode="decimal" placeholder="Discount given, if any" hint="Lowers the pending amount. It is not counted as money received." value={discount} onChange={(e) => setDiscount(e.target.value)} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRec(null)} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} onClick={go}>Save</Button></div></div>}
      </Modal>
    </div>
  );
}
