import { HomeBooking } from './Discover';
import { useState, type FormEvent } from 'react';
import { CopyCode, Countdown, Reveal, RotatingWord, TitleUnderline } from '../../components/Motion';
import { SportsSection } from './Landing';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, Empty, ErrorBox, Select, SkeletonCards } from '../../components/ui';
import { VenueCard, type VenueSummary } from '../../components/VenueCard';
import { fmtRange, money, todayISO } from '../../lib/utils';
import { recentVenues } from '../../lib/recent';
import { StepsSection } from './Landing';

function Row({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return <Reveal as="section"><div className="mb-4 flex items-end justify-between"><h2 className="text-4xl font-extrabold"><TitleUnderline>{title}</TitleUnderline></h2>{to && <Link to={to} className="text-sm font-semibold text-[rgb(var(--brand-text))] transition hover:translate-x-1">View all →</Link>}</div>{children}</Reveal>;
}

function VenueRow({ params, empty }: { params: Record<string, unknown>; empty: string }) {
  const q = useQuery({ queryKey: ['venues', 'home', params], queryFn: () => get<{ venues: VenueSummary[] }>('/venues', { limit: 6, ...params }) });
  if (q.isLoading) return <SkeletonCards n={3} />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!q.data!.venues.length) return <Empty title={empty} hint="Venues appear here once they are approved and published." />;
  return <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{q.data!.venues.map((v) => <VenueCard key={v.id} v={v} />)}</div>;
}

