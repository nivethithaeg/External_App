import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { downloadReceiptPdf } from '../../lib/receiptPdf';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, post, put, setToken } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, PageHeader, QueryBoundary, Select, SkeletonCards, Stat, StarInput, Stars, Tabs, Textarea } from '../../components/ui';
import { VenueCard, type VenueSummary } from '../../components/VenueCard';
import { VenuesMap, directionsUrl } from '../../lib/maps';
import { fmtDate, fmtDateTime, fmtRange, money, titleCase } from '../../lib/utils';
import { SPORTS } from './Landing';
import { STATES, citiesOf } from '../../lib/india';

/* ------------------------------------------------------------------ Nearby turfs */
export function NearbyPage() {
  const { toast } = useToast();
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [state, setState] = useState(''); const [city, setCity] = useState(''); const [radius, setRadius] = useState('25'); const [asking, setAsking] = useState(false);
  const params = pos ? { lat: pos.lat, lng: pos.lng, sort: 'distance', radiusKm: radius, limit: 30 } : state ? { state, ...(city ? { city } : {}), sort: 'rating', limit: 30 } : null;
  const q = useQuery({ queryKey: ['nearby', params], queryFn: () => get<{ venues: VenueSummary[] }>('/venues', params!), enabled: !!params });
  const ask = () => { // only on the customer's click: the browser then asks for permission itself
    if (!navigator.geolocation) return toast('This device cannot share its location. Pick a city instead.', 'info');
    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }); setState(''); setCity(''); setAsking(false); },
      () => { setAsking(false); toast('Location permission was not given. Pick a city instead.', 'info'); }, { timeout: 10000 });
  };
  const venues = q.data?.venues ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Nearby turfs" subtitle="Find turfs close to you, with distance and directions" />
      <Card className="grid items-end gap-4 p-5 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_auto]">
        <Button onClick={ask} loading={asking} variant={pos ? 'primary' : 'ghost'}>{pos ? '📍 Using your location' : '📍 Use my current location'}</Button>
        <Select label="Or choose a state" value={state} onChange={(e) => { setState(e.target.value); setCity(''); setPos(null); }}><option value="">Select state</option>{STATES.map((st) => <option key={st} value={st}>{st}</option>)}</Select>
        <Select label="City" value={city} disabled={!state} onChange={(e) => { setCity(e.target.value); setPos(null); }}><option value="">{state ? 'All cities' : 'Select a state first'}</option>{citiesOf(state).map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select label="Within" value={radius} onChange={(e) => setRadius(e.target.value)} disabled={!pos}>{['5', '10', '25', '50', '100'].map((r) => <option key={r} value={r}>{r} km</option>)}</Select>
        <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">Your location is only used to sort turfs by distance and is not stored.</p>
      </Card>
      {!params ? <Empty icon="📍" title="Where are you playing?" hint="Share your location, or choose a state and city, to see turfs near you." />
        : q.isLoading ? <SkeletonCards n={3} /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} />
        : venues.length === 0 ? <Empty title="No turfs found" hint={pos ? 'Try a wider distance or choose a state and city.' : 'No turfs listed here yet. Try another city or state.'} />
        : (<>
          <VenuesMap points={venues.filter((v: any) => v.lat != null).map((v: any) => ({ id: v.id, name: v.name, lat: +v.lat, lng: +v.lng }))} className="h-72" />
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{venues.map((v: any) => (
            <div key={v.id} className="space-y-2"><VenueCard v={v} />{v.lat != null && <a className="btn-ghost w-full" href={directionsUrl(+v.lat, +v.lng)} target="_blank" rel="noreferrer">Get directions</a>}</div>))}</div></>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Sports categories */
export function SportsPage() {
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string; slug: string }[] }>('/sports'), staleTime: Infinity });
  return (
    <div className="space-y-6">
      <PageHeader title="Sports" subtitle="Pick a sport to see the turfs and courts that offer it" />
      <QueryBoundary q={sports} empty={(d) => d.sports.length === 0 && <Empty title="No sports yet" />}>
        {(d) => <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{d.sports.map((s) => {
          const info = SPORTS[s.slug] ?? { desc: `Find turfs and courts for ${s.name.toLowerCase()}.`, icon: '🏟️', from: '#1B2A80', to: '#101B5C' };
          return (
            <Link key={s.id} to={`/venues?sport=${s.slug}`} aria-label={`Explore ${s.name} turfs`} className="card group overflow-hidden transition hover:-translate-y-1 hover:border-brand/50">
              <div className="pitch-stripes grid h-36 place-items-center text-6xl" style={{ background: `linear-gradient(135deg, ${info.from}, ${info.to})` }} aria-hidden="true">{info.icon}</div>
              <div className="space-y-2 p-5"><h3 className="text-3xl font-bold">{s.name}</h3><p className="text-sm text-muted">{info.desc}</p><span className="inline-block font-bold text-[rgb(var(--brand-text))]">Explore {s.name} turfs →</span></div>
            </Link>); })}</div>}
      </QueryBoundary>
    </div>
  );
}

