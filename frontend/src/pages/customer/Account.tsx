import { useMemo, useState, type FormEvent } from 'react';
import { NotificationPreferences } from '../../components/NotificationPreferences';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCode, apiError, fieldErrors, get, post, put, setToken, uploadAvatar } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { celebratePayment } from '../../lib/paymentCelebration';
import { useToast } from '../../lib/toast';
import { openCheckout, isPaymentNotCompleted } from '../../lib/razorpay';
import { downloadReceiptPdf } from '../../lib/receiptPdf';
import { Badge, Button, Card, Empty, Input, Loading, PasswordInput, Modal, PageHeader, QueryBoundary, Select, SkeletonCards, StarInput, Stars, Tabs, Textarea, ErrorBox } from '../../components/ui';
import { VenueCard } from '../../components/VenueCard';
import { VerifyRow, useVerificationOptions } from '../../components/VerifyRow';
import { MapView, directionsUrl } from '../../lib/maps';
import { fmtDate, fmtDateTime, fmtRange, fmtTime, money, titleCase, todayISO } from '../../lib/utils';
import { isIndianMobile, MOBILE_MESSAGE } from '../../lib/phone';

type BookingTab = 'all' | 'upcoming' | 'completed' | 'cancelled';
const TAB_QUERY: Record<BookingTab, Record<string, string>> = { all: {}, upcoming: { when: 'upcoming' }, completed: { tab: 'completed' }, cancelled: { tab: 'cancelled' } };