/** What a signed-in customer sees on the home page: search, offers and venues to explore. */
export function CustomerHome() {
  const { user } = useAuth(); const nav = useNavigate();
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string; slug: string }[] }>('/sports'), staleTime: Infinity });
  const offers = useQuery({ queryKey: ['offers', 'home'], queryFn: () => get<{ offers: any[] }>('/offers') });
  const [f, setF] = useState({ location: '', sport: '', date: '' });
  const recent = recentVenues();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => get<{ profile: { preferred_sports?: string[] } | null }>('/me/profile') });
  const local: string[] = (() => { try { return JSON.parse(localStorage.getItem('kickoff_pref_sports') ?? '[]'); } catch { return []; } })();
  const prefs: string[] = profile.data?.profile?.preferred_sports?.length ? profile.data.profile.preferred_sports : local; // the saved profile wins over this browser's copy
  const [locating, setLocating] = useState(false); const [geoErr, setGeoErr] = useState('');
  // search with the phone's / browser's live position: nearest turfs first, within 25 km, keeping the sport and date chosen above
  const nearMe = () => {
    setGeoErr('');
    if (!navigator.geolocation) return setGeoErr('Your browser cannot share its location. Type an area or city instead.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false);
      const p = new URLSearchParams({ lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), radiusKm: '25', sort: 'distance' });
      if (f.sport) p.set('sport', f.sport); if (f.date) p.set('date', f.date);
      nav(`/venues?${p}`);
    }, (err) => { setLocating(false); setGeoErr(err.code === 1 ? 'Location permission was denied. Allow location access in your browser, or type an area or city.' : 'Could not get your location. Try again, or type an area or city.'); }, { enableHighAccuracy: true, timeout: 15000 });
  };
  const search = (e: FormEvent) => { e.preventDefault(); const p = new URLSearchParams(); if (f.location.trim()) p.set('q', f.location.trim()); if (f.sport) p.set('sport', f.sport); if (f.date) p.set('date', f.date); nav(`/venues?${p}`); };

  return (
    <div className="space-y-12">
      <section className="pitch-stripes relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#151515] via-[#292929] to-[#151515] p-6 text-white sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 animate-drift rounded-full bg-[#FF6B22]/25 blur-3xl" />
        <div className="relative space-y-5">
          <p className="animate-rise text-sm font-semibold text-[#FFC857]">Welcome back, {user?.fullName.split(' ')[0]}</p>
          <h1 style={{ animationDelay: '120ms' }} className="animate-rise font-display text-5xl font-extrabold uppercase leading-[.95] sm:text-7xl">Your game. Your turf.<br /><span className="text-[#FF6B22]">Your time.</span></h1>
          <p className="animate-rise text-lg font-semibold text-white/90" style={{ animationDelay: '220ms' }} aria-hidden="true">Find your next <RotatingWord words={(sports.data?.sports ?? []).map((x) => x.name)} /> turf</p>
          <p className="max-w-xl text-white/75">Discover the best sports turfs around you, check live availability and book your perfect playing slot with KickOff.</p>
          <div className="flex flex-wrap gap-2"><a href="#book" className="btn-primary">Book a turf</a><Link to="/bookings" className="btn border border-white/30 text-white hover:bg-white/10">View my bookings</Link>{(offers.data?.offers?.length ?? 0) > 0 && <Link to="/offers" className="btn border border-white/30 text-white hover:bg-white/10">Explore offers</Link>}</div>
        </div>
      </section>

      <HomeBooking />


      {(offers.data?.offers.length ?? 0) > 0 && (
        <Row title="Special offers" to="/offers">
          <div className="grid gap-4 md:grid-cols-3">{offers.data!.offers.slice(0, 3).map((o, i) => (
            <Link key={o.id} to="/offers" style={{ animationDelay: `${i * 120}ms` }} className="group relative flex animate-slideX overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition duration-200 hover:-translate-y-1 hover:border-brand/50 active:scale-[.985]">
              <span aria-hidden="true" className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-line bg-bg" />
              <span aria-hidden="true" className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-line bg-bg" />
              <div className="min-w-0 flex-1 space-y-1 p-4 pl-5">
                <p className="font-display text-3xl font-extrabold leading-none text-ink">{o.discount_type === 'percent' ? `${o.value}% off` : `${money(o.value)} off`}</p>
                {o.description && <p className="line-clamp-2 text-xs text-muted">{o.description}</p>}
                <div className="pt-1"><Countdown to={o.valid_to} /></div></div>
              <div className="flex w-36 shrink-0 origin-bottom-left flex-col items-center justify-center gap-2 border-l-2 border-dashed border-line bg-brand/10 p-3 transition duration-300 [@media(hover:hover)]:group-hover:translate-x-1 [@media(hover:hover)]:group-hover:rotate-2">
                <span className="sheen rounded-md px-1 font-display text-xl font-bold tracking-wider text-[rgb(var(--brand-text))]">{o.code}</span><CopyCode code={o.code} /></div>
            </Link>))}</div>
        </Row>)}

      {recent.length > 0 && (
        <Row title="Recently viewed">
          <div className="fan -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [@media(hover:hover)]:gap-0" aria-label="Recently viewed turfs">{recent.map((v, i) => (
            <Link key={v.id} to={`/venues/${v.id}`} style={{ animationDelay: `${i * 90}ms` }} className="card flex w-64 shrink-0 snap-start animate-slideX items-center gap-3 p-3 transition hover:-translate-y-0.5 hover:border-brand/50">{v.cover ? <img src={v.cover} alt="" loading="lazy" className="h-14 w-20 rounded-lg object-cover" /> : <div className="grid h-14 w-20 place-items-center rounded-lg bg-surface2">⚽</div>}<div className="min-w-0"><p className="truncate font-bold">{v.name}</p><p className="truncate text-xs text-muted">{v.city}</p></div></Link>))}</div>
        </Row>)}

      <section className="card flex flex-wrap items-center justify-between gap-3 p-6"><div className="flex items-center gap-4"><span className="relative grid h-14 w-14 shrink-0 place-items-center" aria-hidden="true"><span className="absolute inset-0 animate-ping rounded-full bg-brand/25 [animation-duration:2.4s]" /><span className="absolute inset-2 rounded-full bg-brand/15" /><span className="relative text-2xl" style={{ animation: 'drop .8s ease-out .2s both' }}>📍</span></span><div><h2 className="text-3xl font-bold">Turfs near you</h2><p className="text-sm text-muted">See what is close, with distances and directions.</p></div></div><Link to="/nearby" className="btn-primary">Open nearby turfs</Link></section>
      <StepsSection />
    </div>
  );
}