/* ------------------------------------------------------------------ Offers & coupons */
const CopyIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>;
const CalendarIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;

/** The big line on a coupon, with the amount picked out in the brand colour. */
function Headline({ o }: { o: any }) {
  const amount = o.discount_type === 'percent' ? `${o.value}%` : money(o.value);
  return <h3 className="font-display text-4xl font-extrabold uppercase leading-none text-white sm:text-5xl">{o.discount_type === 'percent' ? '' : 'Flat '}<span className="text-[#7200FF]">{amount}</span> off</h3>;
}

/** One ticket-style coupon: the offer on a dark panel, the code on a dashed stub with Copy and Use Now. */
function CouponTicket({ o, expired, onCopy, onUse }: { o: any; expired: boolean; onCopy(code: string): void; onUse(o: any): void }) {
  const daysLeft = Math.ceil((new Date(o.valid_to).getTime() - Date.now()) / 86400000);
  const tag = expired ? 'Expired' : daysLeft <= 3 ? 'Ending soon' : o.venue_name ? `Only at ${o.venue_name}` : 'All venues';
  const line = o.min_amount > 0 ? `On bookings above ${money(o.min_amount)}` : 'On any booking';
  return (
    <article aria-label={`Coupon ${o.code}`} className={`relative flex flex-col overflow-hidden rounded-2xl border border-brand/40 shadow-card sm:flex-row ${expired ? 'opacity-60 grayscale' : ''}`}>
      <div className="pitch-stripes relative flex-1 overflow-hidden bg-gradient-to-br from-[#101B5C] via-[#1B2A80] to-[#101B5C] p-5 text-white sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[#7200FF]/25 blur-3xl" aria-hidden="true" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-4 right-3 select-none text-7xl opacity-30">⚽</span>
        <div className="relative space-y-3">
          <span className="inline-flex max-w-full items-center truncate rounded-full bg-[#7200FF] px-3 py-1 text-xs font-bold text-[#101B5C]">{tag}</span>
          <Headline o={o} />
          <p className="text-sm text-white/80">{line}{o.discount_type === 'percent' && o.max_discount ? `, up to ${money(o.max_discount)} off` : ''}</p>
          {o.description && <p className="text-xs text-white/60">{o.description}</p>}
          <p className="flex items-center gap-2 text-sm text-white/80"><CalendarIcon />Valid till {fmtDate(o.valid_to)}</p>
          <ul className="space-y-0.5 text-xs text-white/60"><li>{o.venue_name ? `Only at ${o.venue_name}` : 'All venues and sports'}</li>
            <li>{o.per_user_limit === 1 ? 'One use per customer' : `Up to ${o.per_user_limit} uses per customer`}{o.uses_left != null ? ` · ${o.uses_left} uses left in total` : ''}{o.used_by_me > 0 ? ` · You used it ${o.used_by_me}×` : ''}</li></ul>
        </div>
      </div>
      <div className="relative flex shrink-0 flex-col justify-center gap-3 border-t border-dashed border-brand/50 bg-surface p-5 sm:w-56 sm:border-l sm:border-t-0">
        <span aria-hidden="true" className="absolute -left-3 -top-3 hidden h-6 w-6 rounded-full border border-brand/40 bg-bg sm:block" />
        <span aria-hidden="true" className="absolute -bottom-3 -left-3 hidden h-6 w-6 rounded-full border border-brand/40 bg-bg sm:block" />
        <p className="text-sm text-muted">Code</p>
        <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-dashed border-brand/60 px-3 py-2">
          <span className="truncate font-display text-xl font-bold tracking-wider text-ink">{o.code}</span>
          <button type="button" onClick={() => onCopy(o.code)} aria-label={`Copy ${o.code}`} className="rounded-md p-1 text-muted hover:text-ink"><CopyIcon /></button>
        </div>
        {!expired && <button type="button" onClick={() => onUse(o)} className="btn-primary w-full justify-center">Use Now <span aria-hidden="true">→</span></button>}
      </div>
    </article>
  );
}

