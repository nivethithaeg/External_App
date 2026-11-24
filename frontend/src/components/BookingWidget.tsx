import { celebratePayment } from '../lib/paymentCelebration';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCode, apiError, del, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { useVenueRealtime } from '../lib/socket';
import { openCheckout, isPaymentNotCompleted } from '../lib/razorpay';
import { cx, durationLabel, fmtDate, fmtTime, money, todayISO } from '../lib/utils';
import { Button, ErrorBox, Modal, Select, Spinner } from './ui';

export interface AreaInfo { id: string; name: string; surface?: string; slot_minutes: number; min_duration_minutes: number; max_duration_minutes: number; sports: { id: number; name: string }[]; images?: { id: string; url: string }[]; instant_booking?: boolean }
interface Slot { startsAt: string; endsAt: string; price: number | null; available: boolean; reason?: string }
interface Lock { lockId: string; expiresAt: string; startsAt: string; endsAt: string; price: number }

/** The customer's choices are kept for a few minutes while they log in or sign up, then restored when they come back to this venue. */
const DRAFT_KEY = 'kickoff_booking_draft';
interface Draft { venueId: string; areaId: string; sportId: number; date: string; duration: number; startsAt: string; savedAt: number }
const readDraft = (venueId: string): Draft | null => {
  try { const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null; if (!d || d.venueId !== venueId || Date.now() - d.savedAt > 30 * 60_000) return null; return d; } catch { return null; }
};

const REASON: Record<string, string> = { past: 'Passed', booked: 'Booked', held: 'Booked', blocked: 'Closed', unpriced: 'N/A' };

