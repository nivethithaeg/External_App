import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, patch, post } from '../../lib/api';
import { Button, Input, Modal, Select, Textarea } from '../../components/ui';
import { MOBILE_MESSAGE, isIndianMobile } from '../../lib/phone';
import { fmtDate, fmtRange, fmtTime, money } from '../../lib/utils';

const STATUS_LABEL: Record<string, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid' };
const invalidate = (qc: ReturnType<typeof useQueryClient>) => ['owner-bookings', 'owner-overview', 'owner-calendar', 'owner-pending-payments', 'owner-refunds', 'owner-customers', 'offline-slots'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
const dateOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
const todayIn = (tz: string) => dateOf(new Date().toISOString(), tz);

/** JusGo's Edit booking: the date and slot, the customer (and opponents), the amount, the payment and, on a cancelled booking, the refund given. */
export function EditBookingModal({ b, onClose, onSaved }: { b: any; onClose(): void; onSaved(msg: string): void }) {
  const qc = useQueryClient(); const tz: string = b.timezone ?? 'Asia/Kolkata';
  const cancelled = b.status === 'cancelled'; const started = new Date(b.starts_at) <= new Date(); const movable = b.status === 'confirmed' && !started; const openGround = b.area_environment === 'outdoor';
  const dur = Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000);
  const [date, setDate] = useState(dateOf(b.starts_at, tz)); const [slot, setSlot] = useState<string | null>(null);
  const [c, setC] = useState({ phone: b.walkin_phone ?? b.customer_phone ?? '', name: b.customer_name ?? '', city: b.walkin_city ?? '', o1Phone: b.opponent1_phone ?? '', o1Name: b.opponent1_name ?? '', o1City: b.opponent1_city ?? '', o2Phone: b.opponent_phone ?? '', o2Name: b.opponent_name ?? '', o2City: b.opponent_city ?? '', note: b.booking_notes ?? '' });
  const [price, setPrice] = useState<string | null>(null); const shownPrice = price ?? String(b.total);
  const paidNow = Number(b.amount_paid ?? 0);
  const [pay, setPay] = useState({ status: '', initial: '', mode: '' }); const [refund, setRefund] = useState(String(b.refund_amount ?? 0)); const [refundMode, setRefundMode] = useState<string>(b.refund_mode ?? '');
  const [attempted, setAttempted] = useState(false); const [error, setError] = useState(''); const [confirmRestore, setConfirmRestore] = useState(false);
  const day = useQuery({ queryKey: ['edit-slots', b.area_id, b.sport_id, date, dur], enabled: movable, queryFn: () => get<{ slots: any[] }>(`/areas/${b.area_id}/slots`, { date, sportId: b.sport_id, duration: dur }) });
  const slots = (day.data?.slots ?? []).filter((s) => s.reason !== 'past' && s.reason !== 'unpriced');
  const own = (s: any) => new Date(s.startsAt).getTime() === new Date(b.starts_at).getTime();
  const newSlot = slot ? slots.find((s) => s.startsAt === slot) : null;
  const total = Number(shownPrice);
  const errs = useMemo(() => {
    const e: Record<string, string> = {};
    if (!isIndianMobile(c.phone.replace(/[\s-]/g, ''))) e.phone = MOBILE_MESSAGE;
    if (c.name.trim().length < 2) e.name = "Enter the customer's name"; if (c.city.trim().length < 2) e.city = "Enter the customer's city";
    if (openGround) for (const [k, l] of [['o1', 'Opponent 1'], ['o2', 'Opponent 2']] as const) { if (!isIndianMobile((c as any)[`${k}Phone`].replace(/[\s-]/g, ''))) e[`${k}Phone`] = MOBILE_MESSAGE; if ((c as any)[`${k}Name`].trim().length < 2) e[`${k}Name`] = `Enter ${l}'s name`; if ((c as any)[`${k}City`].trim().length < 2) e[`${k}City`] = `Enter ${l}'s city`; }
    if (!(total >= 0) || shownPrice.trim() === '') e.price = 'Enter the amount.';
    if (pay.status === 'partial' && !(Number(pay.initial) > 0 && Number(pay.initial) < total)) e.initial = `Enter an amount more than 0 and less than ${money(total)}.`;
    if ((pay.status === 'paid' || pay.status === 'partial') && !pay.mode) e.mode = 'Please select the mode of payment.';
    if (cancelled) { if (Number(refund) > paidNow) e.refund = `The refund cannot be more than the ${money(paidNow)} paid.`; if (Number(refund) > 0 && !refundMode) e.refundMode = 'Please select the mode of refund.'; }
    return e;
  }, [c, shownPrice, pay, refund, refundMode, openGround, cancelled, total, paidNow]);
  const save = useMutation({
    mutationFn: () => patch(`/owner/bookings/${b.id}`, {
      customerName: c.name.trim(), customerPhone: c.phone.replace(/[\s-]/g, ''), customerCity: c.city.trim(), note: c.note.trim(),
      ...(openGround ? { opponent1Name: c.o1Name.trim(), opponent1Phone: c.o1Phone.replace(/[\s-]/g, ''), opponent1City: c.o1City.trim(), opponentName: c.o2Name.trim(), opponentPhone: c.o2Phone.replace(/[\s-]/g, ''), opponentCity: c.o2City.trim() } : {}),
      ...(newSlot ? { startsAt: newSlot.startsAt } : {}), ...(Number(shownPrice) !== Number(b.total) ? { price: total } : {}),
      ...(pay.status ? { payment: { status: pay.status, ...(pay.status === 'partial' ? { amountPaid: Number(pay.initial) } : {}), ...(pay.status !== 'unpaid' ? { mode: pay.mode } : {}) } } : {}),
      ...(cancelled && (Number(refund) !== Number(b.refund_amount ?? 0) || refundMode !== (b.refund_mode ?? '')) ? { refund: { amount: Number(refund), ...(Number(refund) > 0 ? { mode: refundMode } : {}) } } : {}) }),
    onSuccess: () => { invalidate(qc); onSaved(`Booking ${b.reference} updated.`); }, onError: (e) => setError(apiError(e)),
  });
  const restore = useMutation({ mutationFn: () => post(`/owner/bookings/${b.id}/restore`), onSuccess: () => { invalidate(qc); onSaved(`Booking ${b.reference} restored.`); }, onError: (e) => { setConfirmRestore(false); setError(apiError(e)); } });
  const go = () => { setAttempted(true); setError(''); if (Object.keys(errs).length) return; save.mutate(); };
  const set = (k: keyof typeof c) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setC({ ...c, [k]: e.target.value });
  const E = (k: string) => (attempted ? errs[k] : undefined);
  return (
    <Modal open onClose={onClose} title={`Edit booking ${b.reference}`} wide>
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <p className="rounded-lg border border-line bg-surface2/50 p-3 text-sm"><b>{b.area_name}</b> at <b>{b.venue_name}</b></p>
        {cancelled && <section aria-label="Cancelled" className="space-y-3 rounded-lg border border-danger/40 bg-danger/10 p-3"><div><h3 className="text-sm font-bold">This booking is cancelled</h3>{b.cancel_reason && <p className="text-sm">Reason: {b.cancel_reason}</p>}</div>
          {started ? <p className="text-sm text-muted">Its slot has already started, so the cancellation cannot be removed.</p> : confirmRestore ? (<div className="space-y-3"><p className="text-sm">The booking is confirmed again on {fmtDate(b.starts_at)}, {fmtTime(b.starts_at, tz)} – {fmtTime(b.ends_at, tz)}, if the slot is still free.{Number(b.refund_amount) > 0 && <> The refund of {money(b.refund_amount)} recorded on it is removed.</>}</p>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" onClick={() => setConfirmRestore(false)} disabled={restore.isPending}>Keep cancelled</Button><Button type="button" loading={restore.isPending} onClick={() => restore.mutate()}>Yes, remove cancellation</Button></div></div>)
            : <Button type="button" variant="ghost" onClick={() => setConfirmRestore(true)}>Remove cancellation</Button>}</section>}
        <section aria-label="Date and slot" className="space-y-3"><h3 className="text-sm font-bold">Date and slot</h3>
          {movable ? (<><Input mandatory label="Date" type="date" min={todayIn(tz)} value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); }} />
            {day.isLoading ? <p className="text-sm text-muted">Loading time slots…</p> : slots.length === 0 ? <p className="text-sm text-muted">No time slots on this day.</p>
              : <div role="listbox" aria-label="Time slots" className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">{slots.map((s) => { const mine = own(s); const on = slot === s.startsAt || (!slot && mine); const ok = s.available || mine;
                return <button key={s.startsAt} type="button" role="option" aria-selected={on} disabled={!ok} onClick={() => setSlot(mine ? null : s.startsAt)} className={`rounded-xl border px-3 py-2 text-left text-sm transition ${on ? 'border-brand bg-brand/10' : 'border-line'} ${!ok ? 'line-through opacity-50' : 'hover:border-brand/50'}`}>{fmtTime(s.startsAt, tz)}{mine && <span className="block text-[10px] text-muted">current</span>}<span className="block text-xs">{s.price != null ? money(s.price) : ''}</span></button>; })}</div>}
            {newSlot && <p className="text-sm">{fmtTime(newSlot.startsAt, tz)} – {fmtTime(newSlot.endsAt, tz)} <span className="ml-2 font-semibold">(changed)</span></p>}</>)
            : <p className="text-sm text-muted">{fmtRange(b.starts_at, b.ends_at, tz)}. Only an upcoming booking can move to another date or slot.</p>}</section>
        <section aria-label="Customer details" className="space-y-3"><h3 className="text-sm font-bold">Customer details</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Input mandatory label="Customer mobile" type="tel" autoComplete="off" value={c.phone} onChange={set('phone')} error={E('phone')} /><Input mandatory label="Customer name" autoComplete="off" value={c.name} onChange={set('name')} error={E('name')} /><Input mandatory label="City" autoComplete="off" value={c.city} onChange={set('city')} error={E('city')} /></div>
          <Textarea label="Note (optional)" rows={2} maxLength={200} value={c.note} onChange={set('note')} placeholder="Add a note for your records" /><p className="-mt-2 text-xs text-muted">Up to 200 characters.</p></section>
        {openGround && <section aria-label="Opponent details" className="space-y-3"><h3 className="text-sm font-bold">Opponent details</h3>
          <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Opponent 1</p><Button type="button" variant="ghost" className="!py-1.5" onClick={() => setC({ ...c, o1Phone: c.phone, o1Name: c.name, o1City: c.city })}>Copy customer details</Button></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Input mandatory label="Opponent 1 mobile" type="tel" autoComplete="off" value={c.o1Phone} onChange={set('o1Phone')} error={E('o1Phone')} /><Input mandatory label="Opponent 1 name" autoComplete="off" value={c.o1Name} onChange={set('o1Name')} error={E('o1Name')} /><Input mandatory label="Opponent 1 city" autoComplete="off" value={c.o1City} onChange={set('o1City')} error={E('o1City')} /></div></div>
          <div className="space-y-2"><p className="text-sm font-semibold">Opponent 2</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Input mandatory label="Opponent 2 mobile" type="tel" autoComplete="off" value={c.o2Phone} onChange={set('o2Phone')} error={E('o2Phone')} /><Input mandatory label="Opponent 2 name" autoComplete="off" value={c.o2Name} onChange={set('o2Name')} error={E('o2Name')} /><Input mandatory label="Opponent 2 city" autoComplete="off" value={c.o2City} onChange={set('o2City')} error={E('o2City')} /></div></div></section>}
        <section aria-label="Amount" className="space-y-3"><h3 className="text-sm font-bold">Amount</h3>
          <div className="grid gap-3 sm:grid-cols-2"><Input mandatory label="Amount (₹)" type="number" min={0} inputMode="decimal" autoComplete="off" value={shownPrice} onChange={(e) => setPrice(e.target.value)} error={E('price')} hint={newSlot && price == null ? 'From your saved pricing for the new slot.' : 'Type a new amount to change the price.'} /></div>
          {!cancelled && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Payment status" value={pay.status} onChange={(e) => setPay({ ...pay, status: e.target.value, ...(e.target.value === 'unpaid' ? { initial: '', mode: '' } : {}) })}><option value="">Keep as it is ({paidNow >= total && total > 0 ? 'Paid' : paidNow > 0 ? 'Part paid' : 'Unpaid'})</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            {pay.status === 'partial' && <Input mandatory label="Initial payment (₹)" type="number" min={0} inputMode="decimal" placeholder="Amount paid now" value={pay.initial} onChange={(e) => setPay({ ...pay, initial: e.target.value })} error={E('initial')} />}
            {(pay.status === 'paid' || pay.status === 'partial') && <Select mandatory label="Mode of payment" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })} error={E('mode')}><option value="" disabled>Select mode</option><option value="online">Online</option><option value="offline">Offline</option></Select>}</div>}</section>
        {cancelled && paidNow > 0 && <section aria-label="Refund" className="space-y-3"><h3 className="text-sm font-bold">Refund · the customer paid {money(paidNow)}</h3>
          <div className="grid gap-3 sm:grid-cols-2"><Input mandatory label="Refund amount (₹)" type="number" min={0} inputMode="decimal" autoComplete="off" value={refund} onChange={(e) => setRefund(e.target.value)} error={E('refund')} hint="0 removes the refund." />
            {Number(refund) > 0 && <Select mandatory label="Mode of refund" value={refundMode} onChange={(e) => setRefundMode(e.target.value)} error={E('refundMode')}><option value="" disabled>Select mode</option><option value="online">Online</option><option value="offline">Offline</option></Select>}</div></section>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button type="button" loading={save.isPending} onClick={go}>Save changes</Button></div>
      </div>
    </Modal>
  );
}

/** JusGo's Delete booking: asks for an optional reason; the slot is free again and the booking can be restored from the cancelled list. */
export function DeleteBookingModal({ b, onClose, onDeleted }: { b: any; onClose(): void; onDeleted(msg: string): void }) {
  const qc = useQueryClient(); const [reason, setReason] = useState(''); const [error, setError] = useState('');
  const remove = useMutation({ mutationFn: () => del(`/owner/bookings/${b.id}`, { reason: reason.trim() || undefined }), onSuccess: () => { invalidate(qc); onDeleted(`Booking ${b.reference} deleted.`); }, onError: (e) => setError(apiError(e)) });
  return (
    <Modal open onClose={onClose} title={`Delete booking ${b.reference}?`}>
      <div className="space-y-3"><p className="text-sm">It leaves your bookings and the slot becomes free again. A deleted booking can be restored while its slot is still free.</p>
        <Textarea label="Reason (optional)" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it deleted?" /><p className="-mt-2 text-xs text-muted">Up to 200 characters.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose} disabled={remove.isPending}>Cancel</Button><Button type="button" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button></div></div>
    </Modal>
  );
}