export function OffersPage() {
  const { toast } = useToast(); const nav = useNavigate();
  const [tab, setTab] = useState<'live' | 'expired'>('live');
  const q = useQuery({ queryKey: ['offers', tab], queryFn: () => get<{ offers: any[] }>('/offers', tab === 'expired' ? { expired: 1 } : {}) });
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(code); toast(`${code} copied`); } catch { toast(`Your code is ${code}`, 'info'); } };
  const apply = (o: any) => { try { sessionStorage.setItem('playnx_coupon', o.code); } catch { /* ignore */ } toast(`${o.code} will be filled in at checkout`, 'info'); nav(o.venue_id ? `/venues/${o.venue_id}` : '/venues'); };
  return (
    <div className="space-y-6">
      <PageHeader title="Offers & coupons" subtitle="Available offers for your next booking. Codes are checked again when you pay" />
      <div className="max-w-xs"><Tabs tabs={[{ id: 'live', label: 'Available' }, { id: 'expired', label: 'Expired' }]} value={tab} onChange={setTab} /></div>
      <QueryBoundary q={q} empty={(d) => d.offers.length === 0 && <Empty icon="🏷️" title={tab === 'live' ? 'No offers right now' : 'No expired offers'} hint="Check back soon for new offers." />}>
        {(d) => <div className="grid gap-5 xl:grid-cols-2">{d.offers.map((o) => <CouponTicket key={o.id} o={o} expired={tab === 'expired'} onCopy={copy} onUse={apply} />)}</div>}
      </QueryBoundary>
    </div>
  );
}