export function BookingsPage() {
  const [tab, setTab] = useState<BookingTab>('upcoming');
  const [f, setF] = useState({ from: '', to: '', venueId: '', sportId: '', status: '', payment: '' });
  const [pageNo, setPageNo] = useState(1);
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string }[] }>('/sports'), staleTime: Infinity });
  const everything = useQuery({ queryKey: ['bookings', 'venue-options'], queryFn: () => get<{ bookings: any[] }>('/bookings', { limit: 50 }) });
  const venues = useMemo(() => { const m = new Map<string, string>(); everything.data?.bookings.forEach((b) => m.set(b.venue_id, b.venue_name)); return [...m.entries()]; }, [everything.data]);
  const params = { ...TAB_QUERY[tab], ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), limit: 10, page: pageNo };
  const q = useQuery({ queryKey: ['bookings', tab, f, pageNo], queryFn: () => get<{ bookings: any[] }>('/bookings', params), placeholderData: (p) => p });
  const setFilter = (k: string, v: string) => { setF({ ...f, [k]: v }); setPageNo(1); };
  const any = Object.values(f).some(Boolean);
  const canCancel = (b: any) => ['confirmed', 'pending'].includes(b.status) && new Date(b.ends_at) > new Date();
  return (
    <div>
      <PageHeader title="My bookings" subtitle="Your games, passes, receipts and refunds" />
      <div className="mb-5 max-w-xl"><Tabs tabs={[{ id: 'all', label: 'All' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'completed', label: 'Completed' }, { id: 'cancelled', label: 'Cancelled' }]} value={tab} onChange={(t) => { setTab(t); setPageNo(1); }} /></div>
      <Card className="mb-5 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Filters">
        <Input label="From" type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} /><Input label="To" type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} />
        <Select label="Venue" value={f.venueId} onChange={(e) => setFilter('venueId', e.target.value)}><option value="">All venues</option>{venues.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
        <Select label="Sport" value={f.sportId} onChange={(e) => setFilter('sportId', e.target.value)}><option value="">All sports</option>{sports.data?.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select label="Booking status" value={f.status} onChange={(e) => setFilter('status', e.target.value)}><option value="">Any</option>{['pending', 'confirmed', 'completed', 'cancelled', 'expired'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
        <Select label="Payment" value={f.payment} onChange={(e) => setFilter('payment', e.target.value)}><option value="">Any</option>{['captured', 'created', 'failed', 'refunded'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
        {any && <button className="text-xs text-muted underline sm:col-span-3 lg:col-span-6" onClick={() => { setF({ from: '', to: '', venueId: '', sportId: '', status: '', payment: '' }); setPageNo(1); }}>Clear filters</button>}
      </Card>
      <QueryBoundary q={q} empty={(d) => d.bookings.length === 0 && (pageNo === 1) && <Empty title={any ? 'No bookings match these filters' : tab === 'upcoming' ? 'No upcoming games' : tab === 'completed' ? 'No completed games yet' : tab === 'cancelled' ? 'No cancelled bookings' : 'No bookings yet'} icon="📅" hint={any ? 'Try clearing a filter.' : 'Find a turf and book your first slot.'} action={<Link to="/venues" className="btn-primary">Browse turfs</Link>} />}>
        {(d) => (<>
          <div className="space-y-3">{d.bookings.map((b) => (
            <Card key={b.id} className="animate-rise space-y-3 p-4">
              <Link to={`/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-2xl font-bold">{b.venue_name}</h3><Badge status={b.status} />{b.payment_status && <Badge status={b.payment_status}>Payment {titleCase(b.payment_status)}</Badge>}</div>
                  <p className="text-sm text-muted">{b.area_name} · {b.sport} · {fmtRange(b.starts_at, b.ends_at, b.timezone)} · {Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000)} min</p><p className="text-xs text-muted">Booking {b.reference}</p></div>
                <div className="text-right"><div className="font-display text-2xl font-bold">{money(b.total)}</div>{b.refund_status && <Badge status={b.refund_status}>Refund {b.refund_status}</Badge>}</div>
              </Link>
              <div className="flex flex-wrap gap-2 border-t border-line pt-3 text-sm">
                <Link className="btn-ghost !py-1.5" to={`/bookings/${b.id}`}>Details</Link>
                {['confirmed', 'completed'].includes(b.status) && <Link className="btn-ghost !py-1.5" to={`/bookings/${b.id}/receipt`}>Receipt</Link>}
                {canCancel(b) && <Link className="btn-ghost !py-1.5" to={`/bookings/${b.id}`}>Cancel</Link>}
                {b.refund_status && <Link className="btn-ghost !py-1.5" to={`/bookings/${b.id}`}>Refund status</Link>}
                <Link className="btn-ghost !py-1.5" to={`/venues/${b.venue_id}`}>Book again</Link>
                {b.lat != null && <a className="btn-ghost !py-1.5" href={directionsUrl(+b.lat, +b.lng)} target="_blank" rel="noreferrer">Directions</a>}
              </div>
            </Card>))}</div>
          <div className="mt-6 flex items-center justify-center gap-3"><Button variant="ghost" disabled={pageNo <= 1} onClick={() => setPageNo(pageNo - 1)}>← Prev</Button><span className="text-sm text-muted">Page {pageNo}</span><Button variant="ghost" disabled={d.bookings.length < 10} onClick={() => setPageNo(pageNo + 1)}>Next →</Button></div></>)}
      </QueryBoundary>
    </div>
  );
}

/** Move a paid booking to another time at the same venue, once, and only to a slot with the same price (so nothing is charged or refunded). */
function RescheduleDialog({ b, open, onClose, onDone }: { b: any; open: boolean; onClose(): void; onDone(): void }) {
  const { toast } = useToast();
  const minutes = Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000);
  const tz = b.timezone ?? 'Asia/Kolkata';
  const [date, setDate] = useState(() => new Date(b.starts_at).toLocaleDateString('en-CA', { timeZone: tz }));
  const [pick, setPick] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['reschedule-slots', b.area_id, date, minutes], enabled: open && !!date, queryFn: () => get<{ slots: { startsAt: string; endsAt: string; price: number | null; available: boolean }[] }>(`/areas/${b.area_id}/slots`, { date, sportId: b.sport_id, duration: minutes }) });
  const same = (q.data?.slots ?? []).filter((x) => x.available && x.price !== null && Math.round(x.price * 100) === Math.round(Number(b.subtotal) * 100) && new Date(x.startsAt).getTime() !== new Date(b.starts_at).getTime());
  const hidden = (q.data?.slots ?? []).filter((x) => x.available && x.price !== null && Math.round(x.price * 100) !== Math.round(Number(b.subtotal) * 100)).length;
  const go = useMutation({ mutationFn: () => post(`/bookings/${b.id}/reschedule`, { startsAt: pick }), onSuccess: () => { toast('Booking rescheduled. Your booking reference is unchanged.'); setPick(null); onDone(); onClose(); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <Modal open={open} onClose={onClose} title="Reschedule your booking">
      <div className="space-y-4 text-sm">
        <p className="rounded-xl bg-surface2 p-3"><b>Now:</b> {fmtRange(b.starts_at, b.ends_at, tz)}<br /><span className="text-muted">{b.venue_name} · {b.area_name} · {money(b.subtotal)} for this slot</span></p>
        <div><label htmlFor="rs-date" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">New date</label>
          <input id="rs-date" type="date" className="field" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setPick(null); }} /></div>
        {q.isLoading ? <Loading /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : same.length === 0 ? (
          <p className="rounded-xl bg-warn/10 p-3 text-warn">No free slots at the same price on {fmtDate(`${date}T12:00:00Z`)}. Try another date.</p>
        ) : (
          <div role="listbox" aria-label="Available times" className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1">
            {same.map((x) => <button key={x.startsAt} role="option" aria-selected={pick === x.startsAt} onClick={() => setPick(x.startsAt)} className={`rounded-xl border px-2 py-2 text-left transition ${pick === x.startsAt ? 'border-brand bg-brand text-brand-ink' : 'border-line hover:border-brand'}`}><div className="font-semibold">{fmtTime(x.startsAt, tz)}</div><div className="text-xs">{fmtTime(x.endsAt, tz)}</div></button>)}</div>)}
        {hidden > 0 && !q.isLoading && <p className="text-xs text-muted">{hidden} free slot{hidden === 1 ? ' is' : 's are'} hidden because {hidden === 1 ? 'it costs' : 'they cost'} a different price. To use one, cancel and book again.</p>}
        <p className="text-xs text-muted">You can reschedule once, up to {b.cancellation_hours} hours before the game. The same booking and reference stay valid and nothing is charged or refunded.</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Keep my slot</Button><Button disabled={!pick} loading={go.isPending} onClick={() => go.mutate()}>Confirm new time</Button></div>
      </div>
    </Modal>
  );
}

export function BookingDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['booking', id], queryFn: () => get<{ booking: any; refunds: any[] }>(`/bookings/${id}`) });
  const [moveOpen, setMoveOpen] = useState(false);
  const [refundTo, setRefundTo] = useState<'original' | 'wallet'>('original'); const [scope, setScope] = useState<'one' | 'later'>('one');
  const [cancelOpen, setCancelOpen] = useState(false); const [reason, setReason] = useState(''); const [dlBusy, setDlBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false); const [rating, setRating] = useState(5); const [comment, setComment] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['booking', id] }); qc.invalidateQueries({ queryKey: ['bookings'] }); };

  const cancel = useMutation({ mutationFn: () => post(scope === 'later' ? `/bookings/${id}/cancel-series` : `/bookings/${id}/cancel`, { reason: reason || undefined, refundTo }),
    onSuccess: (r: any) => { setCancelOpen(false); qc.invalidateQueries({ queryKey: ['wallet'] }); refresh();
      const n = r.cancelled ? `${r.cancelled} game${r.cancelled === 1 ? '' : 's'} cancelled. ` : 'Cancelled. ';
      toast(r.refundAmount > 0 ? `${n}${r.toWallet > 0 ? `${money(r.toWallet)} went to your wallet${r.refundAmount - r.toWallet > 0 ? `, ${money(r.refundAmount - r.toWallet)} back to your payment method` : ''}.` : `Refund of ${money(r.refundAmount)} initiated.`}` : (r.cancelled ? n.trim() : 'Booking cancelled.')); }, onError: (e) => toast(apiError(e), 'error') });
  const review = useMutation({ mutationFn: () => post('/me/reviews', { bookingId: id, rating, comment: comment || undefined }),
    onSuccess: () => { setReviewOpen(false); refresh(); toast('Thanks for your review!'); }, onError: (e) => toast(apiError(e), 'error') });
  const resume = useMutation({
    mutationFn: async () => {
      const { order } = await get<{ order: { id: string; amount: number; keyId: string } }>(`/bookings/${id}/order`);
      const res = await openCheckout({ keyId: order.keyId, orderId: order.id, amount: order.amount, name: 'KickOff', description: 'Turf booking', prefill: { name: user?.fullName, email: user?.email } });
      await post(`/bookings/${id}/verify-payment`, res);
      celebratePayment(); // the server has verified the payment
    },
    onSuccess: () => refresh(),
    onError: async (e) => {
      if (isPaymentNotCompleted(e)) { // unpaid: release the slot now
        try { await post(`/bookings/${id}/payment-failed`); } catch { /* the hold runs out */ }
        toast(e.failed ? `Payment failed: ${e.message}. The slot has been released.` : 'Payment was not completed. The slot has been released.', 'error'); refresh(); return;
      }
      toast(apiError(e), 'error'); if (apiCode(e) === 'not_payable') refresh();
    },
  });

  return (
    <QueryBoundary q={q}>{({ booking: b, refunds }) => {
      const upcoming = ['confirmed', 'pending'].includes(b.status) && new Date(b.ends_at) > new Date();
      const canMove = b.status === 'confirmed' && b.source !== 'offline' && (b.reschedule_count ?? 0) < 1 && new Date(b.starts_at).getTime() - Date.now() > (b.cancellation_hours ?? 0) * 3600000;
      const hoursLeft = (new Date(b.starts_at).getTime() - Date.now()) / 3600000;
      const refundable = hoursLeft >= b.cancellation_hours;
      return (
        <div className="mx-auto max-w-4xl">
          <button onClick={() => nav(-1)} className="mb-4 text-sm text-muted hover:text-ink">← Back</button>
          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            <div className="space-y-5">
              <Card className="space-y-4 p-6">
                <div className="flex flex-wrap items-center gap-3"><h1 className="text-4xl font-extrabold">{b.venue_name}</h1><Badge status={b.status} /></div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[['When', fmtRange(b.starts_at, b.ends_at, b.timezone)], ['Area', `${b.area_name} · ${b.sport ?? ''}`], ['Booking reference', b.reference], ['Where', `${b.address}, ${b.city}`]].map(([k, v]) => <div key={k}><dt className="text-xs uppercase tracking-wide text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
                </dl>
                <div className="space-y-1 border-t border-line pt-4 text-sm"><div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(b.subtotal)}</span></div>
                  {b.discount > 0 && <div className="flex justify-between text-ok"><span>Discount</span><span>−{money(b.discount)}</span></div>}
                  <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{money(b.total)}</span></div>
                  <div className="flex justify-between text-xs text-muted"><span>Payment</span><span>{b.payment_status ? titleCase(b.payment_status) : 'Not required'}</span></div></div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {b.status === 'pending' && <Button onClick={() => resume.mutate()} loading={resume.isPending}>Complete payment</Button>}
                  {b.series_id && <span className="chip">🔁 Weekly game {Number(b.series_index) + 1} of {b.series_count}</span>}
                  {(b.reschedule_count ?? 0) > 0 && <span className="chip">↻ Rescheduled</span>}
                  {canMove && <Button variant="ghost" onClick={() => setMoveOpen(true)}>Reschedule</Button>}
                  {upcoming && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel booking</Button>}
                  {b.status === 'completed' || (b.status === 'confirmed' && new Date(b.ends_at) <= new Date()) ? (b.reviewed ? <span className="chip">✓ Reviewed</span> : <Button onClick={() => setReviewOpen(true)}>Write a review</Button>) : null}
                  {['confirmed', 'completed'].includes(b.status) && <Button variant="ghost" loading={dlBusy} onClick={async () => { setDlBusy(true); try { await downloadReceiptPdf(b, refunds, user?.fullName ?? ''); } catch (e) { toast(apiError(e), 'error'); } finally { setDlBusy(false); } }}>Download receipt</Button>}<Link className="btn-ghost" to={`/venues/${b.venue_id}`}>Book again</Link><Link className="btn-ghost" to={`/support?booking=${b.id}`}>Get help</Link><a className="btn-ghost" href={directionsUrl(b.lat, b.lng)} target="_blank" rel="noreferrer">Directions ↗</a>
                </div>
              </Card>

              {refunds.length > 0 && (
                <Card className="p-6"><h2 className="mb-3 text-2xl font-bold">Refund tracking</h2>
                  <ol className="space-y-3">{refunds.map((r) => (
                    <li key={r.id} className="flex items-start gap-3"><span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${r.status === 'processed' ? 'bg-ok' : r.status === 'failed' ? 'bg-danger' : 'bg-warn'}`} />
                      <div className="text-sm"><div className="flex items-center gap-2 font-semibold">{money(r.amount)} <Badge status={r.status} /></div><p className="text-xs text-muted">Requested {fmtDateTime(r.created_at)}{r.processed_at ? ` · Processed ${fmtDateTime(r.processed_at)}` : ''}</p>
                        {r.status !== 'processed' && <p className="text-xs text-muted">{r.status === 'failed' ? 'Our team is retrying this refund. You do not need to do anything.' : 'Refunds usually reach your account in 5–7 working days.'}</p>}</div></li>))}</ol></Card>)}
              <MapView lat={b.lat} lng={b.lng} name={b.venue_name} className="h-48" />
            </div>
            <aside>{b.status === 'confirmed' ? (
              <Card className="space-y-2 p-5 text-center"><h2 className="text-2xl font-bold">Your booking reference</h2><p className="font-display text-4xl tracking-wider text-[rgb(var(--brand-text))]" aria-label={`Booking reference ${b.reference}`}>{b.reference}</p><p className="text-xs text-muted">Show this reference at the venue gate.</p></Card>
            ) : <Card className="p-5 text-center text-sm text-muted">{b.status === 'pending' ? 'Your booking reference is confirmed once payment is complete.' : 'The booking reference is shown for confirmed bookings.'}</Card>}</aside>
          </div>

          {canMove && <RescheduleDialog b={b} open={moveOpen} onClose={() => setMoveOpen(false)} onDone={refresh} />}
          <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this booking?">
            <p className="mb-3 text-sm text-muted">{b.status === 'pending' ? 'This booking has not been paid yet and will simply be released.' : refundable ? `You'll get a full refund of ${money(b.total)}.` : `This is within ${b.cancellation_hours}h of start time, so it is not eligible for a refund.`}</p>
            {b.series_id && b.status === 'confirmed' && (b.series_count ?? 0) > 1 && (
              <div role="radiogroup" aria-label="Which games" className="mb-3 space-y-1.5 text-sm">
                {([['one', 'Only this game'], ['later', 'This game and every later one in the series']] as const).map(([v, l]) => <label key={v} className="flex cursor-pointer items-center gap-2"><input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} />{l}</label>)}</div>)}
            {b.status === 'confirmed' && refundable && Number(b.total) - Number(b.wallet_amount ?? 0) > 0 && (
              <div role="radiogroup" aria-label="Where the refund goes" className="mb-3 space-y-1.5 rounded-xl border border-line p-3 text-sm">
                <p className="font-semibold">Where should the refund go?</p>
                <label className="flex cursor-pointer items-start gap-2"><input type="radio" className="mt-1" name="refundTo" checked={refundTo === 'original'} onChange={() => setRefundTo('original')} /><span>Back to my original payment method<span className="block text-xs text-muted">Usually 5–7 working days</span></span></label>
                <label className="flex cursor-pointer items-start gap-2"><input type="radio" className="mt-1" name="refundTo" checked={refundTo === 'wallet'} onChange={() => setRefundTo('wallet')} /><span>Keep it as wallet credit<span className="block text-xs text-muted">Instant, and you can use it on your next booking. It cannot be withdrawn as cash and expires after 12 months.</span></span></label>
                {Number(b.wallet_amount ?? 0) > 0 && <p className="text-xs text-muted">The {money(b.wallet_amount)} you paid from your wallet always goes back to your wallet.</p>}</div>)}
            <Textarea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep booking</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Yes, cancel</Button></div>
          </Modal>
          <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title="How was your game?">
            <div className="space-y-4"><StarInput value={rating} onChange={setRating} /><Textarea label="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setReviewOpen(false)}>Not now</Button><Button loading={review.isPending} onClick={() => review.mutate()}>Submit review</Button></div></div>
          </Modal>
        </div>
      );
    }}</QueryBoundary>
  );
}

