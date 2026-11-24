import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import { Stars } from '../../components/ui';
import { AutoSlider, PopIcon, Reveal, TitleUnderline } from '../../components/Motion';
import { cx } from '../../lib/utils';

const Eyebrow = ({ children }: { children: ReactNode }) => <p className="mb-2 text-xs font-bold uppercase tracking-[.25em] text-[rgb(var(--brand-text))]">{children}</p>;
const Heading = ({ eyebrow, title, sub, center }: { eyebrow: string; title: string; sub?: string; center?: boolean }) => (
  <div className={cx('mb-8', center && 'text-center')}><Eyebrow>{eyebrow}</Eyebrow><h2 className="text-4xl font-extrabold uppercase sm:text-5xl"><TitleUnderline>{title}</TitleUnderline></h2>{sub && <p className={cx('mt-2 max-w-2xl text-muted', center && 'mx-auto')}>{sub}</p>}</div>
);

/* ------------------------------------------------------------------ About */
export function AboutSection() {
  return (
    <section aria-labelledby="about-h" className="grid items-center gap-8 lg:grid-cols-2">
      <div>
        <Eyebrow>About KickOff</Eyebrow>
        <h2 id="about-h" className="text-4xl font-extrabold uppercase sm:text-6xl">Your game. Your turf. <span className="text-[rgb(var(--brand-text))]">Your time.</span></h2>
        <p className="mt-4 leading-relaxed text-muted">KickOff is an online sports turf booking platform that makes discovering and booking sports facilities easier. Explore different sports venues, compare prices, check slot availability and book your preferred playing time through one convenient platform.</p>
        <div className="mt-6 flex flex-wrap gap-3"><Link to="/venues" className="btn-primary">Explore turfs</Link><Link to="/register" className="btn-ghost">Create free account</Link></div>
      </div>
      <svg viewBox="0 0 480 300" className="w-full rounded-3xl border border-line bg-gradient-to-br from-[#292929] to-[#151515] p-3 shadow-card" role="img" aria-label="Illustration of a floodlit sports pitch with a ball">
        <defs><linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF6B22" stopOpacity=".35" /><stop offset="1" stopColor="#FF6B22" stopOpacity="0" /></linearGradient></defs>
        {[70, 410].map((x) => <g key={x}><rect x={x - 3} y="30" width="6" height="110" fill="#a3a3a3" /><rect x={x - 22} y="22" width="44" height="12" rx="3" fill="#e8eefc" /><path d={`M${x - 22} 34 L${x - 90} 190 H${x + 90} L${x + 22} 34Z`} fill="url(#beam)" /></g>)}
        <rect x="40" y="150" width="400" height="130" rx="14" fill="#2f2f2f" />
        {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={40 + i * 80} y="150" width="40" height="130" fill="#ffffff" opacity=".05" />)}
        <g fill="none" stroke="#FF6B22" strokeWidth="2.5" opacity=".9"><rect x="52" y="162" width="376" height="106" rx="8" /><line x1="240" y1="162" x2="240" y2="268" /><circle cx="240" cy="215" r="26" /><rect x="52" y="190" width="38" height="50" /><rect x="390" y="190" width="38" height="50" /></g>
        <circle cx="300" cy="120" r="22" fill="#FF6B22" /><path d="M300 106l10 7-3.8 11.5h-12.4L290 113z" fill="#151515" /><path d="M250 128h-30M258 116h-34M254 140h-26" stroke="#FF6B22" strokeWidth="4" strokeLinecap="round" opacity=".7" />
      </svg>
    </section>
  );
}