/* ------------------------------------------------------------------ Payments */
export function PaymentsPage() {
  const q = useQuery({ queryKey: ['my-payments'], queryFn: () => get<any>('/me/payments') });
  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle="Your transactions and refunds" />
      {q.isLoading ? <Loading /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (() => {
        const d = q.data; const s = d.summary;
        return (<>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"><Stat label="Total paid" value={money(s.paid_total)} accent /><Stat label="Successful" value={s.successful} /><Stat label="Pending" value={s.pending} /><Stat label="Failed" value={s.failed} /></div>
          <Card className="overflow-x-auto p-0"><h2 className="p-5 pb-2 text-2xl font-bold">Transactions</h2>
            {d.payments.length === 0 ? <div className="p-5 pt-0"><Empty icon="💳" title="No payments yet" hint="Payments for your bookings appear here." /></div> : (
              <table className="w-full min-w-[40rem] text-left text-sm"><thead><tr className="text-xs uppercase text-muted"><th className="px-5 py-2">Transaction</th><th>Booking</th><th>Method</th><th>Date</th><th>Amount</th><th className="pr-5">Status</th></tr></thead>
                <tbody>{d.payments.map((p: any) => <tr key={p.id} className="border-t border-line"><td className="px-5 py-2 font-mono text-xs">{p.transaction_id ?? p.order_id}</td><td><Link className="font-semibold underline" to={`/bookings/${p.booking_id}`}>{p.reference}</Link><div className="text-xs text-muted">{p.venue_name}</div></td>
                  <td>{p.method ? titleCase(p.method) : '—'}</td><td>{fmtDateTime(p.paid_at ?? p.created_at)}</td><td className="font-semibold">{money(p.amount)}</td><td className="pr-5"><Badge status={p.status} /></td></tr>)}</tbody></table>)}</Card>
          <Card className="space-y-3 p-5"><h2 className="text-2xl font-bold">Refunds</h2>
            {d.refunds.length === 0 ? <p className="text-sm text-muted">No refunds.</p> : <ul className="divide-y divide-line text-sm">{d.refunds.map((r: any) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><Link className="font-semibold underline" to={`/bookings/${r.booking_id}`}>{r.reference}</Link> · {r.venue_name}<span className="block text-xs text-muted">Requested {fmtDateTime(r.created_at)}{r.processed_at ? ` · processed ${fmtDateTime(r.processed_at)}` : ''}</span></span>
                <span className="flex items-center gap-2"><b>{money(r.amount)}</b><Badge status={r.status} /></span></li>))}</ul>}</Card>
        </>);
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------ Reviews */
const CATS = [['groundRating', 'Ground quality'], ['cleanlinessRating', 'Cleanliness'], ['facilitiesRating', 'Facilities'], ['staffRating', 'Staff experience']] as const;

export function ReviewForm({ bookingId, review, venueName, onClose }: { bookingId?: string; review?: any; venueName: string; onClose(): void }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ rating: review?.rating ?? 0, comment: review?.comment ?? '', groundRating: review?.ground_rating ?? 0, cleanlinessRating: review?.cleanliness_rating ?? 0, facilitiesRating: review?.facilities_rating ?? 0, staffRating: review?.staff_rating ?? 0 });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const body = { rating: f.rating, comment: f.comment.trim() || undefined, ...Object.fromEntries(CATS.map(([k]) => [k, (f as any)[k] || undefined])) };
      return review ? put(`/reviews/${review.id}`, body) : post('/me/reviews', { ...body, bookingId });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-reviews'] }); qc.invalidateQueries({ queryKey: ['bookings'] }); toast(review ? 'Review updated' : 'Thanks for your review'); onClose(); },
    onError: (e) => setErr(apiError(e)),
  });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(''); if (!f.rating) return setErr('Choose an overall rating'); save.mutate(); }}>
      <p className="text-sm text-muted">{venueName}</p>
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Overall rating *</p><StarInput value={f.rating} onChange={(v) => setF({ ...f, rating: v })} /></div>
      <div className="grid gap-3 sm:grid-cols-2">{CATS.map(([k, label]) => <div key={k}><p className="mb-1 text-xs text-muted">{label} (optional)</p><StarInput value={(f as any)[k]} onChange={(v) => setF({ ...f, [k]: v })} /></div>)}</div>
      <Textarea label="Your review" value={f.comment} maxLength={1000} onChange={(e) => setF({ ...f, comment: e.target.value })} placeholder="What was it like to play here?" />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>{review ? 'Save review' : 'Submit review'}</Button></div>
    </form>
  );
}