export function BookingWidget({ venueId, venueName, areas, timezone = 'Asia/Kolkata', areaId: wantedArea, onAreaChange, discountPercent = 0, wide = false, startDate, timeFrom, timeTo }: { wide?: boolean; startDate?: string; timeFrom?: string; timeTo?: string; venueId: string; venueName: string; areas: AreaInfo[]; timezone?: string; discountPercent?: number; areaId?: string; onAreaChange?(id: string): void }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const draft = useRef<Draft | null | undefined>(undefined);
  if (draft.current === undefined) { const d = readDraft(venueId); draft.current = d && areas.some((a) => a.id === d.areaId) && d.date >= todayISO() ? d : null; }
  const restoreStart = useRef<string | null>(draft.current?.startsAt ?? null);
  const [areaId, setAreaId] = useState(draft.current?.areaId ?? areas[0]?.id ?? '');
  useEffect(() => { if (wantedArea && areas.some((a) => a.id === wantedArea)) setAreaId(wantedArea); }, [wantedArea]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickArea = (id: string) => { setAreaId(id); onAreaChange?.(id); };
  const area = useMemo(() => areas.find((a) => a.id === areaId) ?? areas[0], [areas, areaId]);
  const [sportId, setSportId] = useState<number>(draft.current?.sportId ?? areas[0]?.sports[0]?.id ?? 0);
  const [date, setDate] = useState(draft.current?.date ?? (startDate && startDate >= todayISO() ? startDate : todayISO()));
  const [allTimes, setAllTimes] = useState(false); // the time filter from home can be switched off here
  const [duration, setDuration] = useState(draft.current?.duration ?? areas[0]?.min_duration_minutes ?? 60);
  // the slots picked: one, or several neighbouring free slots booked together (up to the area's longest booking)
  const [picked, setPicked] = useState<Slot[]>([]);
  const setSelected = (s: Slot | null) => setPicked(s ? [s] : []);
  const selected = useMemo<Slot | null>(() => picked.length === 0 ? null : picked.length === 1 ? picked[0]
    : { ...picked[0], endsAt: picked[picked.length - 1].endsAt, price: picked.some((x) => x.price == null) ? null : Math.round(picked.reduce((n, x) => n + (x.price ?? 0), 0) * 100) / 100 } as Slot, [picked]);
  const pick = (s: Slot) => setPicked((cur) => {
    if (!area || !cur.length) return [s];
    const multi = area.min_duration_minutes === area.slot_minutes; // slots that do not overlap can be joined
    const first = cur[0], last = cur[cur.length - 1]; const i = cur.findIndex((x) => x.startsAt === s.startsAt);
    if (i >= 0) return cur.length === 1 ? [] : i === 0 ? cur.slice(1) : i === cur.length - 1 ? cur.slice(0, -1) : [s];
    const span = (a: Slot, b: Slot) => (new Date(b.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000;
    if (multi && s.startsAt === last.endsAt && span(first, s) <= area.max_duration_minutes) return [...cur, s];
    if (multi && s.endsAt === first.startsAt && span(s, last) <= area.max_duration_minutes) return [s, ...cur];
    return [s];
  });
  const bookMinutes = selected ? Math.round((new Date(selected.endsAt).getTime() - new Date(selected.startsAt).getTime()) / 60000) : 0;
  const [coupon, setCoupon] = useState(() => { try { const c = sessionStorage.getItem('kickoff_coupon') ?? ''; if (c) sessionStorage.removeItem('kickoff_coupon'); return c; } catch { return ''; } }); /* a code picked on the Offers page */ const [couponInfo, setCouponInfo] = useState<{ code: string; discount: number } | null>(null);
  const [couponErr, setCouponErr] = useState('');
  const [lock, setLock] = useState<Lock | null>(null);
  const [busy, setBusy] = useState<'' | 'lock' | 'pay' | 'coupon'>('');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => { // reset dependent selections when the area changes
    if (!area) return;
    setSportId((s) => (area.sports.some((x) => x.id === s) ? s : area.sports[0]?.id ?? 0));
    setDuration(area.min_duration_minutes); // no duration to pick: a booking is the playing area's slot length
    setSelected(null);
  }, [area]);


  const slotsQ = useQuery({
    queryKey: ['slots', areaId, sportId, date, duration], enabled: !!area && !!sportId,
    queryFn: () => get<{ slots: Slot[]; timezone: string; specialPricing?: { label: string; percent: number } | null }>(`/areas/${areaId}/slots`, { date, sportId, duration }), refetchInterval: 45000,
  });
  useVenueRealtime(venueId, () => { qc.invalidateQueries({ queryKey: ['slots', areaId] }); });

  useEffect(() => { setSelected(null); setCouponInfo(null); setError(''); }, [areaId, sportId, date, duration]);
  useEffect(() => { // hold countdown
    if (!lock) return;
    const tick = () => { const s = Math.max(0, Math.round((new Date(lock.expiresAt).getTime() - Date.now()) / 1000)); setSecondsLeft(s); if (s === 0) { setLock(null); setError('Your hold expired. Please choose the slot again.'); } };
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [lock]);

  useEffect(() => { // back from login: re-select the slot the customer had chosen, if it is still free
    const want = restoreStart.current;
    if (!want || !slotsQ.data) return;
    restoreStart.current = null; try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    const slot = slotsQ.data.slots.find((x) => x.startsAt === want);
    if (slot?.available) setSelected(slot); else setError('The slot you chose is no longer available. Please pick another.');
  }, [slotsQ.data]);
  const subtotal = selected?.price ?? 0;
  const venueDiscount = Math.round(subtotal * discountPercent) / 100; // the venue's own discount comes off first; a coupon applies to what is left
  const afterVenue = Math.round((subtotal - venueDiscount) * 100) / 100;
  const [summary, setSummary] = useState(false);
  const [weeks, setWeeks] = useState(1); const [useWallet, setUseWallet] = useState(false);
  const total = Math.max(0, afterVenue - (couponInfo?.discount ?? 0));
  // the two ways to pay beyond a plain one-off booking: repeat every week, use the wallet
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: () => get<{ balance: number }>('/me/wallet'), enabled: user?.role === 'customer' && summary, staleTime: 15000 });
  const weekQs = useQueries({ queries: Array.from({ length: weeks > 1 && selected ? weeks - 1 : 0 }, (_, i) => {
    const d = new Date(new Date(selected!.startsAt).getTime() + (i + 1) * 7 * 86400000);
    const day = d.toLocaleDateString('en-CA', { timeZone: timezone });
    return { queryKey: ['series-week', areaId, sportId, duration, day], queryFn: () => get<{ slots: Slot[] }>(`/areas/${areaId}/slots`, { date: day, sportId, duration }), enabled: summary, staleTime: 15000, startsAt: d.toISOString() };
  }) });
  const weekRows = selected && weeks > 1 ? [{ startsAt: selected.startsAt, price: selected.price, ok: true, loading: false }, ...weekQs.map((q, i) => {
    const at = new Date(new Date(selected.startsAt).getTime() + (i + 1) * 7 * 86400000).getTime();
    const slot = q.data?.slots.find((x) => new Date(x.startsAt).getTime() === at);
    return { startsAt: new Date(at).toISOString(), price: slot?.price ?? null, ok: !!slot && slot.available && slot.price != null, loading: q.isLoading };
  })] : [];
  const seriesLoading = weekRows.some((w) => w.loading); const seriesBad = weekRows.filter((w) => !w.ok && !w.loading).length;
  const disc = (n: number) => Math.round((n - Math.round(n * discountPercent) / 100) * 100) / 100;
  const seriesTotal = Math.round(weekRows.reduce((n, w) => n + (w.price != null ? disc(w.price) : 0), 0) * 100) / 100;
  const grand = weeks > 1 ? seriesTotal : total;
  const walletApply = useWallet ? Math.min(walletQ.data?.balance ?? 0, grand) : 0;
  const cardDue = Math.round((grand - walletApply) * 100) / 100;
  const requireLogin = () => {
    try { if (selected) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ venueId, areaId, sportId, date, duration, startsAt: selected.startsAt, savedAt: Date.now() } satisfies Draft)); } catch { /* the customer simply picks the slot again */ }
    nav('/login', { state: { from: loc.pathname + loc.search } });
  };

  const applyCoupon = async () => {
    if (!user) return requireLogin();
    setCouponErr(''); setBusy('coupon');
    try { const r = await post('/coupons/validate', { code: coupon, venueId, amount: afterVenue }); setCouponInfo({ code: r.code, discount: r.discount }); toast(`Coupon applied: −${money(r.discount)}`); }
    catch (e) { setCouponInfo(null); setCouponErr(apiError(e)); } finally { setBusy(''); }
  };

  const releaseHold = async (id: string) => { try { await del(`/slots/lock/${id}`); } catch { /* hold will expire on its own */ } };

  const book = async () => {
    if (!selected || !area) return;
    if (!user) return requireLogin();
    if (user.role !== 'customer') return setError('Please use a customer account to book.');
    setError('');
    let held: Lock | null = null; let bookingId: string | null = null;
    try {
      setBusy('lock');
      type Resp = { bookingId: string; total: number; walletUsed?: number; cardDue?: number; order: { id: string; amount: number; keyId: string } | null };
      let b: Resp;
      if (weeks > 1) { // every week is checked and held together by the server, with no separate hold step
        b = await post<Resp>('/bookings/recurring', { areaId: area.id, sportId, startsAt: selected.startsAt, durationMinutes: bookMinutes, weeks, useWallet: useWallet || undefined });
      } else {
        held = await post<Lock>('/slots/lock', { areaId: area.id, sportId, startsAt: selected.startsAt, durationMinutes: bookMinutes });
        setLock(held);
        b = await post<Resp>('/bookings', { lockId: held.lockId, couponCode: couponInfo?.code, useWallet: useWallet || undefined });
        setLock(null);
      }
      bookingId = b.bookingId;
      if (b.order) {
        setBusy('pay');
        const res = await openCheckout({ keyId: b.order.keyId, orderId: b.order.id, amount: b.order.amount, name: 'KickOff', description: `${venueName} · ${area.name}`, prefill: { name: user.fullName, email: user.email, contact: user.phone ?? undefined } });
        await post(`/bookings/${b.bookingId}/verify-payment`, res);
      }
      if (b.order || (b.walletUsed ?? 0) > 0) celebratePayment(); // only now, after the server has confirmed the payment
      toast(weeks > 1 ? `Booking confirmed for ${weeks} weeks! 🎉` : 'Booking confirmed! 🎉');
      qc.invalidateQueries({ queryKey: ['bookings'] }); qc.invalidateQueries({ queryKey: ['wallet'] });
      nav(`/bookings/${b.bookingId}`);
    } catch (e) {
      const code = apiCode(e);
      if (isPaymentNotCompleted(e) && bookingId) { // not paid: free the slot straight away instead of holding it
        try { await post(`/bookings/${bookingId}/payment-failed`); } catch { /* the hold simply runs out */ }
        qc.invalidateQueries({ queryKey: ['bookings'] }); qc.invalidateQueries({ queryKey: ['slots', areaId] });
        setLock(null); setSelected(null); setBusy('');
        setError(e.failed ? `Payment failed: ${e.message}. Nothing was charged and the slot has been released. Pick it again to retry.` : 'Payment was not completed. The slot has been released. Pick it again when you are ready.');
        return;
      }
      if (held && code !== 'lock_expired') await releaseHold(held.lockId);
      setLock(null);
      const gone = (e as any)?.response?.data?.error?.details?.unavailable as string[] | undefined;
      setError(code === 'slot_unavailable' ? 'Sorry, someone just took that slot. Please pick another.' : code === 'series_unavailable' && gone ? `${apiError(e)} Not available: ${gone.map((d) => fmtDate(d, timezone)).join(', ')}. Choose fewer weeks or another time.` : apiError(e));
      qc.invalidateQueries({ queryKey: ['slots', areaId] });
      setSelected(null);
    } finally { setBusy(''); }
  };

  if (!area) return <div className="card p-5 text-sm text-muted">This venue has no bookable areas yet.</div>;
  const allSlots = slotsQ.data?.slots ?? [];
  const special = slotsQ.data?.specialPricing ?? null;
  const sportName = area?.sports.find((x) => x.id === sportId)?.name;
  // Only what a customer can still act on: slots that have already started, and ones with no price set, are not shown. Booked and held ones stay visible as taken.
  // the time chosen on home (From / To): only slots that start inside it, unless the customer asks for every time
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
  const windowOn = !allTimes && !!(timeFrom || timeTo);
  const to12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const slots = allSlots.filter((s) => s.reason !== 'past' && s.reason !== 'unpriced' && (!windowOn || ((!timeFrom || hhmm(s.startsAt) >= timeFrom) && (!timeTo || hhmm(s.startsAt) < timeTo))));
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0'), ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className={wide ? 'space-y-5' : 'card space-y-4 p-5'} aria-label="Book a slot">
      <h2 className="text-3xl font-bold">Book a slot</h2>
      <div className={wide ? 'grid grid-cols-2 gap-3 lg:max-w-3xl' : 'grid grid-cols-2 gap-3'}>
        {area?.instant_booking === false && <p role="status" className="col-span-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm"><b>Booking through the venue.</b> This playing area does not take online payments. Please contact {venueName} to book it.</p>}
        <div className="col-span-2"><Select label="Playing area" value={areaId} onChange={(e) => pickArea(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.surface ? ` · ${a.surface}` : ''}{a.sports.length ? ` (${a.sports.map((x) => x.name).join(', ')})` : ''}</option>)}</Select></div>
        {area && area.sports.length > 0 && <p className="col-span-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">Sports here: {area.sports.map((x) => <span key={x.id} className="chip">{x.name}</span>)}</p>}
        {(area?.images?.length ?? 0) > 0 && <ul className="col-span-2 flex gap-2 overflow-x-auto pb-1" aria-label={`Photos of ${area!.name}`}>{area!.images!.map((i, n) => <li key={i.id} className="shrink-0"><a href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt={`${area!.name} photo ${n + 1}`} loading="lazy" className="h-16 w-24 rounded-lg object-cover" /></a></li>)}</ul>}
        <div className="col-span-2"><Select label="Sport" value={sportId} onChange={(e) => setSportId(+e.target.value)}>{area.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
        <div className="col-span-2"><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="bk-date">Date</label>
          <input id="bk-date" type="date" className="field" min={todayISO()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      </div>

      <div>
        {(timeFrom || timeTo) && <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted" role="status">{windowOn ? `Showing slots from ${timeFrom ? to12(timeFrom) : 'opening'} to ${timeTo ? to12(timeTo) : 'closing'}.` : 'Showing every time of the day.'}<button type="button" className="font-semibold text-[rgb(var(--brand-text))] underline" onClick={() => setAllTimes(!allTimes)}>{windowOn ? 'Show all times' : 'Only my time'}</button></p>}
        <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>Available slots</span><span className="flex gap-3"><i className="not-italic">⬜ open</i><i className="not-italic opacity-60">▫️ taken</i></span></div>
        {special && <p role="note" className="rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-sm"><b>{special.label}</b>: prices on this date are {Math.abs(special.percent)}% {special.percent > 0 ? 'higher' : 'lower'} than usual.</p>}
        {slotsQ.isLoading ? <div className="flex justify-center py-8 text-muted"><Spinner /></div> : slotsQ.isError ? <ErrorBox error={slotsQ.error} retry={() => slotsQ.refetch()} /> : slots.length === 0 ? (
          windowOn && allSlots.some((x) => x.available) ? (
            <div role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-center text-sm">
              <b className="block">No free slot from {timeFrom ? to12(timeFrom) : 'opening'} to {timeTo ? to12(timeTo) : 'closing'} on {fmtDate(`${date}T12:00:00Z`)}.</b>
              <span className="text-muted">Other times are free on this day. </span><button type="button" className="font-semibold text-[rgb(var(--brand-text))] underline" onClick={() => setAllTimes(true)}>Show all times</button><span className="text-muted">, or pick another date.</span></div>)
          : <p className="rounded-xl bg-surface2 p-4 text-center text-sm text-muted">{windowOn && allSlots.length > 0 ? `No free slot from ${timeFrom ? to12(timeFrom) : 'opening'} to ${timeTo ? to12(timeTo) : 'closing'} on ${fmtDate(`${date}T12:00:00Z`)}, and the rest of the day is booked too. Try another date.` : allSlots.length === 0 ? `Closed on ${fmtDate(`${date}T12:00:00Z`)}. Try another date.` : allSlots.some((s) => s.reason === 'unpriced') ? `${sportName ? sportName + ' is' : 'This sport is'} not open for booking on ${fmtDate(`${date}T12:00:00Z`)} yet, because the venue has not set a price for it. Try another sport or date.` : `No more slots left on ${fmtDate(`${date}T12:00:00Z`)}. Try another date.`}</p>
        ) : (
          <div className={wide ? 'grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'} role="listbox" aria-label="Time slots">
            {slots.map((s) => (
              <button key={s.startsAt} role="option" aria-selected={picked.some((x) => x.startsAt === s.startsAt)} disabled={!s.available} onClick={() => { pick(s); setError(''); }}
                className={cx('rounded-xl border px-2 py-2 text-left text-sm transition duration-150 enabled:hover:-translate-y-0.5 enabled:active:scale-95', picked.some((x) => x.startsAt === s.startsAt) ? 'scale-[1.03] border-brand bg-brand text-brand-ink shadow-[0_6px_16px_-8px_rgb(var(--brand)/.8)]' : s.available ? 'border-line hover:border-brand' : 'cursor-not-allowed border-line/50 bg-surface2/40 text-muted line-through opacity-60')}>
                <div className="font-semibold">{fmtTime(s.startsAt, timezone)}</div>
                <div className="text-xs">{s.available ? (discountPercent > 0 && s.price != null ? <><s className="opacity-60">{money(s.price)}</s> {money(Math.round(s.price * (100 - discountPercent)) / 100)}</> : money(s.price)) : <span className="no-underline">{REASON[s.reason ?? ''] ?? 'Taken'}</span>}</div>
              </button>))}
          </div>)}
        {area && area.min_duration_minutes === area.slot_minutes && area.max_duration_minutes > area.slot_minutes && slots.length > 1 && (
          <p className="mt-2 text-xs text-muted" role="status">{picked.length > 1 ? `${picked.length} slots picked · ${durationLabel(bookMinutes)}. ` : ''}To book more than one slot, tap the free slots next to it (up to {durationLabel(area.max_duration_minutes)}).</p>)}
      </div>

      {selected && (
        <div className="animate-rise space-y-3 rounded-xl border border-line bg-surface2/50 p-4">
          <div className="flex justify-between text-sm"><span className="text-muted">{fmtDate(selected.startsAt, timezone)}</span><span className="font-semibold">{fmtTime(selected.startsAt, timezone)} – {fmtTime(selected.endsAt, timezone)}</span></div>
          <div className="flex gap-2"><input className="field !py-2 uppercase" placeholder="Coupon code" aria-label="Coupon code" value={coupon} onChange={(e) => { setCoupon(e.target.value); setCouponInfo(null); setCouponErr(''); }} />
            <Button variant="ghost" onClick={applyCoupon} loading={busy === 'coupon'} disabled={coupon.trim().length < 2}>Apply</Button></div>
          {couponErr && <p role="alert" className="text-xs text-danger">{couponErr}</p>}
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(subtotal)}</dd></div>
            {venueDiscount > 0 && <div className="flex justify-between text-ok"><dt>Venue discount ({discountPercent}% off)</dt><dd>−{money(venueDiscount)}</dd></div>}
            {couponInfo && <div className="flex justify-between text-ok"><dt>Discount ({couponInfo.code})</dt><dd>−{money(couponInfo.discount)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><dt>Total</dt><dd className="font-display text-2xl text-[rgb(var(--brand-text))]">{money(total)}</dd></div>
          </dl>
        </div>
      )}
      {lock && <p className="rounded-xl bg-warn/10 px-3 py-2 text-center text-sm text-warn" role="timer">Slot held for you: {mm}:{ss}</p>}
      {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <Button className="w-full !py-3 text-base" disabled={!selected || area?.instant_booking === false} loading={busy === 'lock' || busy === 'pay'} onClick={() => (user ? setSummary(true) : book())}>
        {!user ? 'Log in to book' : busy === 'pay' ? 'Complete payment…' : total === 0 && selected ? 'Review free booking' : `Review & pay ${selected ? money(total) : ''}`}
      </Button>
      <Modal open={summary && !!selected && !!area} onClose={() => setSummary(false)} title="Confirm your booking">
        {selected && area && (<div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface2/50 p-4 text-sm">
            <p className="font-display text-2xl font-bold">{venueName}</p>
            <p className="text-muted">{area.name}{sportName ? ` · ${sportName}` : ''}</p>
            <p className="mt-2 font-semibold">{fmtDate(selected.startsAt, timezone)}</p>
            <p>{fmtTime(selected.startsAt, timezone)} – {fmtTime(selected.endsAt, timezone)} <span className="text-muted">· {durationLabel(bookMinutes)}</span></p></div>

          <fieldset className="space-y-3 rounded-xl border border-line p-3 text-sm"><legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Options</legend>
            <label className="flex items-center justify-between gap-3"><span><b>Repeat weekly</b><span className="block text-xs text-muted">Same slot every week, paid in one go. Each week can be cancelled on its own.</span></span>
              <select aria-label="Repeat weekly" className="field !w-auto" value={weeks} onChange={(e) => setWeeks(+e.target.value)}><option value={1}>Just this once</option>{[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} weeks</option>)}</select></label>
            {(walletQ.data?.balance ?? 0) > 0 && <label className="flex items-center justify-between gap-3"><span><b>Use my wallet balance</b><span className="block text-xs text-muted">{money(walletQ.data!.balance)} available. The card pays only what is left.</span></span>
              <input type="checkbox" aria-label="Use my wallet balance" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} /></label>}
          </fieldset>

          {weeks > 1 && (<div aria-label="Weekly dates"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your {weeks} games</p>
            <ul className="divide-y divide-line rounded-xl border border-line text-sm">{weekRows.map((w, i) => (
              <li key={w.startsAt} className="flex items-center justify-between gap-3 px-3 py-2"><span>{i + 1}. {fmtDate(w.startsAt, timezone)}</span>
                {w.loading ? <span className="text-muted">Checking…</span> : w.ok ? <b>{money(disc(w.price as number))}</b> : <span className="font-semibold text-danger">Not available</span>}</li>))}</ul>
            {seriesBad > 0 && <p role="alert" className="mt-2 rounded-xl bg-danger/10 p-2 text-xs text-danger">{seriesBad === 1 ? 'One date is' : `${seriesBad} dates are`} not available. Choose fewer weeks or another time, because a weekly booking needs every date.</p>}
            {couponInfo && <p className="mt-2 text-xs text-muted">Coupons are for single bookings and are not used on a weekly booking.</p>}</div>)}


          <dl className="space-y-1 text-sm" aria-label="Price breakdown">
            {weeks > 1 ? <div className="flex justify-between"><dt className="text-muted">{weeks} weeks{venueDiscount > 0 ? ` (venue discount ${discountPercent}% included)` : ''}</dt><dd>{money(seriesTotal)}</dd></div> : (<>
              <div className="flex justify-between"><dt className="text-muted">Price</dt><dd>{money(subtotal)}</dd></div>
              {venueDiscount > 0 && <div className="flex justify-between text-ok"><dt>Venue discount ({discountPercent}% off)</dt><dd>−{money(venueDiscount)}</dd></div>}
              {couponInfo && <div className="flex justify-between text-ok"><dt>Coupon ({couponInfo.code})</dt><dd>−{money(couponInfo.discount)}</dd></div>}</>)}
            {walletApply > 0 && <div className="flex justify-between text-ok"><dt>From your wallet</dt><dd>−{money(walletApply)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><dt>Total to pay</dt><dd className="font-display text-2xl text-[rgb(var(--brand-text))]">{money(cardDue)}</dd></div></dl>
          <p className="text-xs text-muted">The slot is held for you while you pay. Free cancellation up to the venue's cancellation window; payments are secured by Razorpay.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSummary(false)}>Back</Button>
            <Button disabled={weeks > 1 && (seriesLoading || seriesBad > 0)} onClick={() => { setSummary(false); book(); }}>{cardDue === 0 ? 'Confirm booking' : `Confirm and pay ${money(cardDue)}`}</Button></div>
        </div>)}
      </Modal>
      <p className="text-center text-xs text-muted">Free cancellation up to the venue's cancellation window. Payments secured by Razorpay.</p>
    </div>
  );
}
