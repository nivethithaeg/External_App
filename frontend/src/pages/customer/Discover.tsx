import { useAutoSlide } from '../../components/PhotoSlider';
import { useEffect, useState, type FormEvent } from 'react';
import { CountUp, Reveal, SlidingTabs } from '../../components/Motion';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { FancyCheckbox, FancySelect, PriceRange, SportCards } from '../../components/FilterControls';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { rememberVenue } from '../../lib/recent';
import { CustomerHome } from './CustomerHome';
import { VenueCard, VenueCover, FavouriteButton, type VenueSummary } from '../../components/VenueCard';
import { BookingWidget, type AreaInfo } from '../../components/BookingWidget';
import { Button, Empty, ErrorBox, Input, Loading, Modal, QueryBoundary, Select, SkeletonCards, StarInput, Stars, Textarea, TimeInput } from '../../components/ui';
import { MapView, VenuesMap, directionsUrl } from '../../lib/maps';
import { categoryOptions } from '../../lib/venueCategories';
import { STATES, citiesOf } from '../../lib/india';
import { cx, DAYS, fmtDate, money, titleCase, todayISO } from '../../lib/utils';
import { ReviewForm } from './Portal';
import { AboutSection, FAQSection, FeaturesSection, FinalCTA, OwnerSection, PlayerBenefits, SportsSection, StepsSection, Testimonials } from './Landing';

interface Sport { id: number; name: string; slug: string }
const SPORT_ICON: Record<string, string> = { football: '⚽', cricket: '🏏', badminton: '🏸', tennis: '🎾', basketball: '🏀', volleyball: '🏐', pickleball: '🏓', hockey: '🏑' };

function useSports() { return useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: Sport[] }>('/sports'), staleTime: Infinity }); }