export function MyReviewsPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-reviews'], queryFn: () => get<{ reviews: any[]; toReview: any[] }>('/me/reviews') });
  const [edit, setEdit] = useState<{ booking?: any; review?: any } | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => del(`/reviews/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-reviews'] }); toast('Review deleted'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div className="space-y-6">
      <PageHeader title="My reviews" subtitle="Rate the turfs you have played at" />
      {q.isLoading ? <Loading /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (() => { const d = q.data!; return (<>
        <Card className="space-y-3 p-5"><h2 className="text-2xl font-bold">Waiting for your review</h2>
          {d.toReview.length === 0 ? <p className="text-sm text-muted">Nothing to review yet. Once you have played a booked game, it shows up here with a star rating and comment box. Until then you can see the review box on any turf page.</p> : <ul className="divide-y divide-line">{d.toReview.map((b) => (
            <li key={b.booking_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><b>{b.venue_name}</b> · {b.area_name}<span className="block text-xs text-muted">{fmtDate(b.starts_at)} · {b.reference}</span></span><Button className="!py-1.5" onClick={() => setEdit({ booking: b })}>Write a review</Button></li>))}</ul>}</Card>
        <Card className="space-y-3 p-5"><h2 className="text-2xl font-bold">Your reviews</h2>
          {d.reviews.length === 0 ? <Empty icon="⭐" title="No reviews yet" hint="Your reviews help other players choose." /> : <ul className="divide-y divide-line">{d.reviews.map((r) => (
            <li key={r.id} className="space-y-1 py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><Link className="text-lg font-bold underline" to={`/venues/${r.venue_id}`}>{r.venue_name}</Link><Stars value={r.rating} /></div>
              {r.comment && <p>{r.comment}</p>}
              <p className="text-xs text-muted">{CATS.filter(([k]) => r[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]).map(([k, l]) => `${l} ${r[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]}/5`).join(' · ')}</p>
              {r.owner_reply && <p className="rounded-lg bg-surface2 p-2 text-xs"><b>Owner replied:</b> {r.owner_reply}</p>}
              <div className="flex items-center gap-2 text-xs text-muted"><span>{fmtDate(r.created_at)}{r.updated_at ? ' (edited)' : ''}</span><button className="underline" onClick={() => setEdit({ review: r })}>Edit</button><button className="text-danger underline" onClick={() => window.confirm('Delete this review?') && remove.mutate(r.id)}>Delete</button></div></li>))}</ul>}</Card></>); })()}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.review ? 'Edit your review' : 'Write a review'}>
        {edit && <ReviewForm bookingId={edit.booking?.booking_id} review={edit.review} venueName={edit.booking?.venue_name ?? edit.review?.venue_name} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ Settings */
const PREF_KEY = 'playnx_pref_sports';
export function SettingsPage() {
  const { user, setUser } = useAuth(); const nav = useNavigate();
  const { theme, toggle } = useTheme(); const { toast } = useToast(); const qc = useQueryClient();
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string; slug: string }[] }>('/sports'), staleTime: Infinity });
  const prof = useQuery({ queryKey: ['profile'], queryFn: () => get<{ user: any; profile: any }>('/me/profile') });
  const history = useQuery({ queryKey: ['login-history'], queryFn: () => get<{ history: { action: string; ip: string | null; created_at: string }[] }>('/me/login-history') });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [city, setCity] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? '[]'); } catch { return []; } });
  const togglePref = (slug: string) => { const n = prefs.includes(slug) ? prefs.filter((s) => s !== slug) : [...prefs, slug]; setPrefs(n); try { localStorage.setItem(PREF_KEY, JSON.stringify(n)); } catch { /* ignore */ } put('/me/profile', { preferredSports: n }).then(() => qc.invalidateQueries({ queryKey: ['profile'] })).catch((e) => toast(apiError(e), 'error')); };
  const changePw = useMutation({ mutationFn: () => post('/auth/change-password', pw), onSuccess: (r: any) => { if (r?.token) setToken(r.token); setPw({ currentPassword: '', newPassword: '' }); toast('Password updated. Other devices were signed out'); }, onError: (e) => toast(apiError(e), 'error') });
  const logoutAll = useMutation({ mutationFn: () => post<{ token: string }>('/auth/logout-all'), onSuccess: (r) => { if (r?.token) setToken(r.token); toast('Signed out of all other devices'); }, onError: (e) => toast(apiError(e), 'error') });
  const saveCity = useMutation({ mutationFn: () => put('/me/profile', { city: (city ?? '').trim() }), onSuccess: (r: any) => { setUser(r.user); toast('Preferred location saved'); }, onError: (e) => toast(apiError(e), 'error') });
  const deletion = useMutation({ mutationFn: () => post('/me/tickets', { subject: 'Account deletion request', message: 'Please deactivate and delete my PlaynX account and personal data.', priority: 'normal' }), onSuccess: () => { toast('Request sent. Our team will confirm by email'); nav('/support'); }, onError: (e) => toast(apiError(e), 'error') });
  if (!user) return <Loading />;
  const cityVal = city ?? prof.data?.profile?.city ?? '';
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Account, security, preferences and privacy" />
      <Card className="space-y-3 p-6"><h2 className="text-2xl font-bold">Account</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm"><dt className="text-muted">Email</dt><dd>{user.email} {user.emailVerified ? <Badge status="verified" /> : <Badge status="pending">Not verified</Badge>}</dd><dt className="text-muted">Mobile</dt><dd>{user.phone ?? 'Not added'} {user.phone && (user.phoneVerified ? <Badge status="verified" /> : <Badge status="pending">Not verified</Badge>)}</dd></dl>
        <Link to="/profile" className="btn-ghost w-fit">Manage email, mobile and verification</Link></Card>
      <Card className="p-6"><form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); changePw.mutate(); }}><h2 className="text-2xl font-bold">Change password</h2>
        <Input label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
        <Input label="New password" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint="8+ characters with a letter and a number" required />
        <Button type="submit" variant="ghost" loading={changePw.isPending}>Update password</Button></form></Card>
      <Card className="space-y-3 p-6"><h2 className="text-2xl font-bold">Security</h2>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p className="text-muted">Sign out everywhere else. This device stays signed in.</p><Button variant="ghost" loading={logoutAll.isPending} onClick={() => window.confirm('Sign out of all other devices?') && logoutAll.mutate()}>Log out other devices</Button></div>
        <h3 className="pt-2 text-lg font-bold">Recent sign-ins</h3>
        {history.isLoading ? <Loading /> : history.isError ? <ErrorBox error={history.error} /> : (history.data!.history.length === 0 ? <p className="text-sm text-muted">No sign-ins recorded yet.</p> : <ul className="divide-y divide-line text-sm">{history.data!.history.map((h, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span>{h.action === 'user.login_google' ? 'Signed in with Google' : h.action === 'user.login' ? 'Signed in' : titleCase(h.action.replace('user.', ''))}</span><span className="text-muted">{fmtDateTime(h.created_at)}{h.ip ? ` · ${h.ip}` : ''}</span></li>)}</ul>)}
        <p className="text-xs text-muted">Two-factor authentication is not available yet.</p></Card>
      <Card className="space-y-4 p-6"><h2 className="text-2xl font-bold">Preferences</h2>
        <div className="flex items-center justify-between gap-2 text-sm"><span>Theme: <b>{theme === 'dark' ? 'Dark' : 'Light'}</b></span><Button variant="ghost" onClick={toggle}>Switch to {theme === 'dark' ? 'light' : 'dark'}</Button></div>
        <form className="flex items-end gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); saveCity.mutate(); }}><div className="flex-1"><Input label="Preferred location (city)" value={cityVal} onChange={(e) => setCity(e.target.value)} /></div><Button type="submit" variant="ghost" loading={saveCity.isPending}>Save</Button></form>
        <fieldset><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Preferred sports (saved on this device)</legend>
          <div className="flex flex-wrap gap-2">{sports.data?.sports.map((s) => <button type="button" key={s.id} aria-pressed={prefs.includes(s.slug)} onClick={() => togglePref(s.slug)} className={`chip !px-3 !py-1.5 text-sm ${prefs.includes(s.slug) ? '!border-brand bg-brand/15 text-ink' : ''}`}>{s.name}</button>)}</div></fieldset>
        <div className="flex items-center justify-between gap-2 text-sm"><span>Booking and payment notifications arrive in the app and by email.</span></div></Card>
      <Card className="space-y-3 p-6"><h2 className="text-2xl font-bold">Privacy</h2>
        <div className="flex flex-wrap gap-2"><Link to="/privacy" className="btn-ghost">Privacy policy</Link><Link to="/terms" className="btn-ghost">Terms of use</Link></div>
        <p className="text-sm text-muted">To deactivate or delete your account and data, send a request. Our team confirms by email, and bookings with money still owed are settled first.</p>
        <Button variant="danger" loading={deletion.isPending} onClick={() => window.confirm('Send a request to delete your account?') && deletion.mutate()}>Request account deletion</Button></Card>
    </div>
  );
}


/* ------------------------------------------------------------------ Receipt (print or save as PDF) */
export function ReceiptPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['booking', id], queryFn: () => get<{ booking: any; refunds: any[]; addons?: { name: string; unitPrice: number; qty: number }[] }>(`/bookings/${id}`) });
  const invQ = useQuery({ queryKey: ['invoice', id], queryFn: () => get<{ invoice: any }>(`/bookings/${id}/invoice`), retry: false });
  const inv = invQ.data?.invoice; const taxInvoice = inv?.kind === 'tax_invoice';
  const { toast } = useToast(); const [dl, setDl] = useState(false);
  return (
    <QueryBoundary q={q}>{({ booking: b, refunds, addons = [] }) => (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between print:hidden"><Link to={`/bookings/${b.id}`} className="text-sm text-muted hover:text-ink">← Back to booking</Link><span className="flex gap-2"><Button variant="ghost" onClick={() => window.print()}>Print</Button><Button loading={dl} onClick={async () => { setDl(true); try { await downloadReceiptPdf(b, refunds, user?.fullName ?? ''); } catch (e) { toast(apiError(e), 'error'); } finally { setDl(false); } }}>Download PDF</Button></span></div>
        <section aria-label="Receipt"><Card className="space-y-4 p-8 print:border-0 print:shadow-none">
          <div className="flex items-start justify-between gap-3"><div><h1 className="text-4xl font-extrabold">{taxInvoice ? 'Tax invoice' : 'Payment receipt'}</h1><p className="text-sm text-muted">PlaynX · Booking {b.reference}{inv ? ` · ${inv.number}` : ''}</p></div><Badge status={b.payment_status ?? b.status}>{titleCase(b.payment_status ?? b.status)}</Badge></div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[['Customer', user?.fullName ?? ''], ['Venue', b.venue_name], ['Address', `${b.address}, ${b.city}`], ['Playing area', `${b.area_name}${b.sport ? ` · ${b.sport}` : ''}`], ['Date and time', fmtRange(b.starts_at, b.ends_at, b.timezone)], ['Booking status', titleCase(b.status)], ['Transaction ID', b.razorpay_payment_id ?? '—'], ['Issued', fmtDateTime(new Date().toISOString())]].map(([k, v]) => <div key={k}><dt className="text-xs uppercase tracking-wide text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
          </dl>
          <div className="space-y-1 border-t border-line pt-4 text-sm"><div className="flex justify-between"><span className="text-muted">Booking amount</span><span>{money(b.subtotal)}</span></div>
            {b.discount > 0 && <div className="flex justify-between text-ok"><span>Discount</span><span>−{money(b.discount)}</span></div>}
            {addons.map((a) => <div key={a.name} className="flex justify-between"><span className="text-muted">{a.name} × {a.qty}</span><span>{money(a.unitPrice * a.qty)}</span></div>)}
            {taxInvoice && (<>
              <div className="flex justify-between text-muted"><span>Taxable value (SAC {inv.sac})</span><span>{money(inv.taxable)}</span></div>
              <div className="flex justify-between text-muted"><span>CGST @ {inv.rate / 2}%</span><span>{money(inv.cgst)}</span></div>
              <div className="flex justify-between text-muted"><span>SGST @ {inv.rate / 2}%</span><span>{money(inv.sgst)}</span></div></>)}
            {b.advance_amount != null ? (<>
              <div className="flex justify-between font-semibold"><span>Booking total</span><span>{money(b.total)}</span></div>
              <div className="flex justify-between text-xl font-bold"><span>Amount paid (advance {Number(b.total) > 0 ? Math.round((Number(b.advance_amount) / Number(b.total)) * 100) : 0}%)</span><span>{money(b.advance_amount)}</span></div>
              <div className="flex justify-between text-muted"><span>Balance, paid at the venue</span><span>{money(Math.max(0, Number(b.total) - Number(b.advance_amount)))}</span></div></>)
              : <div className="flex justify-between text-xl font-bold"><span>Amount paid</span><span>{money(b.total)}</span></div>}
            {refunds.map((r: any) => <div key={r.id} className="flex justify-between text-xs text-muted"><span>Refund ({r.status})</span><span>−{money(r.amount)}</span></div>)}</div>
          {taxInvoice && <p className="text-xs text-muted">Supplier: {inv.supplier.name} · GSTIN {inv.supplier.gstin}. Price includes GST.</p>}
          <p className="text-xs text-muted">This is a computer-generated {taxInvoice ? 'invoice' : 'receipt'} for your records.</p>
        </Card></section>
      </div>)}</QueryBoundary>
  );
}