export function FavouritesPage() {
  const q = useQuery({ queryKey: ['favourites'], queryFn: () => get<{ venues: any[] }>('/me/favourites') });
  return (
    <div><PageHeader title="Favourites" subtitle="Turfs you've saved" />
      {q.isLoading ? <SkeletonCards n={3} /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : q.data!.venues.length === 0 ? <Empty icon="❤️" title="Nothing saved yet" hint="Tap the heart on any turf to save it here." action={<Link to="/venues" className="btn-primary">Browse turfs</Link>} /> :
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{q.data!.venues.map((v) => <VenueCard key={v.id} v={{ ...v, is_favourite: true }} />)}</div>}</div>
  );
}

const GENDERS = [['', 'Prefer not to say'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']] as const;

/** Profile for customers (and the basic account page owners share). Changing the email or mobile asks for re-verification. */
export function ProfilePage() {
  const { user, refresh, setUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isCustomer = user?.role === 'customer'; const isOwner = user?.role === 'owner';
  const prof = useQuery({ queryKey: ['profile'], queryFn: () => get<{ user: any; profile: any }>('/me/profile') });
  const sportsQ = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string; slug: string }[] }>('/sports'), staleTime: Infinity, enabled: isCustomer });
  const opts = useVerificationOptions();
  const [form, setForm] = useState<{ fullName: string; phone: string; alt: string; email: string; city: string; birthDate: string; gender: string; sports: string[] } | null>(null);
  const [altOpen, setAltOpen] = useState<boolean | null>(null); // turf owners can add a second number; null = follow what is saved
  const [errs, setErrs] = useState<Record<string, string>>({});
  const p = prof.data?.profile;
  const f = form ?? { fullName: user?.fullName ?? '', phone: user?.phone ?? '', alt: p?.alternate_phone ?? '', email: user?.email ?? '', city: p?.city ?? '', birthDate: p?.birth_date ? String(p.birth_date).slice(0, 10) : '', gender: p?.gender ?? '', sports: (p?.preferred_sports as string[] | undefined) ?? [] };
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwErr, setPwErr] = useState('');
  const canon = (v: string) => { const d = v.replace(/[\s-]/g, ''); return /^\d{10}$/.test(d) ? '+91' + d : d; };
  const changed = { phone: !!user && canon(f.phone) !== canon(user.phone ?? ''), email: !!user && f.email.trim().toLowerCase() !== user.email.toLowerCase() };
  const showAlt = isOwner && (altOpen ?? !!p?.alternate_phone);
  const altValue = showAlt ? canon(f.alt) : '';
  const altChanged = isOwner && altValue !== (p?.alternate_phone ?? '');

  const save = useMutation({
    mutationFn: () => put('/me/profile', {
      fullName: f.fullName.trim(), ...(changed.phone ? { phone: f.phone.replace(/[\s-]/g, '') } : {}), ...(changed.email ? { email: f.email.trim() } : {}), ...(altChanged ? { alternatePhone: altValue } : {}),
      ...(isCustomer ? { city: f.city.trim(), preferredSports: f.sports, ...(f.birthDate ? { birthDate: f.birthDate } : {}), ...(f.gender ? { gender: f.gender } : {}) } : {}),
    }),
    onSuccess: (r: any) => {
      setUser(r.user); setForm(null); setAltOpen(null); setErrs({}); qc.invalidateQueries({ queryKey: ['profile'] });
      try { localStorage.setItem('kickoff_pref_sports', JSON.stringify(f.sports)); } catch { /* ignore */ }
      toast(changed.email || changed.phone ? 'Profile saved. Please verify your new ' + [changed.email && 'email', changed.phone && 'mobile number'].filter(Boolean).join(' and ') + '.' : 'Profile saved');
    },
    onError: (e) => { setErrs(fieldErrors(e)); toast(apiError(e), 'error'); },
  });
  const changePw = useMutation({ mutationFn: () => post('/auth/change-password', pw), onSuccess: (r: any) => { if (r?.token) setToken(r.token); setPw({ currentPassword: '', newPassword: '' }); setPwErr(''); toast('Password changed'); }, onError: (e) => setPwErr(apiError(e)) });
  const avatar = useMutation({ mutationFn: (file: File) => uploadAvatar(file), onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); toast('Profile picture updated'); }, onError: (e) => toast(apiError(e), 'error') });
  const onVerified = async () => { await refresh(); qc.invalidateQueries({ queryKey: ['profile'] }); toast('Verified'); };
  if (!user) return <Loading />;
  const set = (k: 'fullName' | 'phone' | 'alt' | 'email' | 'city' | 'birthDate') => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...f, [k]: e.target.value });
  const toggleSport = (slug: string) => setForm({ ...f, sports: f.sports.includes(slug) ? f.sports.filter((x) => x !== slug) : [...f.sports, slug] });
  const pickAvatar = (file?: File) => { if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('Use a JPG, PNG or WebP image', 'error'); if (file.size > 5 * 1024 * 1024) return toast('Image must be under 5 MB', 'error'); avatar.mutate(file); };
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Profile" subtitle={user.email} />
      <Card className="space-y-4 p-6" aria-label="Verification">
        <h2 className="text-2xl font-bold">Verification</h2>
        <VerifyRow channel="email" target={user.email} verified={user.emailVerified} available={!!opts.data?.email} onVerified={onVerified} />
        <VerifyRow channel="phone" target={user.phone} verified={user.phoneVerified} available={!!opts.data?.sms} onVerified={onVerified} />
      </Card>
      <Card className="p-6"><form className="space-y-4" onSubmit={(e: FormEvent) => {
        e.preventDefault(); const v: Record<string, string> = {};
        if (showAlt && f.alt && !isIndianMobile(f.alt.replace(/[\s-]/g, ''))) v.alternatePhone = MOBILE_MESSAGE;
        else if (showAlt && f.alt && canon(f.alt) === canon(f.phone)) v.alternatePhone = 'Use a different number from your main mobile number';
        setErrs(v); if (Object.keys(v).length) return; save.mutate();
      }}>
        <h2 className="text-2xl font-bold">Details</h2>
        {isCustomer && (
          <div className="flex items-center gap-4">
            {p?.avatar_url ? <img src={p.avatar_url} alt="Your profile picture" className="h-20 w-20 shrink-0 rounded-full object-cover" /> : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-brand text-3xl font-extrabold text-brand-ink" aria-hidden="true">{user.fullName.slice(0, 1).toUpperCase()}</span>}
            <div className="min-w-0 flex-1 space-y-1"><label htmlFor="avatar-file" className="block text-xs font-semibold uppercase tracking-wide text-muted">Profile picture</label>
              <input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full max-w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface2 file:px-3 file:py-1.5 file:text-sm file:font-semibold" disabled={avatar.isPending} onChange={(e) => { pickAvatar(e.target.files?.[0]); e.target.value = ''; }} />
              <p className="text-xs text-muted">{avatar.isPending ? 'Uploading…' : 'JPG, PNG or WebP, up to 5 MB'}</p></div>
          </div>)}
        <Input label="Full name" value={f.fullName} onChange={set('fullName')} required minLength={2} error={errs.fullName} />
        <Input label="Mobile number" type="tel" value={f.phone} onChange={set('phone')} placeholder="9876543210" error={errs.phone} hint={changed.phone ? 'You will need to verify this new number before it counts as verified.' : 'Changing your number requires re-verification'} />
        {isOwner && (showAlt ? (
          <div className="flex items-start gap-2"><div className="flex-1"><Input label="Second phone number" type="tel" value={f.alt} onChange={set('alt')} error={errs.alternatePhone} placeholder="+919876543211" hint="Live as soon as you save. No approval needed." /></div>
            <button type="button" onClick={() => { setAltOpen(false); setForm({ ...f, alt: '' }); }} className="mt-6 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-muted hover:text-danger">Remove</button></div>
        ) : <button type="button" onClick={() => setAltOpen(true)} className="btn-ghost !py-1.5 text-sm">+ Add another phone number</button>)}
        <Input label="Email address" type="email" value={f.email} onChange={set('email')} error={errs.email} hint={changed.email ? 'You will need to verify this new email address, and use it to log in from now on.' : undefined} />
        {isCustomer && <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Date of birth (optional)" type="date" max={new Date().toISOString().slice(0, 10)} value={f.birthDate} onChange={set('birthDate')} error={errs.birthDate} />
            <Select label="Gender (optional)" value={f.gender} onChange={(e) => setForm({ ...f, gender: e.target.value })}>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </div>
          <fieldset><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Preferred sports</legend>
            <div className="flex flex-wrap gap-2">{sportsQ.data?.sports.map((s) => <button key={s.id} type="button" aria-pressed={f.sports.includes(s.slug)} onClick={() => toggleSport(s.slug)} className={`chip !px-3 !py-1.5 text-sm ${f.sports.includes(s.slug) ? 'border-brand text-ink' : ''}`}>{s.name}</button>)}</div></fieldset>
          <Input label="Preferred location" value={f.city} onChange={set('city')} placeholder="City or area" error={errs.city} />
        </>}
        <Button type="submit" loading={save.isPending}>Save changes</Button></form></Card>
      <Card className="p-6"><form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setPwErr(''); changePw.mutate(); }}>
        <h2 className="text-2xl font-bold">Change password</h2>
        <PasswordInput label="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
        <PasswordInput label="New password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint="8+ characters with a letter and a digit" required />
        {pwErr && <p role="alert" className="text-sm text-danger">{pwErr}</p>}
        <Button type="submit" variant="ghost" loading={changePw.isPending}>Update password</Button></form></Card>
      <NotificationPreferences />
    </div>
  );
}