/** The booking page (/book): admin banners, then choose the venue, its playing area and a slot. Guests reach it from the landing page. */
export function BookPage() {
  const banners = useQuery({ queryKey: ['banners'], queryFn: () => get<{ banners: any[] }>('/banners'), staleTime: 300000 });
  const [bannerIdx, setBannerIdx] = useState(0);
  const bn = banners.data?.banners ?? [];
  useEffect(() => { if (bn.length < 2) return; const id = setInterval(() => setBannerIdx((i) => (i + 1) % bn.length), 5000); return () => clearInterval(id); }, [bn.length]);
  return (
    <div className="space-y-10">
      {bn.length > 0 && (
        <section aria-label="Offers" className="relative grid overflow-hidden rounded-2xl">
          {bn.map((b, i) => (
            <a key={b.id} href={b.link_url ?? '#'} className={`col-start-1 row-start-1 block transition-opacity duration-700 ${i === bannerIdx ? 'opacity-100' : 'pointer-events-none opacity-0'}`} aria-hidden={i !== bannerIdx} tabIndex={i === bannerIdx ? 0 : -1} target={b.link_url ? '_blank' : undefined} rel="noreferrer"><img src={b.image_url} alt={b.title} className="h-40 w-full object-cover sm:h-56" /></a>))}
          {bn.length > 1 && <span key={bannerIdx} aria-hidden="true" className="absolute bottom-0 left-0 h-1 w-full origin-left animate-bar bg-brand/80" />}
          {bn.length > 1 && <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">{bn.map((_, i) => <button key={i} aria-label={`Banner ${i + 1}`} onClick={() => setBannerIdx(i)} className={`h-2 rounded-full transition-all ${i === bannerIdx ? 'w-6 bg-brand' : 'w-2 bg-white/60'}`} />)}</div>}
        </section>)}
      <HomeBooking />
    </div>
  );
}

/**
 * Booking from the home page: choose the venue, see its playing areas, pick one and book a slot. It takes the place of the
 * Explore page (the list of every turf with filters).
 */
export function HomeBooking() {
  // the filters live here on home: narrow the venues by city and sport, then choose one
  // the customer fills the filters (draft) and presses Filter; any one field on its own is enough
  const [draft, setDraft] = useState({ state: '', city: '', sport: '', date: '', from: '', to: '' });
  const [flt, setFlt] = useState({ state: '', city: '', sport: '', date: '', from: '', to: '' });
  const [fErr, setFErr] = useState('');
  const t12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const applyFilters = () => { setFErr(''); if (draft.from && draft.to && draft.to <= draft.from) return setFErr('To time must be after From time.'); setFlt(draft); setVenueId(''); setAreaId(undefined); };
  const sportsQ = useSports();
  const list = useQuery({ queryKey: ['venues', 'home-book', flt], queryFn: () => get<{ venues: VenueSummary[] }>('/venues', { limit: 50, ...(flt.state ? { state: flt.state } : {}), ...(flt.city ? { city: flt.city } : {}), ...(flt.sport ? { sport: flt.sport } : {}), ...(flt.date ? { date: flt.date } : {}), ...(flt.from ? { from: flt.from } : {}), ...(flt.to ? { to: flt.to } : {}) }), enabled: !flt.from || !flt.to || flt.to > flt.from });
  const [venueId, setVenueId] = useState('');
  const [areaId, setAreaId] = useState<string | undefined>(undefined);
  const det = useQuery({ queryKey: ['venue', venueId], enabled: !!venueId, queryFn: () => get<{ venue: any }>(`/venues/${venueId}`) });
  const v0 = det.data?.venue;
  // the playing areas shown follow the filters: with a sport chosen, only the areas that offer that sport
  const sportPick = (sportsQ.data?.sports ?? []).find((x) => x.slug === flt.sport);
  const v = v0 && sportPick ? { ...v0, areas: (v0.areas ?? []).filter((a: any) => (a.sports ?? []).some((x: any) => x.id === sportPick.id))
    .map((a: any) => ({ ...a, sports: [...a.sports].sort((x: any, y: any) => (x.id === sportPick.id ? -1 : y.id === sportPick.id ? 1 : 0)) })) } : v0; // the chosen sport comes first in the booking box
  // only one venue matches the filters: choose it straight away
  useEffect(() => { const vs = list.data?.venues ?? []; if (!venueId && vs.length === 1) setVenueId(vs[0].id); }, [list.data, venueId]);
  useEffect(() => { if (window.location.hash === '#book') setTimeout(() => document.getElementById('book')?.scrollIntoView?.({ behavior: 'smooth' }), 50); }, []);
  return (
    <section id="book" aria-label="Book a turf" className="brand-panel scroll-mt-24 space-y-5 p-5 sm:p-8">
      <div><p className="mb-1 text-xs font-bold uppercase tracking-[.25em] text-[rgb(var(--brand-text))]">Book your game</p><h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Find Your Perfect <span className="bg-gradient-to-r from-[#7200FF] to-[#A100FF] bg-clip-text text-transparent">Playing Spot</span></h2><p className="text-sm text-muted">Filter by any detail you like, then choose a turf, its playing area and your slot.</p></div>
      <form className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(4,minmax(9rem,1fr))_auto_auto_auto] [&_[role=group]]:flex-nowrap" role="group" aria-label="Filters" noValidate onSubmit={(e) => { e.preventDefault(); applyFilters(); }}>
        <Select label="State" value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value, city: '' })}><option value="">All states</option>{STATES.map((st) => <option key={st} value={st}>{st}</option>)}</Select>
        <Select label="City" value={draft.city} disabled={!draft.state} onChange={(e) => setDraft({ ...draft, city: e.target.value })}><option value="">{draft.state ? 'All cities' : 'Select a state first'}</option>{citiesOf(draft.state).map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select label="Sport" value={draft.sport} onChange={(e) => setDraft({ ...draft, sport: e.target.value })}><option value="">All sports</option>{(sportsQ.data?.sports ?? []).map((x) => <option key={x.id} value={x.slug}>{x.name}</option>)}</Select>
        <Input label="Date" type="date" min={todayISO()} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        <div className="col-span-2 sm:col-span-1 xl:col-span-1"><TimeInput label="From time" value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} /></div>
        <div className="col-span-2 sm:col-span-1 xl:col-span-1"><TimeInput label="To time" value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} /></div>
        <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-1"><Button type="submit" className="!py-2.5">Filter</Button>
          {(draft.state || draft.city || draft.sport || draft.date || draft.from || draft.to || flt.state || flt.city || flt.sport || flt.date || flt.from || flt.to) && <button type="button" className="text-sm font-semibold text-[rgb(var(--brand-text))] underline" onClick={() => { setDraft({ state: '', city: '', sport: '', date: '', from: '', to: '' }); setFlt({ state: '', city: '', sport: '', date: '', from: '', to: '' }); setFErr(''); setVenueId(''); setAreaId(undefined); }}>Clear</button>}</div>
        {fErr && <p role="alert" className="col-span-full text-sm text-danger">{fErr}</p>}
      </form>
      <section aria-label="Turfs" className="space-y-2">{list.isLoading ? <Loading /> : list.isError ? <ErrorBox error={list.error} retry={() => list.refetch()} /> : (list.data?.venues.length ?? 0) === 0
        ? (flt.city || flt.sport || flt.date || flt.from || flt.to
          ? <div role="status" className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm"><b className="block text-base">No slots available for your search.</b><span className="text-muted">No turf has a free slot{flt.date ? ` on ${fmtDate(`${flt.date}T12:00:00Z`)}` : ''}{flt.from || flt.to ? ` between ${flt.from ? t12(flt.from) : 'opening'} and ${flt.to ? t12(flt.to) : 'closing'}` : ''}{flt.sport ? ` for ${sportPick?.name ?? flt.sport}` : ''}{flt.city ? ` in ${flt.city}` : ''}. Try another date, time or sport.</span></div>
          : <p className="text-sm text-muted">No turfs are open for booking yet.</p>)
        : (<><p className="text-sm text-muted">{list.data!.venues.length} turf{list.data!.venues.length === 1 ? '' : 's'}{flt.city || flt.sport || flt.date || flt.from || flt.to ? ' match your filters' : ''}. Choose one to see its playing areas.</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...list.data!.venues].sort((x, y) => x.name.localeCompare(y.name)).map((x) => (
            <li key={x.id}><button type="button" aria-pressed={venueId === x.id} onClick={() => { setVenueId(x.id); setAreaId(undefined); setTimeout(() => document.getElementById('home-areas')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50); }}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${venueId === x.id ? 'border-brand bg-brand/10' : 'border-line hover:border-brand/60'}`}>
              <span className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-surface2">{x.cover_image ? <img src={x.cover_image} alt="" className="h-full w-full object-cover" /> : null}</span>
              <span className="min-w-0 flex-1"><b className="block truncate text-base">{x.name}</b><span className="block truncate text-xs text-muted">{[x.address, x.city].filter(Boolean).join(', ')}</span>
</span>
              {venueId === x.id && <span className="text-xs font-semibold text-[rgb(var(--brand-text))]">Selected</span>}</button></li>))}</ul></>)}
      </section>
      {venueId && (det.isLoading ? <Loading /> : det.isError ? <ErrorBox error={det.error} retry={() => det.refetch()} /> : v && (
        v.areas.length === 0 ? <Empty title="No playing areas" hint={sportPick ? `${v.name} has no playing area for ${sportPick.name}. Choose another sport or venue.` : 'This venue has no playing area open for booking yet.'} /> : (
          <div className="space-y-8">
            <section id="home-areas" aria-label="Playing areas" className="scroll-mt-24"><h3 className="mb-1 text-2xl font-bold">Playing areas at {v.name}</h3><p className="mb-3 text-sm text-muted">{areaId ? 'Pick your slot, or choose another playing area.' : 'Choose a playing area to see its free slots and book.'}</p>
              <div className="grid gap-4 sm:grid-cols-2">{v.areas.map((a: any) => <AreaCard key={a.id} pct={v.discount_percent ?? 0} a={a} selected={areaId === a.id} onBook={() => { setAreaId(a.id); setTimeout(() => document.getElementById('home-book-slot')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50); }} />)}</div></section>
            {areaId && <section id="home-book-slot" className="scroll-mt-24 border-t border-line pt-6"><BookingWidget wide key={`${areaId}-${flt.date}-${flt.from}-${flt.to}`} venueId={v.id} venueName={v.name} areas={v.areas as AreaInfo[]} timezone={v.timezone} areaId={areaId} onAreaChange={setAreaId} discountPercent={v.discount_percent ?? 0} advancePercent={v.advance_percent ?? null} startDate={flt.date || undefined} timeFrom={flt.from || undefined} timeTo={flt.to || undefined} /></section>}
          </div>)))}
    </section>);
}

export function HomePage() {
  const { user } = useAuth();
  return user?.role === 'customer' ? <CustomerHome /> : <BookPage />;
}

/** Filter keys the drawer controls; the search box and sort live outside it. */
const FILTER_KEYS = ['city', 'state', 'sport', 'minPrice', 'maxPrice', 'minRating', 'facilities', 'category', 'date', 'from', 'to'] as const;
const RATINGS = [{ v: '4', label: '4+' }, { v: '4.5', label: '4.5+' }, { v: '5', label: '5' }];
const fmtPrice = (n: string) => `₹${Number(n)}`;

export function VenuesPage() {
  const [sp, setSp] = useSearchParams();
  const sports = useSports();
  const params = Object.fromEntries(sp.entries());
  const page = +(params.page ?? 1);
  const q = useQuery({ queryKey: ['venues', params], queryFn: () => get<{ venues: VenueSummary[]; total: number; limit: number }>('/venues', { ...params, limit: 12 }), placeholderData: (p) => p });
  const cities = useQuery({ queryKey: ['cities'], queryFn: () => get<{ cities: { city: string; venues: number }[] }>('/cities'), staleTime: 300000 });
  const facilities = useQuery({ queryKey: ['facilities'], queryFn: () => get<{ facilities: { id: number; name: string }[] }>('/facilities'), staleTime: Infinity });
  const set = (k: string, v: string) => setSp((old) => { const n = new URLSearchParams(old); v ? n.set(k, v) : n.delete(k); if (k !== 'page') n.delete('page'); return n; }, { replace: true });
  const [locating, setLocating] = useState(false);
  const [view, setView] = useState<'grid' | 'list' | 'map'>('grid');
  const [open, setOpen] = useState(false); const [applying, setApplying] = useState(false); const [resetKey, setResetKey] = useState(0);
  const [term, setTerm] = useState(params.q ?? '');
  useEffect(() => setTerm(params.q ?? ''), [params.q]);

  // ---- the drawer edits a draft; Apply writes it to the address bar (and so to the listing)
  const fromParams = () => Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k] ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const [draft, setDraft] = useState(fromParams);
  const upd = (k: (typeof FILTER_KEYS)[number], v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const openDrawer = () => { setDraft(fromParams()); setOpen(true); };
  const apply = () => {
    setApplying(true);
    setSp((old) => { const n = new URLSearchParams(old); FILTER_KEYS.forEach((k) => (draft[k] ? n.set(k, draft[k]) : n.delete(k))); n.delete('page'); return n; }, { replace: true });
  };
  const clearAll = () => { setSp((old) => { const n = new URLSearchParams(); if (old.get('sort')) n.set('sort', old.get('sort')!); return n; }, { replace: true }); setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as typeof draft); setResetKey((n) => n + 1); };
  useEffect(() => { // close the drawer once the new listing has arrived (never leaves the button stuck)
    if (!applying || q.isFetching) return; const t = setTimeout(() => { setApplying(false); setOpen(false); }, 350); return () => clearTimeout(t);
  }, [applying, q.isFetching]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && !applying && setOpen(false); document.addEventListener('keydown', k); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; }; }, [open, applying]);

  const near = () => { setLocating(true); navigator.geolocation?.getCurrentPosition((p) => { setLocating(false); setSp((old) => { const n = new URLSearchParams(old); n.set('lat', p.coords.latitude.toFixed(5)); n.set('lng', p.coords.longitude.toFixed(5)); n.set('sort', 'distance'); n.set('radiusKm', '25'); n.delete('page'); return n; }); }, () => setLocating(false)); };
  const hasGeo = !!params.lat;

  // ---- the chips always mirror what is applied
  const sportName = (slug: string) => sports.data?.sports.find((s) => s.slug === slug)?.name ?? slug;
  const facName = (id: string) => facilities.data?.facilities.find((f) => String(f.id) === id)?.name ?? id;
  const chips: { key: string; label: string; remove(): void }[] = [];
  if (params.q) chips.push({ key: 'q', label: `“${params.q}”`, remove: () => set('q', '') });
  if (params.sport) chips.push({ key: 'sport', label: sportName(params.sport), remove: () => set('sport', '') });
  if (params.city) chips.push({ key: 'city', label: params.city, remove: () => set('city', '') });
  if (params.state) chips.push({ key: 'state', label: params.state, remove: () => setSp((o) => { const n = new URLSearchParams(o); n.delete('state'); n.delete('city'); n.delete('page'); return n; }, { replace: true }) });
  if (params.minPrice || params.maxPrice) chips.push({ key: 'price', label: `${params.minPrice ? fmtPrice(params.minPrice) : '₹0'} - ${params.maxPrice ? fmtPrice(params.maxPrice) : 'any'}`, remove: () => setSp((o) => { const n = new URLSearchParams(o); n.delete('minPrice'); n.delete('maxPrice'); n.delete('page'); return n; }, { replace: true }) });
  if (params.minRating) chips.push({ key: 'rating', label: `${params.minRating}★ & up`, remove: () => set('minRating', '') });
  (params.facilities ? params.facilities.split(',') : []).forEach((id) => chips.push({ key: `f${id}`, label: facName(id), remove: () => set('facilities', params.facilities.split(',').filter((x) => x !== id).join(',')) }));
  if (params.category) chips.push({ key: 'category', label: params.category, remove: () => set('category', '') });
  if (params.date) chips.push({ key: 'date', label: fmtDate(params.date), remove: () => set('date', '') });
  if (params.from || params.to) chips.push({ key: 'time', label: `${params.from ?? ''}–${params.to ?? ''}`.replace(/^–|–$/g, ''), remove: () => setSp((o) => { const n = new URLSearchParams(o); n.delete('from'); n.delete('to'); n.delete('page'); return n; }, { replace: true }) });
  if (hasGeo) chips.push({ key: 'near', label: 'Near me', remove: () => setSp((o) => { const n = new URLSearchParams(o); ['lat', 'lng', 'radiusKm'].forEach((k) => n.delete(k)); if (n.get('sort') === 'distance') n.delete('sort'); n.delete('page'); return n; }, { replace: true }) });
  const filterCount = chips.filter((c) => c.key !== 'q').length;

  const orderedSports = sports.data?.sports ?? []; // already in the site's sport order (Cricket, Football, Badminton, then the rest)
  const facList = new Set(draft.facilities ? draft.facilities.split(',') : []);
  const toggleFac = (id: string, on: boolean) => { on ? facList.add(id) : facList.delete(id); upd('facilities', [...facList].sort((a, b) => +a - +b).join(',')); };
  const sig = q.data ? q.data.venues.map((v) => v.id).join(',') + view : 'loading';

  return (
    <MotionConfig reducedMotion="user">
    <div>
      {/* ---- hero + search + active chips */}
      <section aria-label="Find a turf" className="relative mb-6 overflow-hidden rounded-3xl border border-line">
        <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: "linear-gradient(180deg, rgb(16 16 16 / .35), rgb(16 16 16 / .92)), url('/hero-stadium.jpg'), radial-gradient(ellipse at 50% -10%, #3a2a1c 0%, #161311 45%, #0b0b0b 100%)", backgroundSize: 'cover', backgroundPosition: 'center' }} />
        <svg aria-hidden="true" viewBox="0 0 800 260" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-90">
          <defs><linearGradient id="lb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A100FF" stopOpacity=".5" /><stop offset="1" stopColor="#7200FF" stopOpacity="0" /></linearGradient></defs>
          {[90, 230, 570, 710].map((x) => <g key={x}><rect x={x - 22} y="14" width="44" height="9" rx="2" fill="#fff4e6" /><path d={`M${x - 22} 23 L${x - 120} 260 H${x + 120} L${x + 22} 23Z`} fill="url(#lb)" /></g>)}
          <g fill="none" stroke="#A100FF" strokeOpacity=".22" strokeWidth="2"><path d="M0 225 Q400 170 800 225" /><path d="M0 245 Q400 195 800 245" /></g>
        </svg>
        <div className="relative px-5 py-10 text-center sm:py-14">
          <h1 className="font-display text-4xl font-extrabold uppercase leading-[1.05] sm:text-6xl">Book Your Favourite <span className="text-[#7200FF]">Turf</span> Today!</h1>
          <p className="mt-2 text-sm font-semibold tracking-[.2em] text-white/75">Play&nbsp;•&nbsp;Connect&nbsp;•&nbsp;Enjoy</p>
          <form role="search" aria-label="Search turfs" className="mx-auto mt-6 flex max-w-2xl items-center gap-2 rounded-2xl border border-white/15 bg-black/55 p-1.5 backdrop-blur transition focus-within:border-[#7200FF] focus-within:shadow-[0_0_0_3px_rgb(255_101_0/.22)]"
            onSubmit={(e) => { e.preventDefault(); set('q', term.trim()); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="ml-3 shrink-0 text-white/60" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input aria-label="Search turfs" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search turfs by name, area or city" className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm text-white outline-none placeholder:text-white/45" />
            <button type="submit" className="rounded-xl bg-[#7200FF] px-5 py-2.5 text-sm font-bold text-[#0B1340] transition hover:scale-[1.03] hover:shadow-[0_0_18px_rgb(255_101_0/.5)] active:scale-95">Search</button>
            <button type="button" onClick={openDrawer} className="relative flex items-center gap-1.5 rounded-xl border border-white/20 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:border-[#7200FF] hover:text-[#A100FF] active:scale-95">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>Filters
              {filterCount > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#7200FF] px-1 text-[10px] font-bold text-[#0B1340]">{filterCount}</span>}</button>
          </form>
          <AnimatePresence>{chips.length > 0 && (
            <motion.ul key="chips" aria-label="Applied filters" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-2">
              <AnimatePresence initial={false} mode="popLayout">{chips.map((c) => (
                <motion.li key={c.key} layout initial={{ opacity: 0, scale: 0.8, x: -10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.22 }}>
                  <button type="button" onClick={c.remove} aria-label={`Remove filter ${c.label}`} className="flex items-center gap-1.5 rounded-full border border-[#7200FF]/70 bg-black/45 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur transition hover:bg-[#7200FF]/15 active:scale-95">{c.label}<span aria-hidden="true" className="text-[#7200FF]">✕</span></button></motion.li>))}
              <motion.li key="__clear" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><button type="button" onClick={clearAll} className="rounded-full px-3 py-1.5 text-sm font-semibold text-[#A100FF] underline-offset-4 transition hover:underline active:scale-95">Clear All</button></motion.li></AnimatePresence>
            </motion.ul>)}</AnimatePresence>
        </div>
      </section>

      {/* ---- results */}
      <section aria-label="Results">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">{q.data ? <><b className="text-ink"><CountUp key={q.data.total} value={q.data.total} duration={0.6} /></b> turf{q.data.total === 1 ? '' : 's'} found</> : 'Searching…'}</p>
          <div className="flex flex-wrap items-end gap-3"><SlidingTabs<'grid' | 'list' | 'map'> id="view" label="View" value={view} onChange={setView} options={(['grid', 'list', 'map'] as const).map((m) => ({ id: m as 'grid' | 'list' | 'map', label: titleCase(m) }))} />
            <div className="w-40 sm:w-48"><Select label="Sort by" value={params.sort ?? 'rating'} onChange={(e) => set('sort', e.target.value)}><option value="rating">Top rated</option><option value="popular">Most popular</option>{hasGeo && <option value="distance">Nearest</option>}<option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="newest">Newest</option></Select></div></div>
        </div>
        {q.isLoading ? <SkeletonCards /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : q.data!.venues.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
            <motion.div initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }} className="grid h-20 w-20 place-items-center rounded-full bg-[#7200FF]/12 text-4xl ring-1 ring-[#7200FF]/40" aria-hidden="true">🏟️</motion.div>
            <h3 className="text-2xl font-bold">No turfs match these filters</h3>
            <p className="max-w-sm text-sm text-muted">Try a different sport, widen the price range, or choose another location. Turfs appear here as soon as they match.</p>
            <div className="flex flex-wrap justify-center gap-2"><Button onClick={clearAll}>Clear all filters</Button><Button variant="ghost" onClick={openDrawer}>Change filters</Button></div>
          </motion.div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={sig} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {view === 'map' && <div className="mb-5 animate-popIn"><VenuesMap points={q.data!.venues.filter((v) => v.lat != null && v.lng != null).map((v) => ({ id: v.id, name: v.name, lat: +v.lat!, lng: +v.lng! }))} /></div>}
          {view === 'list' ? (
            <ul key={JSON.stringify(params)} className={`space-y-3 ${q.isFetching ? 'opacity-70' : ''}`} aria-label="Turfs">{q.data!.venues.map((v, i) => (
              <li key={v.id} style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }} className="card group flex animate-slideX flex-wrap items-center gap-4 p-3 transition duration-200 hover:-translate-y-0.5 hover:border-brand/50">
                <Link to={`/venues/${v.id}`} className="h-24 w-36 shrink-0 overflow-hidden rounded-xl"><VenueCover src={v.cover_image} name={v.name} className="transition duration-500 group-hover:scale-110" /></Link>
                <div className="min-w-0 flex-1"><Link to={`/venues/${v.id}`} className="text-2xl font-bold hover:underline">{v.name}</Link><p className="text-sm text-muted">{v.address}, {v.city}{v.distance_km != null ? ` · ${v.distance_km} km away` : ''}</p>
                  <p className="text-xs text-muted">{v.rating_count > 0 ? `${Number(v.rating_avg).toFixed(1)}★ (${v.rating_count})` : 'No reviews yet'}{v.sports?.length ? ` · ${v.sports.join(', ')}` : ''}{v.facilities?.length ? ` · ${v.facilities.slice(0, 4).join(', ')}` : ''}</p></div>
                <div className="text-right"><div className="text-xs text-muted">from{(v.discount_percent ?? 0) > 0 && v.min_price != null && <s className="ml-1.5">{money(v.min_price)}</s>}{(v.discount_percent ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-extrabold text-brand-ink">{v.discount_percent}% OFF</span>}</div><div className="font-display text-xl font-bold text-[rgb(var(--brand-text))]">{v.min_price != null ? `${money(Math.round(v.min_price * (100 - (v.discount_percent ?? 0))) / 100)}/hr` : '—'}</div><Link to={`/venues/${v.id}`} className="btn-primary mt-1 !py-1.5">Book now</Link></div>
              </li>))}</ul>
          ) : (
          <div className={`stagger grid gap-5 md:grid-cols-2 ${q.isFetching ? 'opacity-70' : ''}`}>{q.data!.venues.map((v) => <VenueCard key={v.id} v={v} />)}</div>
          )}
            </motion.div>
          </AnimatePresence>)}
        {q.data && q.data.venues.length > 0 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button variant="ghost" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>← Prev</Button>
            <span key={page} className="animate-rise text-sm text-muted">Page {page} of {Math.max(1, Math.ceil(q.data.total / 12))}</span>
            <Button variant="ghost" disabled={page * 12 >= q.data.total} onClick={() => set('page', String(page + 1))}>Next →</Button>
          </div>)}
      </section>

      {/* ---- right-hand filter drawer */}
      <AnimatePresence>
        {open && (<>
          <motion.div key="veil" aria-hidden="true" className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={() => !applying && setOpen(false)} />
          <motion.aside key="drawer" role="dialog" aria-modal="true" aria-label="Filters" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.35 }}
            className="fixed inset-y-0 right-0 z-[61] flex w-full flex-col border-l border-[#7200FF]/60 bg-[#141414] shadow-[-12px_0_48px_-8px_rgb(255_101_0/.25)] sm:w-[440px] sm:rounded-l-3xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="flex items-center gap-2 text-2xl font-bold"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#7200FF]"><path d="M3 5h18l-7 8v6l-4-2v-4z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>Filters</h2>
              <button type="button" onClick={() => setOpen(false)} disabled={applying} aria-label="Close filters" className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted transition hover:rotate-90 hover:border-[#7200FF] hover:text-[#7200FF] active:scale-90">✕</button>
            </div>
            <motion.div key={resetKey} initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.06, delayChildren: 0.12 } } }} className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {([
                ['Location', <div key="l" className="space-y-3">
                  <FancySelect label="State" value={draft.state} onChange={(v) => setDraft((d) => ({ ...d, state: v, city: '' }))} placeholder="All states" options={[{ value: '', label: 'All states' }, ...STATES.map((st) => ({ value: st, label: st }))]} />
                  <FancySelect label="City" value={draft.city} onChange={(v) => upd('city', v)} placeholder={draft.state ? 'All cities' : 'All locations'} options={[{ value: '', label: draft.state ? 'All cities' : 'All locations' }, ...[...new Set([...(draft.city ? [draft.city] : []), ...(draft.state ? citiesOf(draft.state) : (cities.data?.cities ?? []).map((c) => c.city))])].sort((a, b) => a.localeCompare(b)).map((c) => { const n = cities.data?.cities.find((x) => x.city === c)?.venues; return { value: c, label: n ? `${c} (${n})` : c }; })]} />
                  <button type="button" onClick={near} className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2 text-sm font-semibold text-muted transition hover:border-[#7200FF] hover:text-ink active:scale-[.98]">{locating ? <><span className="relative flex h-3 w-3" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7200FF] opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-[#7200FF]" /></span>Finding you…</> : hasGeo ? '📍 Near me is on' : '📍 Use my live location'}</button></div>],
                ['Price range', <PriceRange key="p" min={draft.minPrice ? +draft.minPrice : null} max={draft.maxPrice ? +draft.maxPrice : null} onCommit={(mn, mx) => { upd('minPrice', mn === null ? '' : String(mn)); upd('maxPrice', mx === null ? '' : String(mx)); }} />],
                ['Sports type', <SportCards key="s" sports={orderedSports} value={draft.sport} onChange={(v) => upd('sport', v)} />],
                ['Ratings', <div key="r" role="radiogroup" aria-label="Minimum rating" className="grid grid-cols-3 gap-2">{RATINGS.map((r) => { const on = draft.minRating === r.v; return (
                  <motion.button key={r.v} type="button" role="radio" aria-checked={on} whileTap={{ scale: 0.95 }} onClick={() => upd('minRating', on ? '' : r.v)} className={cx('flex items-center justify-center gap-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200', on ? 'border-[#7200FF] bg-[#7200FF]/10 text-ink shadow-[0_0_14px_rgb(255_101_0/.3)]' : 'border-line text-muted hover:border-[#7200FF]/50 hover:text-ink')}><span className="text-[#7200FF]" aria-hidden="true">★</span>{r.label}</motion.button>); })}</div>],
                ['Amenities', <div key="a" className="grid grid-cols-2 gap-x-3">{(facilities.data?.facilities ?? []).map((f) => <FancyCheckbox key={f.id} label={f.name} checked={facList.has(String(f.id))} onChange={(on) => toggleFac(String(f.id), on)} />)}</div>],
                ['Venue type', <FancySelect key="c" label="Type" value={draft.category} onChange={(v) => upd('category', v)} placeholder="Any type" options={[{ value: '', label: 'Any type' }, ...categoryOptions(draft.category).map((c) => ({ value: c, label: c }))]} />],
                ['Availability', <div key="v" className="space-y-3"><div><label htmlFor="f-date" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Date</label><input id="f-date" type="date" min={todayISO()} className="field" value={draft.date} onChange={(e) => upd('date', e.target.value)} /></div>
                  <div><span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Available between</span><div className="flex flex-wrap items-center gap-2"><TimeInput ariaLabel="From time" value={draft.from} onChange={(v) => upd('from', v)} /><span className="text-sm text-muted">to</span><TimeInput ariaLabel="To time" value={draft.to} onChange={(v) => upd('to', v)} /></div></div></div>],
              ] as [string, React.ReactNode][]).map(([title, body]) => (
                <motion.section key={title} aria-label={title} variants={{ h: { opacity: 0, y: 14 }, s: { opacity: 1, y: 0, transition: { duration: 0.3 } } }}>
                  <h3 className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#A100FF]">{title}</h3>{body}</motion.section>))}
            </motion.div>
            <div className="grid grid-cols-2 gap-3 border-t border-line bg-[#141414] px-5 py-4 sm:rounded-bl-3xl">
              <button type="button" onClick={clearAll} disabled={applying} className="rounded-xl border border-line bg-[#1B1B1B] py-3 text-sm font-bold text-white transition hover:border-white/40 active:scale-[.97] disabled:opacity-50">Clear All</button>
              <button type="button" onClick={apply} disabled={applying} className="flex items-center justify-center gap-2 rounded-xl bg-[#7200FF] py-3 text-sm font-bold text-[#0B1340] shadow-[0_0_0_rgb(255_101_0/0)] transition hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_22px_rgb(255_101_0/.5)] active:scale-95 disabled:pointer-events-none disabled:opacity-80">
                {applying ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0B1340]/30 border-t-[#0B1340]" aria-hidden="true" />Applying…</> : 'Apply Filters'}</button>
            </div>
          </motion.aside>
        </>)}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

/** One playing area as a card: photo, what it offers, what it costs, and a button that selects it in the booking box. */
function AreaCard({ a, selected, onBook, pct = 0 }: { a: any; selected: boolean; onBook(): void; pct?: number }) {
  const [n, setN] = useState(0);
  const photos: { id: string; url: string }[] = a.images ?? [];
  useAutoSlide(photos.length, n, setN, { ms: 4000 });
  const prices = (a.pricing ?? []).map((p: any) => Number(p.price_per_hour)).filter((x: number) => Number.isFinite(x));
  const from = a.from_price != null ? Number(a.from_price) : prices.length ? Math.min(...prices) : null; // the lowest price a customer can really book
  const openDays = (a.availability ?? []).filter((d: any) => !d.is_closed);
  return (
    <article aria-label={`Playing area ${a.name}`} className={`card flex flex-col overflow-hidden transition ${selected ? 'border-brand ring-1 ring-brand' : ''}`}>
      <div className="relative h-44 bg-surface2">
        {photos.length ? <img src={photos[Math.min(n, photos.length - 1)].url} alt={`${a.name} photo ${Math.min(n, photos.length - 1) + 1}`} loading="lazy" className="h-full w-full object-cover" />
          : <div className="pitch-stripes grid h-full place-items-center bg-gradient-to-br from-[#101B5C] via-[#1B2A80] to-[#101B5C] text-5xl" aria-hidden="true">⚽</div>}
        {a.surface && <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">{a.surface}</span>}
        {photos.length > 1 && <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" role="group" aria-label={`${a.name} photos`}>{photos.map((p, i) => <button key={p.id} type="button" aria-label={`Show photo ${i + 1}`} aria-pressed={i === n} onClick={() => setN(i)} className={`h-2 w-2 rounded-full ${i === n ? 'bg-white' : 'bg-white/50'}`} />)}</div>}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2"><h3 className="text-2xl font-bold">{a.name}</h3>
          <div className="text-right">{from !== null ? <><p className="text-xs text-muted">From</p><p className="font-display text-2xl font-extrabold leading-none text-[rgb(var(--brand-text))]">{money(Math.round(from * (100 - pct)) / 100)}<span className="text-xs font-semibold text-muted"> /hr</span></p>{pct > 0 && <p className="text-xs text-muted"><s>{money(from)}</s> <b className="text-brand">{pct}% OFF</b></p>}</> : <p className="text-xs text-muted">Prices coming soon</p>}{prices.length > 0 && Math.max(...prices) > Math.min(...prices) && <p className="text-xs text-muted">up to {money(Math.max(...prices))}/hr</p>}</div></div>
        <p className="text-xs text-muted">{a.capacity ? `Up to ${a.capacity} players · ` : ''}{a.slot_minutes}-min slots · {a.min_duration_minutes}–{a.max_duration_minutes} min bookings</p>
        <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-muted">Sports:</span>{a.sports.length ? a.sports.map((s: any) => <span key={s.id} className="chip">{s.name}</span>) : <span className="text-xs text-muted">Not set yet</span>}</div>
        {(a.pricing ?? []).length > 0 && !(a.pricing ?? []).some((p: any) => p.day_of_week != null) && <ul className="space-y-0.5 text-sm text-muted">{a.pricing.slice(0, 3).map((p: any, i: number) => <li key={i} className="flex justify-between"><span>{p.start_time.slice(0, 5)}–{p.end_time.slice(0, 5)}{p.day_type !== 'all' ? ` · ${p.day_type}` : ''}</span><span className="font-semibold text-ink">{money(p.price_per_hour)}/hr</span></li>)}</ul>}
        {openDays.length > 0 && <p className="text-xs text-muted">Open {openDays.length} day{openDays.length === 1 ? '' : 's'}/week · {openDays[0].open_time.slice(0, 5)}–{openDays[0].close_time.slice(0, 5)}</p>}
        <button type="button" onClick={onBook} aria-pressed={selected} className={`${selected ? 'btn-ghost' : 'btn-primary'} mt-auto w-full justify-center`}>{selected ? '✓ Selected. Pick a slot' : 'Book this area'}</button>
      </div>
    </article>
  );
}

export function VenueDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['venue', id], queryFn: () => get<{ venue: any }>(`/venues/${id}`) });
  const { user: me } = useAuth();
  const mine = useQuery({ queryKey: ['my-reviews'], queryFn: () => get<{ toReview: any[] }>('/me/reviews'), enabled: me?.role === 'customer' });
  const toReview = mine.data?.toReview.find((b) => b.venue_id === id); // a played booking at this venue that has no review yet
  const reviews = useQuery({ queryKey: ['venue-reviews', id], queryFn: () => get<{ reviews: any[] }>(`/venues/${id}/reviews`), enabled: !!id });
  const [active, setActive] = useState(0); const [pano, setPano] = useState(false);
  const [areaId, setAreaId] = useState<string | undefined>(); // the playing area chosen on a card or in the booking box
  const vv = q.data?.venue;
  const [galleryHover, setGalleryHover] = useState(false);
  useAutoSlide(vv?.images?.length ?? 0, active, setActive, { ms: 4500, paused: galleryHover || vv?.images?.[active]?.kind === 'video' }); // the gallery moves on by itself (a playing video or the pointer holds it)
  useEffect(() => { if (vv) rememberVenue({ id: vv.id, name: vv.name, city: vv.city, cover: vv.images?.find((i: any) => i.kind === 'image')?.url ?? null }); }, [vv?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = async () => { const url = window.location.href; try { if (navigator.share) await navigator.share({ title: vv?.name, url }); else { await navigator.clipboard.writeText(url); alert('Link copied'); } } catch { /* cancelled */ } };
  return (
    <QueryBoundary q={q}>{({ venue: v }) => {
      const media: { id: string; url: string; kind: string }[] = v.images;
      const cur = media[active];
      return (
        <div className={areaId ? 'space-y-8' : 'grid gap-8 lg:grid-cols-[1fr_400px]'}>
          <div className="min-w-0 space-y-8">
            <div>
              <div className="relative h-64 overflow-hidden rounded-3xl border border-line sm:h-96" onPointerEnter={() => setGalleryHover(true)} onPointerLeave={() => setGalleryHover(false)}>
                {cur?.kind === 'video' ? <video src={cur.url} controls className="h-full w-full object-cover" /> : media.filter((m) => m.kind !== 'video').length > 1 && cur ? <img key={cur.id} src={cur.url} alt={`${v.name} photo ${active + 1}`} className="h-full w-full animate-fade object-cover" /> : <VenueCover src={cur?.url ?? null} name={v.name} />}
                <div className="absolute right-4 top-4 flex gap-2"><button type="button" onClick={share} aria-label="Share venue" className="grid h-9 w-9 place-items-center rounded-full bg-black/55 text-lg text-white backdrop-blur transition hover:scale-110">↗</button><FavouriteButton venueId={v.id} active={v.is_favourite} /></div>
              </div>
              {v.panorama && <button type="button" className="btn-ghost mt-3" onClick={() => setPano(true)}>🔄 View 360°</button>}
              <Modal open={pano} onClose={() => setPano(false)} title="360° venue view"><p className="mb-2 text-xs text-muted">Scroll sideways to look around.</p><div className="max-h-[70vh] overflow-x-auto rounded-xl"><img src={v.panorama} alt={`${v.name} 360° view`} className="h-72 max-w-none sm:h-96" /></div></Modal>
              {media.length > 1 && <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{media.map((m, i) => (
                <button key={m.id} onClick={() => setActive(i)} aria-label={`Show ${m.kind} ${i + 1}`} className={`h-16 w-24 shrink-0 overflow-hidden rounded-xl border-2 ${i === active ? 'border-brand' : 'border-transparent opacity-70'}`}>
                  {m.kind === 'video' ? <span className="grid h-full place-items-center bg-surface2 text-xl">▶</span> : <img src={m.url} alt="" className="h-full w-full object-cover" />}</button>))}</div>}
            </div>

            <div>
              <h1 className="text-5xl font-extrabold">{v.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
                {v.rating_count > 0 ? <span className="flex items-center gap-1.5"><Stars value={Number(v.rating_avg)} /> {Number(v.rating_avg).toFixed(1)} ({v.rating_count} reviews)</span> : <span className="chip">New</span>}
                <span>📍 {v.address}, {v.city}</span><span className="chip text-ok">✓ PlaynX verified</span><span className="text-xs">Venue ID {String(v.id).slice(0, 8).toUpperCase()}</span>{v.contact_phone && <a href={`tel:${v.contact_phone}`} className="underline">📞 {v.contact_phone}</a>}
              </div>
              {v.description && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted">{v.description}</p>}
            </div>

            {v.facilities.length > 0 && <section><h2 className="mb-3 text-3xl font-bold">Facilities</h2><div className="flex flex-wrap gap-2">{v.facilities.map((f: any) => <span key={f.id} className="chip !px-3 !py-1.5 text-sm text-ink">✓ {f.name}</span>)}</div></section>}

            <section aria-label="Playing areas"><h2 className="mb-3 text-3xl font-bold">Playing areas & pricing</h2>
              <div className="grid gap-4 sm:grid-cols-2">{v.areas.map((a: any) => <AreaCard key={a.id} pct={v.discount_percent ?? 0} a={a} selected={areaId === a.id} onBook={() => { setAreaId(a.id); setTimeout(() => document.getElementById('book-a-slot')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50); }} />)}</div></section>
          {areaId && <section id="book-a-slot" className="scroll-mt-24 rounded-3xl border border-line bg-surface p-5 sm:p-8"><div className="mb-2 flex justify-end"><button type="button" className="text-sm font-semibold text-muted hover:text-ink" onClick={() => setAreaId(undefined)}>✕ Close</button></div><BookingWidget wide key={areaId} venueId={v.id} venueName={v.name} areas={v.areas as AreaInfo[]} timezone={v.timezone} areaId={areaId} onAreaChange={setAreaId} discountPercent={v.discount_percent ?? 0} advancePercent={v.advance_percent ?? null} /></section>}


            <section><h2 className="mb-3 text-3xl font-bold">Reviews</h2>
              <div className="card mb-4 p-4" aria-label="Write a review">
                <h3 className="mb-2 text-xl font-bold">Rate this turf</h3>
                {me?.role !== 'customer' ? <p className="text-sm text-muted"><Link className="font-semibold underline" to="/login">Log in</Link> as a player to rate this turf and write a review.</p>
                  : toReview ? <ReviewForm key={toReview.booking_id} bookingId={toReview.booking_id} venueName={v.name} onClose={() => { reviews.refetch(); mine.refetch(); }} />
                  : (<fieldset disabled className="space-y-3 opacity-60"><StarInput value={0} onChange={() => {}} /><Textarea label="Your review" placeholder="Tell other players about the ground, the staff and the facilities" value="" onChange={() => {}} />
                      <p className="text-sm text-muted">You can rate and review a turf after you have played there. Book a slot here and the review form unlocks once your game is over.</p></fieldset>)}
              </div>
              {reviews.isLoading ? <Loading /> : reviews.isError ? <ErrorBox error={reviews.error} retry={() => reviews.refetch()} /> : reviews.data!.reviews.length === 0 ? <p className="text-sm text-muted">No reviews yet. Be the first after your game.</p> : (
                <div className="space-y-3">{reviews.data!.reviews.map((r) => (
                  <div key={r.id} className="card p-4"><div className="flex items-center justify-between"><span className="font-semibold">{r.author}</span><Stars value={r.rating} size={14} /></div>
                    {r.comment && <p className="mt-1 text-sm text-muted">{r.comment}</p>}<p className="mt-1 text-xs text-muted">{fmtDate(r.created_at)}</p>
                    {r.owner_reply && <p className="mt-2 rounded-lg bg-surface2 p-3 text-sm"><b>Owner reply:</b> {r.owner_reply}</p>}</div>))}</div>)}</section>
          </div>
          {!areaId && <aside className="lg:sticky lg:top-24 lg:h-fit"><div className="card space-y-3 p-5" aria-label="Choose a playing area"><h2 className="text-3xl font-bold">Book a slot</h2><p className="text-sm text-muted">First choose the playing area you want to play in. Its free slots appear here.</p>
                {v.areas.length === 0 ? <p className="text-sm text-muted">No playing area is open for booking yet.</p> : <ul className="space-y-2">{v.areas.map((a: any) => <li key={a.id}><button type="button" onClick={() => { setAreaId(a.id); setTimeout(() => document.getElementById('book-a-slot')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50); }} className="w-full rounded-xl border border-line px-4 py-3 text-left text-sm font-semibold transition hover:border-brand">{a.name}{a.sports?.length ? <span className="block text-xs font-normal text-muted">{a.sports.map((x: any) => x.name).join(', ')}</span> : null}</button></li>)}</ul>}</div></aside>}
        </div>
      );
    }}</QueryBoundary>
  );
}
