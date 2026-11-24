import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, get, post } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, Spinner, Textarea } from '../../components/ui';
import { bookableDurations, cx, durationLabel, fmtDate, fmtRange, fmtTime, money, todayISO } from '../../lib/utils';
import { KnownMobilePrompt, useKnownPeople } from './KnownMobile';
import { isIndianMobile, PHONE_CHECK, MOBILE_MESSAGE } from '../../lib/phone';

interface Slot { startsAt: string; endsAt: string; price: number | null; available: boolean; reason?: string }
const METHODS = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['unpaid', 'Not paid yet']] as const;
const EMPTY = { phone: '', name: '', city: '', o1Phone: '', o1Name: '', o1City: '', o2Phone: '', o2Name: '', o2City: '', status: '', initial: '', mode: '' };
const STATUS_LABEL: Record<string, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid' };
const REASON: Record<string, string> = { booked: 'Booked', held: 'Held', blocked: 'Closed' };
const PHONE = PHONE_CHECK;

/**
 * The owner books a slot for someone who is not using the app (a walk-in or a phone call). The slot is checked exactly as for an online
 * booking, it is confirmed at once, and nothing is paid through KickOff: the owner records what they collected at the venue.
 */
export function OfflineBookingPage() {
  const qc = useQueryClient(); const [sp] = useSearchParams();
  const venuesQ = useQuery({ queryKey: ['owner-venues'], queryFn: () => get<{ venues: any[] }>('/owner/venues') });
  const sportsQ = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string }[] }>('/sports'), staleTime: Infinity });
  const bookable = (venuesQ.data?.venues ?? []).filter((v) => v.status === 'approved');
  const [venueId, setVenueId] = useState(sp.get('venue') ?? ''); const [areaId, setAreaId] = useState(sp.get('area') ?? '');
  const vid = bookable.some((v) => v.id === venueId) ? venueId : bookable[0]?.id ?? '';
  const detail = useQuery({ queryKey: ['owner-venue', vid], queryFn: () => get<{ venue: any }>(`/owner/venues/${vid}`), enabled: !!vid });
  const areas: any[] = (detail.data?.venue.areas ?? []).filter((a: any) => a.is_active && (a.sport_ids?.length ?? 0) > 0);
  const area = areas.find((a) => a.id === areaId) ?? areas[0];
  const tz: string = detail.data?.venue.timezone ?? 'Asia/Kolkata';

  const [sportId, setSportId] = useState(0); const [date, setDate] = useState(todayISO()); const [duration, setDuration] = useState(0);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [error, setError] = useState('');
  const [done, setDone] = useState<any | null>(null);

  const sports = (sportsQ.data?.sports ?? []).filter((s) => area?.sport_ids?.includes(s.id));
  const sid = sports.some((s) => s.id === sportId) ? sportId : sports[0]?.id ?? 0;
  const durations = useMemo(() => (area ? bookableDurations(area) : []), [area]);
  const dur = durations.includes(duration) ? duration : durations[0] ?? 0;

  useEffect(() => { setSlot(null); }, [area?.id, sid, date, dur]);
  const people = useKnownPeople();
  const openGround = area?.environment === 'outdoor'; // JusGo asks for the two opponents on an open ground
  const total = slot?.price ?? null; const paidNow = f.status === 'paid' ? total ?? 0 : f.status === 'partial' ? Number(f.initial) || 0 : 0;

  const slotsQ = useQuery({ queryKey: ['offline-slots', area?.id, sid, date, dur], enabled: !!area && !!sid && !!dur,
    queryFn: () => get<{ slots: Slot[] }>(`/areas/${area.id}/slots`, { date, sportId: sid, duration: dur }) });
  const slots = (slotsQ.data?.slots ?? []).filter((s) => s.reason !== 'past' && s.reason !== 'unpriced'); // only what can still be booked, plus what is taken

  const book = useMutation({
    mutationFn: () => post<any>('/owner/bookings/offline', {
      areaId: area.id, sportId: sid, startsAt: slot!.startsAt, durationMinutes: dur, customerName: f.name.trim(), customerPhone: f.phone.replace(/[\s-]/g, ''), customerCity: f.city.trim(),
      paymentMethod: f.status === 'unpaid' ? 'unpaid' : f.mode, ...(f.status === 'partial' ? { amountPaid: Number(f.initial) } : {}),
      ...(openGround ? { opponent1Name: f.o1Name.trim(), opponent1Phone: f.o1Phone.replace(/[\s-]/g, ''), opponent1City: f.o1City.trim(), opponentName: f.o2Name.trim(), opponentPhone: f.o2Phone.replace(/[\s-]/g, ''), opponentCity: f.o2City.trim() } : {}) }),
    onSuccess: (r) => { setDone({ ...r, customer: f.name.trim(), phone: f.phone, method: f.status === 'unpaid' ? 'unpaid' : f.mode, status: f.status, area: area.name, sport: sports.find((s) => s.id === sid)?.name }); ['owner-bookings', 'owner-overview', 'owner-calendar', 'offline-slots'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => { setError(apiError(e)); qc.invalidateQueries({ queryKey: ['offline-slots'] }); },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault(); setError(''); const v: Record<string, string> = {};
    if (!slot) v.slot = 'Choose a time slot';
    if (!PHONE.test(f.phone.replace(/[\s-]/g, ''))) v.phone = MOBILE_MESSAGE;
    if (f.name.trim().length < 2) v.name = "Enter the customer's name";
    if (f.city.trim().length < 2) v.city = 'Enter the customer\'s city';
    if (openGround) for (const [k, label] of [['o1', 'Opponent 1'], ['o2', 'Opponent 2']] as const) {
      if (!isIndianMobile((f as any)[`${k}Phone`].replace(/[\s-]/g, ''))) v[`${k}Phone`] = MOBILE_MESSAGE;
      if ((f as any)[`${k}Name`].trim().length < 2) v[`${k}Name`] = `Enter ${label}'s name`;
      if ((f as any)[`${k}City`].trim().length < 2) v[`${k}City`] = `Enter ${label}'s city`;
    }
    if (!f.status) v.status = 'Please select the payment status.';
    if (f.status === 'partial' && !(Number(f.initial) > 0 && total != null && Number(f.initial) < total)) v.initial = total != null ? `Enter an amount more than 0 and less than ${money(total)}.` : 'Choose the slot first.';
    if ((f.status === 'paid' || f.status === 'partial') && !f.mode) v.mode = 'Please select the mode of payment.';
    setErrs(v); if (Object.keys(v).length) return;
    book.mutate();
  };
  const reset = () => { setDone(null); setSlot(null); setF(EMPTY); setErrs({}); setError(''); };

  if (venuesQ.isLoading) return <Loading />;
  if (venuesQ.isError) return <ErrorBox error={venuesQ.error} retry={() => venuesQ.refetch()} />;
  const back = <Link to="/owner" className="text-sm text-muted hover:text-ink">← Back to overview</Link>;

  if (done) return (
    <div className="mx-auto max-w-2xl space-y-4">{back}
      <section aria-label="Booking confirmed"><Card className="space-y-4 p-6">
        <div><p className="text-sm font-semibold text-ok">✓ Booking confirmed</p><h1 className="text-4xl font-extrabold">{done.reference}</h1></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[['Customer', `${done.customer} · ${done.phone}`], ['Venue', done.venueName], ['Playing area', `${done.area}${done.sport ? ` · ${done.sport}` : ''}`], ['Date and time', fmtRange(done.startsAt, done.endsAt, done.timezone)],
            ['Amount', `${money(done.total)}${done.discount > 0 ? ` (${money(done.discount)} off)` : ''}`], ['Payment', `${STATUS_LABEL[done.status] ?? ''}${done.method && done.method !== 'unpaid' ? ` · ${done.method === 'online' ? 'Online' : 'Offline'}` : ''}`]].map(([k, v]) => <div key={k}><dt className="text-xs uppercase tracking-wide text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
        <p className="text-xs text-muted">The slot is now blocked for online customers. Nothing was charged through KickOff, so there is no commission and no payout for this booking.</p>
        <div className="flex flex-wrap gap-2"><Button onClick={reset}>Add another offline booking</Button><Link to="/owner/bookings" className="btn-ghost">View all bookings</Link><Link to="/owner" className="btn-ghost">Back to overview</Link></div>
      </Card></section>
    </div>);

  if (bookable.length === 0) return <div className="space-y-4">{back}<Empty icon="🏟️" title="No approved venue yet" hint="You can add offline bookings once KickOff has approved one of your venues." action={<Link to="/owner/venues" className="btn-primary">Go to venues</Link>} /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">{back}
      <PageHeader title="Add offline booking" subtitle="Book a slot for a walk-in or phone customer. It is confirmed at once and blocks the slot for everyone else." />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Card className="space-y-4 p-5"><h2 className="text-2xl font-bold">1. Choose the slot</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Venue" value={vid} onChange={(e) => { setVenueId(e.target.value); setAreaId(''); }}>{bookable.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? `, ${v.city}` : ''}</option>)}</Select>
            <Select label="Playing area" value={area?.id ?? ''} onChange={(e) => setAreaId(e.target.value)} disabled={!areas.length}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            <Select label="Sport" value={sid} onChange={(e) => setSportId(Number(e.target.value))} disabled={!sports.length}>{sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            <Select label="Duration" value={dur} onChange={(e) => setDuration(Number(e.target.value))} disabled={!durations.length}>{durations.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}</Select>
            <Input label="Date" type="date" min={todayISO()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          {detail.isLoading ? <Loading /> : !area ? <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">This venue has no active playing area with a sport. Add one under Playing areas first.</p> : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted"><span>Available slots on {fmtDate(`${date}T12:00:00Z`)}</span>{slotsQ.isFetching && <Spinner size={14} />}</div>
              {slotsQ.isError ? <ErrorBox error={slotsQ.error} retry={() => slotsQ.refetch()} /> : slotsQ.isLoading ? <Loading /> : slots.length === 0
                ? <p className="rounded-xl bg-surface2 p-4 text-center text-sm text-muted">No slots on this day. The area may be closed, or every slot has passed. Try another date.</p>
                : <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" role="listbox" aria-label="Time slots">{slots.map((s) => (
                  <button key={s.startsAt} type="button" role="option" aria-selected={slot?.startsAt === s.startsAt} disabled={!s.available} onClick={() => { setSlot(s); setErrs((x) => ({ ...x, slot: '' })); }}
                    className={cx('rounded-xl border px-2 py-2 text-left text-sm transition', slot?.startsAt === s.startsAt ? 'border-brand bg-brand text-brand-ink' : s.available ? 'border-line hover:border-brand' : 'cursor-not-allowed border-line/50 bg-surface2/40 text-muted line-through opacity-60')}>
                    <div className="font-semibold">{fmtTime(s.startsAt, tz)}</div><div className="text-xs">{s.available ? money(s.price) : <span className="no-underline">{REASON[s.reason ?? ''] ?? 'Taken'}</span>}</div></button>))}</div>}
              {errs.slot && <p role="alert" className="text-xs text-danger">{errs.slot}</p>}
            </div>)}
        </Card>

        <Card className="space-y-4 p-5"><h2 className="text-2xl font-bold">2. Customer and payment</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input mandatory label="Customer mobile" type="tel" autoComplete="off" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} />
            <Input mandatory label="Customer name" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
            <Input mandatory label="City" autoComplete="off" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} error={errs.city} />
            <KnownMobilePrompt mobile={f.phone} name={f.name} nameId="off-name" people={people} onUse={(p) => setF({ ...f, name: p.name, city: f.city.trim() ? f.city : p.city })} />
          </div>
          {openGround && <div className="space-y-4">
            <div className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Opponent 1</p><Button type="button" variant="ghost" className="!py-1.5" onClick={() => setF({ ...f, o1Phone: f.phone, o1Name: f.name, o1City: f.city })}>Copy customer details</Button></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Input mandatory label="Opponent 1 mobile" type="tel" autoComplete="off" value={f.o1Phone} onChange={(e) => setF({ ...f, o1Phone: e.target.value })} error={errs.o1Phone} /><Input mandatory label="Opponent 1 name" autoComplete="off" value={f.o1Name} onChange={(e) => setF({ ...f, o1Name: e.target.value })} error={errs.o1Name} /><Input mandatory label="Opponent 1 city" autoComplete="off" value={f.o1City} onChange={(e) => setF({ ...f, o1City: e.target.value })} error={errs.o1City} /><KnownMobilePrompt mobile={f.o1Phone} name={f.o1Name} nameId="off-o1-name" people={people} onUse={(p) => setF({ ...f, o1Name: p.name, o1City: f.o1City.trim() ? f.o1City : p.city })} /></div></div>
            <div className="space-y-2"><p className="text-sm font-semibold">Opponent 2</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Input mandatory label="Opponent 2 mobile" type="tel" autoComplete="off" value={f.o2Phone} onChange={(e) => setF({ ...f, o2Phone: e.target.value })} error={errs.o2Phone} /><Input mandatory label="Opponent 2 name" autoComplete="off" value={f.o2Name} onChange={(e) => setF({ ...f, o2Name: e.target.value })} error={errs.o2Name} /><Input mandatory label="Opponent 2 city" autoComplete="off" value={f.o2City} onChange={(e) => setF({ ...f, o2City: e.target.value })} error={errs.o2City} /><KnownMobilePrompt mobile={f.o2Phone} name={f.o2Name} nameId="off-o2-name" people={people} onUse={(p) => setF({ ...f, o2Name: p.name, o2City: f.o2City.trim() ? f.o2City : p.city })} /></div></div></div>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select mandatory label="Payment status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, ...(e.target.value === 'unpaid' ? { mode: '', initial: '' } : {}) })} error={errs.status}><option value="" disabled>Select payment status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            {f.status === 'partial' && <Input mandatory label="Initial payment (₹)" type="number" min={0} inputMode="decimal" placeholder="Amount paid now" value={f.initial} onChange={(e) => setF({ ...f, initial: e.target.value })} error={errs.initial} />}
            {f.status === 'partial' && total != null && Number(f.initial) > 0 && Number(f.initial) < total && <div aria-live="polite"><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Pending amount</p><p className="flex min-h-10 items-center text-lg font-bold text-danger">{money(Math.round((total - Number(f.initial)) * 100) / 100)}</p></div>}
            {(f.status === 'paid' || f.status === 'partial') && <Select mandatory label="Mode of payment" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} error={errs.mode}><option value="" disabled>Select mode</option><option value="online">Online</option><option value="offline">Offline</option></Select>}
          </div>
        </Card>

        {slot && area && <p role="status" className="rounded-xl border border-line bg-surface2/50 p-3 text-sm"><b>{area.name}</b> · {fmtRange(slot.startsAt, slot.endsAt, tz)} · {durationLabel(dur)}{total != null && <> · <b>{money(total)}</b></>}</p>}
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Link to="/owner" className="btn-ghost">Cancel</Link><Button type="submit" loading={book.isPending}>Confirm booking</Button></div>
      </form>
    </div>
  );
}