export function NotificationsPage({ type, title = 'Notifications', emptyTitle = "You're all caught up", subtitle }: { type?: string; title?: string; emptyTitle?: string; subtitle?: string } = {}) {
  const qc = useQueryClient();
  const [show, setShow] = useState<'all' | 'unread'>('all');
  const q = useQuery({ queryKey: ['notifications', 'list', type], queryFn: () => get<{ notifications: any[]; unread: number }>('/me/notifications', { limit: 50, type }) });
  const markAll = useMutation({ mutationFn: () => post('/me/notifications/read', {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const nav = useNavigate();
  /** Opens the page an alert refers to (data.link) and marks the alert as read. */
  const openAlert = async (n: any) => { if (!n.data?.link) return; if (!n.read_at) { try { await post('/me/notifications/read', { ids: [n.id] }); qc.invalidateQueries({ queryKey: ['notifications'] }); } catch { /* navigation still proceeds */ } } nav(n.data.link); };
  return (
    <div className="mx-auto max-w-2xl"><PageHeader title={title} subtitle={subtitle} actions={q.data?.unread ? <Button variant="ghost" onClick={() => markAll.mutate()} loading={markAll.isPending}>Mark all read</Button> : undefined} />
      <div className="mb-3 flex gap-2" role="group" aria-label="Show">{(['all', 'unread'] as const).map((k) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`chip !px-3 !py-1.5 text-sm ${show === k ? '!border-brand bg-brand/15 text-ink' : ''}`}>{k === 'all' ? 'All' : `Unread${q.data?.unread ? ` (${q.data.unread})` : ''}`}</button>)}</div>
      <QueryBoundary q={q} empty={(d) => d.notifications.length === 0 && <Empty icon="🔔" title={emptyTitle} />}>
        {(d) => d.notifications.filter((n) => show === 'all' || !n.read_at).length === 0 ? <Empty icon="🔔" title={show === 'unread' ? 'You are all caught up' : emptyTitle} /> : <div className="space-y-2">{d.notifications.filter((n) => show === 'all' || !n.read_at).map((n) => (
          <div key={n.id} {...(n.data?.link ? { role: 'link', tabIndex: 0, onClick: () => openAlert(n), onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && openAlert(n) } : {})} className={`card p-4 ${n.read_at ? 'opacity-70' : 'border-brand/40'} ${n.data?.link ? 'cursor-pointer transition hover:border-brand' : ''}`}><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{n.title}</h3><p className="text-sm text-muted">{n.body}</p></div>{!n.read_at && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}</div><p className="mt-1 text-xs text-muted">{fmtDateTime(n.created_at)}</p></div>))}</div>}
      </QueryBoundary></div>
  );
}

export function SupportPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const params = new URLSearchParams(location.search);
  const [open, setOpen] = useState(!!params.get('booking'));
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: '', message: '', priority: 'normal' });
  const [bookingId, setBookingId] = useState(params.get('booking') ?? ''); const [bkErr, setBkErr] = useState(''); // the booking the ticket is about (so support can refund it)
  const list = useQuery({ queryKey: ['tickets'], queryFn: () => get<{ tickets: any[] }>('/me/tickets') });
  const myBookings = useQuery({ queryKey: ['bookings', 'for-ticket'], enabled: open, queryFn: () => get<{ bookings: any[] }>('/bookings', { limit: 50 }) });
  const create = useMutation({ mutationFn: () => post('/me/tickets', { ...form, bookingId: bookingId && bookingId !== 'none' ? bookingId : undefined }),
    onSuccess: () => { setOpen(false); setBookingId(''); setForm({ subject: '', message: '', priority: 'normal' }); qc.invalidateQueries({ queryKey: ['tickets'] }); toast('Ticket submitted. We\'ll reply soon.'); }, onError: (e) => toast(apiError(e), 'error') });
  const { user } = useAuth(); const owner = user?.role === 'owner'; const [attempted, setAttempted] = useState(false);
  if (owner) return ( // a venue owner's page, laid out like JusGo support page: raise a ticket on the page, and the tickets under it
    <div className="mx-auto max-w-3xl space-y-5"><PageHeader title="Admin Support" subtitle="Raise a ticket and KickOff support will get back to you." />
      <Card className="space-y-4 p-5"><h2 className="text-2xl font-bold">Raise a ticket</h2>
        <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setAttempted(true); if (form.subject.trim().length < 3 || form.message.trim().length < 5) return; create.mutate(); setAttempted(false); }}>
          <Input mandatory label="Subject" placeholder="What do you need help with?" maxLength={150} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} error={attempted && form.subject.trim().length < 3 ? 'Enter a subject (at least 3 letters).' : undefined} />
          <Textarea mandatory label="Description" placeholder="Tell us what happened, and where (venue, playing area, booking ID)." maxLength={2000} rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} error={attempted && form.message.trim().length < 5 ? 'Describe the problem (at least 5 letters).' : undefined} />
          <div className="flex justify-end"><Button type="submit" loading={create.isPending}>Raise ticket</Button></div></form></Card>
      <Card className="space-y-3 p-5"><h2 className="text-2xl font-bold">Your tickets</h2>
        <QueryBoundary q={list} empty={(d) => d.tickets.length === 0 && <Empty icon="🎧" title="No tickets yet" hint="Tickets you raise appear here, with KickOff's reply." />}>
          {(d) => <ul className="space-y-2" aria-label="Your tickets">{d.tickets.map((t) => <li key={t.id}><button onClick={() => setSel(t.id)} className="card flex w-full items-center justify-between gap-3 p-4 text-left transition hover:border-brand/50"><div><h3 className="text-lg font-bold">{t.subject}</h3><p className="text-xs text-muted">Updated {fmtDateTime(t.updated_at)}</p></div><Badge status={t.status === 'closed' || t.status === 'resolved' ? 'approved' : 'pending'}>{titleCase(t.status)}</Badge></button></li>)}</ul>}
        </QueryBoundary></Card>
      {sel && <TicketThread id={sel} onClose={() => setSel(null)} base="/me/tickets" />}
    </div>);
  return (
    <div className="mx-auto max-w-3xl"><PageHeader title="Support" subtitle="Questions about a booking, payment or refund? We're here." actions={<Button onClick={() => setOpen(true)}>New ticket</Button>} />
      <QueryBoundary q={list} empty={(d) => d.tickets.length === 0 && <Empty icon="🎧" title="No tickets" hint="Create a ticket and our team will get back to you." />}>
        {(d) => <div className="space-y-2">{d.tickets.map((t) => (
          <button key={t.id} onClick={() => setSel(t.id)} className="card flex w-full items-center justify-between gap-3 p-4 text-left transition hover:border-brand/50"><div><h3 className="text-lg font-bold">{t.subject}</h3><p className="text-xs text-muted">Updated {fmtDateTime(t.updated_at)}</p></div><Badge status={t.status} /></button>))}</div>}
      </QueryBoundary>
      <Modal open={open} onClose={() => setOpen(false)} title="New support ticket">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!bookingId) return setBkErr('Choose the booking that had the problem, or "Something else".'); create.mutate(); }}>
          <Select mandatory label="Which booking had the problem?" value={bookingId} onChange={(e) => { setBookingId(e.target.value); setBkErr(''); }} error={bkErr || undefined}><option value="" disabled>Choose the booking</option><option value="none">Something else (not about a booking)</option>{(myBookings.data?.bookings ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.reference} · {b.venue_name} · {fmtDateTime(b.starts_at)}</option>)}</Select>
          <Input label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required minLength={3} maxLength={150} />
          <Textarea label="How can we help?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required minLength={5} rows={5} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Submit</Button></div>
        </form></Modal>
      {sel && <TicketThread id={sel} onClose={() => setSel(null)} base="/me/tickets" />}
    </div>
  );
}