/* ----------------------------------------------------------------- Sports */
export const SPORTS: Record<string, { desc: string; icon: string; from: string; to: string }> = {
  football: { desc: 'Five-a-side to seven-a-side turfs, floodlit for evening matches.', icon: '⚽', from: '#14532d', to: '#151515' },
  cricket: { desc: 'Net practice and box-cricket turfs for your team.', icon: '🏏', from: '#7c2d12', to: '#151515' },
  badminton: { desc: 'Indoor courts for singles and doubles.', icon: '🏸', from: '#1e3a8a', to: '#151515' },
  tennis: { desc: 'Hard and clay courts for rallies and coaching.', icon: '🎾', from: '#3f6212', to: '#151515' },
  basketball: { desc: 'Full and half courts for pick-up games.', icon: '🏀', from: '#9a3412', to: '#151515' },
  volleyball: { desc: 'Sand and hard courts for beach and indoor play.', icon: '🏐', from: '#a16207', to: '#151515' },
};
function CourtArt({ slug }: { slug: string }) {
  // the court lines drift slightly on hover, a gentle parallax

  const s = { fill: 'none', stroke: '#fff', strokeOpacity: 0.28, strokeWidth: 2 } as const;
  return (
    <svg viewBox="0 0 200 120" className="absolute inset-0 h-full w-full transition duration-700 ease-out group-hover:-translate-y-1 group-hover:scale-110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {slug === 'football' && <g {...s}><rect x="12" y="10" width="176" height="100" rx="6" /><line x1="100" y1="10" x2="100" y2="110" /><circle cx="100" cy="60" r="18" /><rect x="12" y="38" width="26" height="44" /><rect x="162" y="38" width="26" height="44" /></g>}
      {slug === 'cricket' && <g {...s}><ellipse cx="100" cy="60" rx="86" ry="48" /><rect x="90" y="22" width="20" height="76" /><line x1="90" y1="32" x2="110" y2="32" /><line x1="90" y1="88" x2="110" y2="88" /></g>}
      {slug === 'badminton' && <g {...s}><rect x="22" y="12" width="156" height="96" /><line x1="100" y1="12" x2="100" y2="108" strokeWidth="4" /><line x1="22" y1="36" x2="178" y2="36" /><line x1="22" y1="84" x2="178" y2="84" /><line x1="60" y1="12" x2="60" y2="108" /><line x1="140" y1="12" x2="140" y2="108" /></g>}
      {slug === 'tennis' && <g {...s}><rect x="22" y="12" width="156" height="96" /><line x1="100" y1="12" x2="100" y2="108" strokeWidth="4" /><rect x="48" y="26" width="104" height="68" /><line x1="48" y1="60" x2="152" y2="60" /></g>}
      {slug === 'basketball' && <g {...s}><rect x="12" y="10" width="176" height="100" rx="4" /><line x1="100" y1="10" x2="100" y2="110" /><circle cx="100" cy="60" r="16" /><path d="M12 36a34 34 0 0 1 0 48M188 36a34 34 0 0 0 0 48" /><rect x="12" y="42" width="30" height="36" /><rect x="158" y="42" width="30" height="36" /></g>}
      {slug === 'volleyball' && <g {...s}><rect x="22" y="14" width="156" height="92" /><line x1="100" y1="14" x2="100" y2="106" strokeWidth="4" /><line x1="62" y1="14" x2="62" y2="106" /><line x1="138" y1="14" x2="138" y2="106" /></g>}
    </svg>
  );
}

/** Only sports that exist in the platform's database are shown (matched by slug). */
export function SportsSection({ sports, bare }: { sports: { id: number; name: string; slug: string }[] | undefined; bare?: boolean }) {
  const list = (sports ?? []).filter((s) => SPORTS[s.slug]);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby={bare ? undefined : 'sports-h'} aria-label={bare ? 'Sports' : undefined}>
      {!bare && <Heading eyebrow="Choose your game" title="Explore your sport" sub="Pick a sport to see turfs that offer it." />}
      {!bare && <h2 id="sports-h" className="sr-only">Sports</h2>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s, n) => { const m = SPORTS[s.slug]; return (
          <Reveal as="li" key={s.id} delay={n * 0.08}>
            <Link to={`/venues?sport=${s.slug}`} className="group relative block h-52 overflow-hidden rounded-2xl border border-line transition hover:-translate-y-1 hover:border-brand/60" style={{ background: `linear-gradient(135deg, ${m.from}, ${m.to})` }}>
              <CourtArt slug={s.slug} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <span className="absolute right-4 top-3 text-5xl drop-shadow transition group-hover:scale-110 group-hover:animate-float" aria-hidden="true">{m.icon}</span>
              <div className="absolute inset-x-0 bottom-0 p-4 text-white"><h3 className="font-display text-3xl font-extrabold uppercase">{s.name}</h3><p className="text-sm text-white/80">{m.desc}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-[#FF6B22]">Explore {s.name} turfs <span className="transition group-hover:translate-x-1" aria-hidden="true">→</span></span></div>
            </Link>
          </Reveal>); })}
      </ul>
    </section>
  );
}