export function TicketThread({ id, onClose, base, admin }: { id: string; onClose(): void; base: string; admin?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [msg, setMsg] = useState(''); const [status, setStatus] = useState('in_progress');
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => get<{ ticket: any; messages: any[]; booking?: any }>(`${base}/${id}`) });
  // admin: settle the complaint with a refund of all that is left, or a part
  const [rf, setRf] = useState<{ mode: 'full' | 'part'; amount: string; reason: string }>({ mode: 'full', amount: '', reason: '' }); const [rfErr, setRfErr] = useState('');
  const [linkId, setLinkId] = useState('');
  const refund = useMutation({ mutationFn: () => post(`${base}/${id}/refund`, { ...(rf.mode === 'part' ? { amount: Number(rf.amount) } : {}), ...(rf.reason.trim() ? { reason: rf.reason.trim() } : {}), ...(!q.data?.booking && linkId ? { bookingId: linkId } : {}) }),
    onSuccess: (r: any) => { toast(`Refunded ${money(Number(r.refund?.amount ?? 0))}. The complaint is resolved.`); setRf({ mode: 'full', amount: '', reason: '' }); qc.invalidateQueries({ queryKey: ['ticket', id] }); qc.invalidateQueries({ queryKey: ['admin-tickets'] }); },
    onError: (e) => setRfErr(apiError(e)) });
  const send = useMutation({ mutationFn: () => post(admin ? `${base}/${id}/reply` : `${base}/${id}/messages`, admin ? { ...(msg.trim() ? { message: msg } : {}), status } : { message: msg }),
    onSuccess: () => { setMsg(''); qc.invalidateQueries({ queryKey: ['ticket', id] }); qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['admin-tickets'] }); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <Modal open onClose={onClose} title={q.data?.ticket.subject ?? 'Ticket'} wide>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorBox error={q.error} /> : (<div className="space-y-4">
        <div className="max-h-80 space-y-2 overflow-y-auto">{q.data!.messages.map((m) => (
          <div key={m.id} className={`rounded-xl p-3 text-sm ${m.author_role === 'admin' ? 'bg-brand/15' : 'bg-surface2'}`}><div className="mb-1 flex justify-between text-xs text-muted"><b>{m.author}{m.author_role === 'admin' ? ' (Support)' : ''}</b><span>{fmtDateTime(m.created_at)}</span></div>{m.body}</div>))}</div>
        {admin && !q.data!.booking && (q.data as any).bookings && (
          <section aria-label="Booking and refund" className="space-y-2 rounded-xl border border-line p-4 text-sm">
            <p className="text-muted">The customer did not say which booking this is about. Choose one of their paid KickOff bookings to refund it.</p>
            {(q.data as any).bookings.length === 0 ? <p className="text-muted">This customer has no paid KickOff booking to refund.</p>
              : <Select label="Booking" value={linkId} onChange={(e) => setLinkId(e.target.value)}><option value="">Choose a booking</option>{(q.data as any).bookings.map((b: any) => <option key={b.id} value={b.id}>{b.reference} · {b.venue_name} · {fmtDateTime(b.starts_at)} · can refund {money(b.refundable)}</option>)}</Select>}
          </section>)}
        {admin && (q.data!.booking || ((q.data as any).bookings ?? []).find((b: any) => b.id === linkId)) && (() => { const bk = q.data!.booking ?? (q.data as any).bookings.find((b: any) => b.id === linkId); const max = Number(bk.refundable);
          return (<section aria-label="Booking and refund" className="space-y-3 rounded-xl border border-line p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><span><b>{bk.reference}</b> · {bk.venue_name} · {bk.area_name}</span><span className="text-muted">{fmtDateTime(bk.starts_at)}</span></div>
            <dl className="grid grid-cols-3 gap-2"><div><dt className="text-xs text-muted">Paid</dt><dd className="font-bold">{money(bk.paid)}</dd></div><div><dt className="text-xs text-muted">Refunded</dt><dd className="font-bold">{money(bk.refunded)}</dd></div><div><dt className="text-xs text-muted">Can still refund</dt><dd className="font-bold text-[rgb(var(--brand-text))]">{money(max)}</dd></div></dl>
            {max <= 0 ? <p className="text-muted">Nothing left to refund on this booking.</p> : (
              <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); setRfErr('');
                if (rf.mode === 'part' && !(Number(rf.amount) > 0 && Number(rf.amount) <= max)) return setRfErr(`Enter an amount from ₹1 to ${money(max)}.`);
                if (!window.confirm(`Refund ${rf.mode === 'full' ? money(max) : money(Number(rf.amount))} to the customer and resolve this complaint?`)) return; refund.mutate(); }}>
                <h3 className="font-bold">Refund the customer</h3>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Refund amount">{([['full', `Full (${money(max)})`], ['part', 'Part of it']] as const).map(([k, l]) => <label key={k} className={`chip cursor-pointer !px-3 !py-1.5 ${rf.mode === k ? '!border-brand bg-brand/15 text-ink' : ''}`}><input type="radio" className="sr-only" name="rf-mode" checked={rf.mode === k} onChange={() => setRf({ ...rf, mode: k })} />{l}</label>)}</div>
                {rf.mode === 'part' && <Input label="Amount to refund (₹)" type="number" min={1} max={max} value={rf.amount} onChange={(e) => setRf({ ...rf, amount: e.target.value })} />}
                <Textarea label="Reason (optional, sent to the customer)" rows={2} maxLength={300} value={rf.reason} onChange={(e) => setRf({ ...rf, reason: e.target.value })} placeholder="For example: the turf was flooded and the game could not be played" />
                <p className="text-xs text-muted">The refund goes back to the customer's payment. The venue's payout for this booking goes down by the same part; the rest is still paid to the venue. The complaint is marked resolved.</p>
                {rfErr && <p role="alert" className="text-sm text-danger">{rfErr}</p>}
                <Button type="submit" loading={refund.isPending}>Refund and resolve</Button></form>)}
          </section>); })()}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <Textarea label={admin ? "Reply (optional)" : "Reply"} value={msg} onChange={(e) => setMsg(e.target.value)} required={!admin} />
          <div className="flex items-end justify-between gap-3">{admin ? <select aria-label="Set status" className="field !w-44" value={status} onChange={(e) => setStatus(e.target.value)}>{['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select> : <span />}<Button type="submit" loading={send.isPending}>{admin && !msg.trim() ? 'Update status' : 'Send'}</Button></div>
        </form></div>)}
    </Modal>
  );
}