/* --------------------------------------------------------------- Features */
const FEATURES: [string, string, string][] = [
  ['🟢', 'Live slot availability', 'See which slots are open or booked, updated in real time.'],
  ['📅', 'Easy booking', 'Pick your date, time and duration and the price is calculated for you.'],
  ['🏅', 'Multiple sports', 'Football, cricket, badminton, tennis and more in one place.'],
  ['📍', 'Location-based search', 'Search by city or area, or find turfs near you with distance shown.'],
  ['🔒', 'Secure payments', 'Pay online through Razorpay. Your booking confirms only after the payment is verified.'],
  ['🧾', 'Booking history', 'View your upcoming and past bookings anytime.'],
  ['🎟️', 'Instant confirmation', 'Get a booking reference to show at the venue.'],
  ['⭐', 'Ratings and reviews', 'Read feedback from players who have played there, and leave your own.'],
  ['🏷️', 'Offers and coupons', 'Apply eligible discount codes at checkout.'],
  ['🛠️', 'Booking management', 'Cancel eligible bookings and track any refund in one place.'],
];
export function FeaturesSection() {
  return (
    <section aria-labelledby="features-h">
      <Heading eyebrow="Features" title="Everything you need to play" />
      <h2 id="features-h" className="sr-only">Features</h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {FEATURES.map(([icon, t, d], n) => (
          <Reveal as="li" key={t} delay={n * 0.08} className="card p-5 transition hover:-translate-y-1 hover:border-brand/50"><PopIcon delay={n * 0.08 + 0.15} className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand/15 text-2xl">{icon}</PopIcon><h3 className="text-xl font-bold leading-tight">{t}</h3><p className="mt-1 text-sm text-muted">{d}</p></Reveal>))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ Steps */
const STEPS: [string, string, string][] = [
  ['👤', 'Create an account', 'Register or log in. Verify your email to book.'], ['🏅', 'Choose your sport', 'Select the sport you want to play.'],
  ['🔎', 'Discover turfs', 'Browse venues, compare prices and ratings.'], ['🕒', 'Select your slot', 'Choose the date, time and duration.'],
  ['💳', 'Make payment', 'Complete the booking payment securely.'], ['🎉', 'Play your game', 'Get confirmation and your booking reference.'],
];
export function StepsSection() {
  return (
    <section aria-labelledby="steps-h" className="rounded-3xl border border-line bg-surface p-6 sm:p-10">
      <Heading eyebrow="How it works" title="Book your game in 6 simple steps" center />
      <h2 id="steps-h" className="sr-only">How KickOff works</h2>
      <ol className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map(([icon, t, d], i) => (
          <Reveal as="li" key={t} delay={i * 0.12} className="relative rounded-2xl border border-line bg-bg/60 p-5">
            <span className="absolute -top-4 left-5 grid h-9 w-9 place-items-center rounded-full bg-brand font-display text-xl font-extrabold text-brand-ink shadow" aria-hidden="true">{i + 1}</span>
            <div className="mt-2 flex items-center gap-3"><span className="text-3xl" aria-hidden="true">{icon}</span><h3 className="text-2xl font-bold leading-tight"><span className="sr-only">Step {i + 1}: </span>{t}</h3></div>
            <p className="mt-2 text-sm text-muted">{d}</p>
            {i < STEPS.length - 1 && (i + 1) % 3 !== 0 && <span className="absolute -right-5 top-1/2 hidden h-0.5 w-6 -translate-y-1/2 origin-left animate-bar rounded bg-brand/70 [animation-duration:900ms] [animation-delay:600ms] lg:block" aria-hidden="true" />}
          </Reveal>))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------- Player benefits */
const BENEFITS: [string, string][] = [
  ['🌐', 'Convenient online turf discovery'], ['💰', 'Easy comparison of turf prices'], ['⏱️', 'Access to available time slots'], ['🏟️', 'Multiple sports facilities'],
  ['🔍', 'Transparent booking information'], ['📲', 'Convenient digital booking confirmation'], ['🗂️', 'Easy access to booking history'],
];
export function PlayerBenefits() {
  return (
    <section aria-labelledby="why-h">
      <Heading eyebrow="For players" title="Why players choose KickOff" />
      <h2 id="why-h" className="sr-only">Benefits for players</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BENEFITS.map(([icon, t]) => <li key={t} className="card flex items-center gap-3 p-4"><span className="text-2xl" aria-hidden="true">{icon}</span><span className="font-semibold">{t}</span></li>)}
        <li className="flex items-center justify-center rounded-2xl border border-dashed border-brand/50 p-4"><Link to="/register" className="font-bold text-[rgb(var(--brand-text))]">Join as a player →</Link></li>
      </ul>
    </section>
  );
}

/* --------------------------------------------------------- Owner benefits */
const OWNER: [string, string][] = [
  ['📝', 'Online venue registration'], ['🏸', 'Venue and sports management'], ['🗓️', 'Slot availability management'], ['📋', 'Booking management'],
  ['💲', 'Pricing management'], ['📈', 'Revenue tracking'], ['👥', 'Customer booking visibility'],
];
export function OwnerSection() {
  return (
    <section aria-labelledby="owner-h" className="pitch-stripes relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#151515] via-[#292929] to-[#151515] p-6 text-white sm:p-10">
      <div className="pointer-events-none absolute -left-16 -bottom-16 h-72 w-72 rounded-full bg-[#FF6B22]/20 blur-3xl" />
      <div className="relative grid gap-8 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.25em] text-[#FF6B22]">For turf owners</p>
          <h2 id="owner-h" className="font-display text-4xl font-extrabold uppercase leading-none sm:text-5xl">Own a turf? Grow your business with KickOff.</h2>
          <p className="mt-4 text-white/75">Bring your sports venue online with KickOff. Manage your venue information, booking slots, pricing and customer bookings through a centralized platform.</p>
          <div className="mt-6 flex flex-wrap gap-3"><Link to="/owner/register" className="btn-primary !px-6 !py-3">Register your turf</Link><Link to="/owner/login" className="btn !px-6 !py-3 border border-white/30 text-white hover:bg-white/10">Turf owner login</Link></div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">{OWNER.map(([icon, t]) => <li key={t} className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold"><span className="text-xl" aria-hidden="true">{icon}</span>{t}</li>)}</ul>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- Testimonials */
/** Real reviews from the database. Renders nothing when there are none (no placeholder testimonials). */
export function Testimonials() {
  const q = useQuery({ queryKey: ['reviews', 'featured'], queryFn: () => get<{ reviews: { id: string; rating: number; comment: string; author: string; venue_id: string; venue_name: string }[] }>('/reviews/featured'), staleTime: 300000 });
  if (!q.data || q.data.reviews.length === 0) return null;
  return (
    <section aria-labelledby="reviews-h">
      <Heading eyebrow="Player reviews" title="What our players say" />
      <h2 id="reviews-h" className="sr-only">Player reviews</h2>
      <AutoSlider className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3">
        {q.data.reviews.map((r) => (
          <li key={r.id} className="card flex w-[85%] shrink-0 snap-start flex-col gap-3 p-5 transition hover:-translate-y-1 md:w-[48%] lg:w-[32%]"><Stars value={r.rating} /><blockquote className="flex-1 text-sm leading-relaxed">“{r.comment}”</blockquote>
            <div className="text-sm"><b>{r.author}</b><div className="text-muted">played at <Link className="underline hover:text-ink" to={`/venues/${r.venue_id}`}>{r.venue_name}</Link></div></div></li>))}
      </AutoSlider>
    </section>
  );
}

/* -------------------------------------------------------------------- FAQ */
export const FAQS: [string, ReactNode][] = [
  ['What is KickOff?', 'KickOff is an online sports turf booking platform. You can discover venues, compare prices, check live slot availability and book your playing time in one place.'],
  ['How can I book a turf?', <>Create an account and verify your email, open a turf, choose the playing area, sport, date, duration and slot, then pay. Your booking is confirmed once the payment is verified. <Link className="underline" to="/venues">Browse turfs</Link>.</>],
  ['Which sports are available?', 'The sports offered depend on each venue. Football, cricket, badminton, tennis, basketball, volleyball and more are supported. Pick a sport to see the venues that offer it.'],
  ['How can I check slot availability?', 'Open a venue and choose a date. Open slots show their price, and booked, held or closed slots are disabled. Availability updates live as other players book.'],
  ['How can I make payments?', 'Payments are made online through Razorpay at checkout, using the payment methods Razorpay offers for your account. We never see or store your card details.'],
  ['Where can I view my bookings?', 'Log in and open “My bookings”. You will see upcoming and past bookings, each with its reference number and refund status if applicable.'],
  ['How can I cancel a booking?', <>Open the booking from “My bookings” and choose Cancel. Each venue sets a cancellation window: cancelling before it gets a full refund, and cancelling inside it is not refundable. If the venue cancels, you are always refunded in full. See the <Link className="underline" to="/cancellation-policy">Cancellation Policy</Link>.</>],
  ['How can I register as a turf owner?', <>Go to <Link className="underline" to="/owner/register">Register your turf</Link>, create an owner account, add your venue details, photos, pricing, hours and documents, and submit for approval. Venues go live after our team verifies them.</>],
];
export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section aria-labelledby="faq-h" className="mx-auto w-full max-w-3xl">
      <Heading eyebrow="FAQ" title="Got questions? We have answers." center />
      <h2 id="faq-h" className="sr-only">Frequently asked questions</h2>
      <div className="space-y-3">
        {FAQS.map(([q, a], i) => (
          <div key={q} className={cx('card overflow-hidden transition', open === i && 'border-brand/50')}>
            <h3><button className="flex w-full items-center justify-between gap-4 p-4 text-left text-lg font-bold" aria-expanded={open === i} aria-controls={`faq-${i}`} id={`faq-b-${i}`} onClick={() => setOpen(open === i ? null : i)}>
              {q}<span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface2 text-lg transition-transform', open === i && 'rotate-45 bg-brand text-brand-ink')} aria-hidden="true">+</span></button></h3>
            <div className={cx('grid transition-[grid-template-rows] duration-300 ease-out', open === i ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}><div id={`faq-${i}`} role="region" aria-labelledby={`faq-b-${i}`} aria-hidden={open !== i} className="overflow-hidden"><div className="px-4 pb-4 text-sm leading-relaxed text-muted">{a}</div></div></div>
          </div>))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Final CTA */
export function FinalCTA() {
  return (
    <section aria-labelledby="cta-h" className="relative overflow-hidden rounded-3xl bg-brand p-8 text-center text-brand-ink sm:p-14">
      <svg viewBox="0 0 400 200" className="pointer-events-none absolute inset-0 h-full w-full opacity-10" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="#151515" strokeWidth="3"><rect x="10" y="10" width="380" height="180" rx="12" /><line x1="200" y1="10" x2="200" y2="190" /><circle cx="200" cy="100" r="36" /></g></svg>
      <div className="relative"><h2 id="cta-h" className="font-display text-5xl font-extrabold uppercase sm:text-7xl">Ready to play?</h2>
        <p className="mx-auto mt-3 max-w-xl font-medium">Find your favourite sport, discover the perfect turf and book your next game with KickOff.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/venues" className="btn animate-glowSoft bg-[#151515] !px-7 !py-3 text-base text-white hover:brightness-125">Explore turfs</Link><Link to="/register" className="btn border-2 border-[#151515] !px-7 !py-3 text-base text-[#151515] hover:bg-[#151515]/10">Create free account</Link></div></div>
    </section>
  );
}
