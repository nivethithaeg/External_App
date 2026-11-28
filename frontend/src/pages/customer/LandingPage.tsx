import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Reveal } from '../../components/Motion';
import { FAQSection, Testimonials } from './Landing';
import { cx } from '../../lib/utils';

/*
 * The first page of the website (/): what players and what venue owners can do on PlaynX.
 * Two "doors" in the hero, a Player / Venue owner switch, one booking followed through both sides, then why PlaynX.
 * The screens shown are illustrations with made-up bookings and say so.
 */

const I = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  stack: 'M4 8l8-4 8 4-8 4-8-4Zm0 4 8 4 8-4M4 16l8 4 8-4',
  card: 'M3 7h18v10H3V7Zm0 4h18M7 15h3',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6',
  refresh: 'M4 4v6h6M20 20v-6h-6M5.5 15A7 7 0 0 0 18 17M18.5 9A7 7 0 0 0 6 7',
  tag: 'M20 12 12 20l-8-8V4h8l8 8ZM8 8h.01',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  venue: 'M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6',
  rupee: 'M7 5h10M7 9h10M7 5c5 0 7 2 7 4s-2 4-7 4l8 7',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3V7Zm0 0 13-3v3M16 13h2',
  bank: 'M3 10h18L12 4 3 10Zm2 0v8m4-8v8m6-8v8m4-8v8M3 20h18',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c.6-3.2 3-5 6-5s5.4 1.8 6 5m1-9a3 3 0 1 0 0-6m2 15c-.3-2-1.3-3.5-3-4.3',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5V11Z',
  play: 'M8 5v14l11-7L8 5Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  check: 'M5 12l5 5 9-10',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
};
const Icon = ({ d, size = 20, className }: { d: string; size?: number; className?: string }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={d} /></svg>;
const Grad = ({ children }: { children: ReactNode }) => <span className="bg-gradient-to-r from-[#7200FF] via-[#A100FF] to-[#FF8C00] bg-clip-text text-transparent">{children}</span>;
const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cx('mb-3 text-xs font-bold uppercase tracking-[.25em] text-[#7200FF] dark:text-[#C9A6FF]', className)}>{children}</p>;

const btnMain = 'btn rounded-full bg-gradient-to-r from-[#7200FF] to-[#A100FF] !px-6 !py-3 text-base text-white shadow-[0_12px_28px_-10px_rgb(114_0_255/.8)] hover:-translate-y-0.5 hover:brightness-110';
const btnOrange = 'btn rounded-full bg-gradient-to-r from-[#FFB020] to-[#FF8C00] !px-6 !py-3 text-base text-[#101B5C] shadow-[0_12px_28px_-10px_rgb(255_140_0/.7)] hover:-translate-y-0.5 hover:brightness-105';
const btnOutline = 'btn rounded-full border-2 border-line !px-6 !py-3 text-base hover:border-brand/50';

/* ------------------------------------------------------------------ content */
const PLAYER: [string, string, string][] = [
  [I.search, 'Find a venue fast', 'Filter by city, sport, date and time, or see the venues nearest to you with directions.'],
  [I.clock, 'Live slots, real prices', 'See which slots are free right now and exactly what each one costs.'],
  [I.stack, 'Book one slot or many', 'Pick several slots in one go for a longer game.'],
  [I.card, 'Pay safely online', 'Pay through Razorpay. Where the venue allows it, pay an advance now and the rest at the venue.'],
  [I.receipt, 'Instant confirmation', 'Get a booking reference and a downloadable receipt as soon as you pay.'],
  [I.refresh, 'Cancel and get refunds', 'Cancel eligible bookings and follow your refund until it reaches you.'],
  [I.tag, 'Offers and coupons', 'Apply live coupon codes at checkout and save.'],
  [I.chat, 'Help when you need it', 'Raise a ticket on a booking and attach photos or videos.'],
];
const OWNER: [string, string, string][] = [
  [I.venue, 'List your venue', 'Add your venue, photos, facilities and each playing area with its sports.'],
  [I.rupee, 'Your hours, your prices', 'Set hours and a default price, then change it for any slot, weekday or special date.'],
  [I.calendar, 'One booking calendar', 'Every booking on one calendar. Block slots for maintenance or events.'],
  [I.wallet, 'Full or advance payment', 'Choose how players pay online and collect the balance at the venue.'],
  [I.bank, 'Automatic payouts', 'Your share is paid to your bank 48 hours after the game when there is no complaint.'],
  [I.chart, 'Reports and revenue', 'Bookings, revenue, platform fees and pending payments, ready to download.'],
  [I.users, 'Staff logins', 'Give your staff their own login to check players in with the booking reference.'],
  [I.tag, 'Offers, customers and reviews', 'Run offers for quiet hours, see your regular customers and read their reviews.'],
];
const SPORTS = ['Cricket', 'Football', 'Badminton', 'Pickleball', 'Tennis', 'Basketball', 'Volleyball'];
const SLOTS: [string, string | null][] = [['6:00 PM', '₹900'], ['7:00 PM', null], ['8:00 PM', '₹1,000'], ['9:00 PM', '₹1,000'], ['10:00 PM', null], ['11:00 PM', '₹800']];
const CAL: (string | null)[][] = [['Rahul V.', null, 'Divya P.'], ['Office team', 'Sneha R.', null], ['Hari R.', 'Vikram S.', 'Kavya M.'], [null, 'Thunders', 'Arjun T.']];

/* ------------------------------------------------------------------ pieces */
function Door({ children, className }: { children: ReactNode; className: string }) {
  return <article className={cx('group/door relative flex min-h-[22rem] flex-1 flex-col overflow-hidden rounded-[2rem] p-7 transition-[flex-grow] duration-500 ease-out sm:p-9 lg:hover:flex-[1.35]', className)}>{children}</article>;
}

function PhoneMock() {
  return (
    <div className="mx-auto w-64 rounded-[2.2rem] border-[6px] border-[#101B5C] bg-white p-3 text-[#11152F] shadow-[0_30px_60px_-25px_rgb(16_27_92/.7)]">
      <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-[#E4DEF4]" />
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#777B90]">Turf 1 · Cricket</p>
      <p className="font-display text-base font-bold">Saturday</p>
      <div className="mt-3 grid grid-cols-2 gap-2">{SLOTS.map(([t, p], i) => (
        <span key={t} className={cx('rounded-xl border px-2 py-2 text-center text-xs', p === null ? 'border-[#E4DEF4] bg-[#F5F0FF] text-[#A0A3B5] line-through' : i === 2 ? 'border-transparent bg-gradient-to-br from-[#7200FF] to-[#A100FF] font-bold text-white' : 'border-[#E4DEF4]')}>
          <b className="block">{t}</b>{p ?? 'Booked'}</span>))}</div>
      <div className="mt-3 rounded-xl bg-[#F5F0FF] p-2.5 text-xs"><div className="flex justify-between"><span>8:00 PM · 1 hour</span><b>₹1,000</b></div><div className="mt-1 flex justify-between text-[#777B90]"><span>Pay now (50%)</span><span>₹500</span></div></div>
      <span className="mt-3 block rounded-full bg-gradient-to-r from-[#7200FF] to-[#A100FF] py-2 text-center text-xs font-bold text-white">Pay ₹500 and book</span>
    </div>
  );
}

function DashboardMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E4DEF4] bg-white text-[#11152F] shadow-[0_30px_60px_-25px_rgb(16_27_92/.6)]">
      <div className="flex items-center gap-2 bg-[#101B5C] px-4 py-2.5 text-white"><span className="h-2.5 w-2.5 rounded-full bg-white/30" /><span className="h-2.5 w-2.5 rounded-full bg-white/30" /><span className="h-2.5 w-2.5 rounded-full bg-white/30" /><span className="ml-2 text-xs text-white/70">Venue Owner Portal</span></div>
      <div className="grid grid-cols-3 gap-2 border-b border-[#E4DEF4] p-3 text-center">
        {[['Today', '9 bookings'], ['Revenue', '₹9,800'], ['Payout', '₹8,820']].map(([l, v]) => <div key={l} className="rounded-xl bg-[#F5F0FF] p-2"><p className="text-[10px] font-bold uppercase text-[#777B90]">{l}</p><p className="font-display text-sm font-bold">{v}</p></div>)}
      </div>
      <div className="overflow-x-auto p-3"><table className="w-full min-w-[300px] border-separate border-spacing-1 text-[11px]"><thead><tr><th className="w-10" />{['Turf 1', 'Turf 2', 'Court A'].map((a) => <th key={a} className="text-left font-bold text-[#777B90]">{a}</th>)}</tr></thead>
        <tbody>{CAL.map((row, r) => <tr key={r}><td className="text-[#777B90]">{6 + r} PM</td>{row.map((c, i) => <td key={i} className={cx('rounded-md px-1.5 py-1.5', c ? 'bg-gradient-to-br from-[#FFB020] to-[#FF8C00] font-semibold text-[#101B5C]' : 'border border-[#E4DEF4] text-[#A0A3B5]')}>{c ?? 'Open'}</td>)}</tr>)}</tbody></table></div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export function LandingPage() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const [side, setSide] = useState<'player' | 'owner'>(hash === '#owners' ? 'owner' : 'player');
  // links such as /#owners from other pages open the right side and scroll to it
  useEffect(() => {
    if (hash === '#owners' || hash === '#players') setSide(hash === '#owners' ? 'owner' : 'player');
    if (hash) setTimeout(() => document.getElementById(hash === '#owners' || hash === '#players' ? 'sides' : hash.slice(1))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 80);
  }, [hash]);
  const items = side === 'player' ? PLAYER : OWNER;

  return (
    <div className="space-y-20 sm:space-y-28">
      {/* ------------------------------------------------ hero */}
      <section aria-labelledby="hero-h" className="-mb-6 pt-4 sm:-mb-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[#7200FF]/20 bg-white/80 px-4 py-1.5 text-xs font-bold uppercase tracking-[.2em] text-[#7200FF] shadow-sm backdrop-blur dark:bg-white/10 dark:text-[#C9A6FF]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#FF8C00]" aria-hidden="true" /> Play • Experience • Repeat
          </p>
          <h1 id="hero-h" className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-[#101B5C] sm:text-7xl dark:text-white">One platform.<br /><Grad>Both sides</Grad> of the game.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted">Players find a venue and book a slot in a minute. Venue owners run their bookings and get paid. Which side are you on?</p>
        </div>

      </section>

      {/* ------------------------------------------------ switch sides */}
      <section id="sides" aria-labelledby="sides-h" className="scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div><Eyebrow>Switch sides</Eyebrow>
            <h2 id="sides-h" className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">What you can do as a <Grad>{side === 'player' ? 'player' : 'venue owner'}</Grad></h2></div>
          <div role="tablist" aria-label="Choose your side" className="relative grid grid-cols-2 rounded-full border border-line bg-surface p-1.5 shadow-card">
            <span aria-hidden="true" className={cx('absolute inset-y-1.5 left-1.5 w-[calc(50%-.375rem)] rounded-full transition-transform duration-300', side === 'owner' ? 'translate-x-full bg-gradient-to-r from-[#101B5C] to-[#4B0FD6]' : 'bg-gradient-to-r from-[#7200FF] to-[#A100FF]')} />
            {(['player', 'owner'] as const).map((s) => <button key={s} type="button" role="tab" aria-selected={side === s} onClick={() => setSide(s)} className={cx('relative z-10 rounded-full px-5 py-2.5 text-sm font-bold transition-colors sm:px-7', side === s ? 'text-white' : 'text-muted hover:text-ink')}>{s === 'player' ? 'Player' : 'Venue owner'}</button>)}
          </div>
        </div>
        <div key={side} role="tabpanel" aria-label={side === 'player' ? 'Player' : 'Venue owner'} className="mt-10 grid animate-rise items-center gap-10 lg:grid-cols-[1.25fr_1fr]">
          <ol className="grid gap-3 sm:grid-cols-2">
            {items.map(([d, t, s], i) => (
              <li key={t} className="group flex gap-4 rounded-2xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card">
                <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white transition group-hover:-rotate-6 group-hover:scale-110', side === 'player' ? 'bg-gradient-to-br from-[#7200FF] to-[#A100FF]' : 'bg-gradient-to-br from-[#FFB020] to-[#FF8C00]')}><Icon d={d} /></span>
                <div><h3 className="font-display font-bold leading-snug">{t}</h3><p className="mt-0.5 text-sm leading-relaxed text-muted">{s}</p></div>
              </li>))}
          </ol>
          <figure className="relative">
            <div aria-hidden="true" className={cx('absolute inset-6 -z-10 rounded-full blur-3xl', side === 'player' ? 'bg-[#A100FF]/25' : 'bg-[#FF8C00]/25')} />
            {side === 'player' ? <PhoneMock /> : <DashboardMock />}
            <figcaption className="mt-4 text-center text-xs font-bold uppercase tracking-[.2em] text-muted">An example, with made-up bookings</figcaption>
          </figure>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">{side === 'player'
          ? <><Link to="/home" className={btnMain}>Book a game <Icon d={I.arrow} size={18} /></Link>{!user && <Link to="/register" className={btnOutline}>Create free account</Link>}</>
          : <><Link to="/owner/register" className={btnOrange}>Register your venue <Icon d={I.arrow} size={18} /></Link><Link to="/owner/login" className={btnOutline}>Owner login</Link></>}</div>
      </section>

      {/* ------------------------------------------------ two doors */}
      <section aria-label="Choose your side">
        <div className="flex flex-col gap-5 lg:flex-row">
          <Door className="brand-panel">
            <svg viewBox="0 0 200 200" className="pointer-events-none absolute -bottom-10 -right-10 h-56 w-56 text-[#7200FF]/[.07] transition duration-500 group-hover/door:scale-110 group-hover/door:text-[#7200FF]/[.12]" aria-hidden="true"><path d="M60 30v140l110-70L60 30Z" fill="currentColor" /></svg>
            <span className="font-display text-sm font-bold text-[#7200FF] dark:text-[#C9A6FF]">01</span>
            <h2 className="mt-1 font-display text-3xl font-extrabold sm:text-4xl">I want to play</h2>
            <p className="mt-2 max-w-sm text-muted">Find a turf or court near you, see live slots and book in a minute.</p>
            <ul className="mt-5 space-y-2 text-sm">{['Live slots with real prices', 'Pay online, or an advance where allowed', 'Instant confirmation and receipt'].map((x) => <li key={x} className="flex gap-2"><Icon d={I.check} size={18} className="shrink-0 text-[#7200FF]" />{x}</li>)}</ul>
            <div className="relative mt-auto flex flex-wrap gap-3 pt-7"><Link to="/home" className={btnMain}>Book a game <Icon d={I.arrow} size={18} /></Link>{!user && <Link to="/register" className={btnOutline}>Sign up</Link>}</div>
          </Door>
          <Door className="bg-gradient-to-br from-[#101B5C] via-[#1D1A86] to-[#4B0FD6] text-white shadow-[0_30px_60px_-30px_rgb(16_27_92/.9)]">
            <svg viewBox="0 0 200 200" className="pointer-events-none absolute -bottom-12 -right-6 h-60 w-60 text-white/[.06] transition duration-500 group-hover/door:scale-110" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="8"><rect x="20" y="40" width="160" height="120" rx="12" /><line x1="100" y1="40" x2="100" y2="160" /><circle cx="100" cy="100" r="24" /></g></svg>
            <span className="font-display text-sm font-bold text-[#FFB020]">02</span>
            <h2 className="mt-1 font-display text-3xl font-extrabold sm:text-4xl">I run a venue</h2>
            <p className="mt-2 max-w-sm text-white/70">List your turf, manage every booking and price, and get paid to your bank.</p>
            <ul className="mt-5 space-y-2 text-sm">{['All your bookings on one calendar', 'Full or advance payment, your choice', 'Automatic payouts after the game'].map((x) => <li key={x} className="flex gap-2"><Icon d={I.check} size={18} className="shrink-0 text-[#FFB020]" />{x}</li>)}</ul>
            <div className="relative mt-auto flex flex-wrap gap-3 pt-7"><Link to="/owner/register" className={btnOrange}>Register your venue <Icon d={I.arrow} size={18} /></Link><Link to="/owner/login" className="btn rounded-full border-2 border-white/40 !px-6 !py-3 text-base text-white hover:bg-white/10">Owner login</Link></div>
          </Door>
        </div>
        {!user && <p className="mt-6 text-center text-sm text-muted">Already have an account? <Link to="/login" className="font-semibold text-[#7200FF] underline dark:text-[#C9A6FF]">Log in</Link></p>}
      </section>

      {/* ------------------------------------------------ why: bento */}
      <section aria-labelledby="why-h">
        <Eyebrow>Why PlaynX</Eyebrow>
        <h2 id="why-h" className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Built so nothing gets <Grad>double booked</Grad>.</h2>
        <div className="mt-10 grid auto-rows-[minmax(9rem,auto)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#7200FF] to-[#A100FF] p-7 text-white sm:col-span-2 lg:row-span-2">
            <Icon d={I.shield} size={36} />
            <h3 className="mt-5 font-display text-3xl font-extrabold leading-tight">A slot is sold once. Never twice.</h3>
            <p className="mt-3 max-w-sm text-white/80">Every booking shares one calendar. The moment a slot is booked, it is closed for everyone.</p>
            <svg viewBox="0 0 200 120" className="absolute -bottom-6 -right-6 w-64 text-white/15" aria-hidden="true"><g fill="currentColor">{Array.from({ length: 18 }, (_, k) => <rect key={k} x={(k % 6) * 32} y={Math.floor(k / 6) * 38} width="26" height="30" rx="6" opacity={k % 4 === 0 ? 1 : 0.45} />)}</g></svg>
          </div>
          {([[I.bolt, 'Instant confirmation', 'Booking reference and receipt the moment payment goes through.'], [I.lock, 'Secure payments', 'Paid through Razorpay. We never see card details.'], [I.shield, 'Verified venues', 'Every venue is checked by our team before it goes live.'], [I.bank, 'Owners get paid', 'Payouts to the bank 48 hours after the game.']] as [string, string, string][]).map(([d, t, s], i) => (
            <Reveal key={t} delay={i * 0.08} className={cx('rounded-3xl border p-6 transition hover:-translate-y-1', i === 3 ? 'border-transparent bg-[#101B5C] text-white' : 'border-line bg-surface shadow-card')}>
              <span className={cx('grid h-11 w-11 place-items-center rounded-xl', i === 3 ? 'bg-[#FF8C00] text-[#101B5C]' : 'bg-[#F5F0FF] text-[#7200FF] dark:bg-surface2')}><Icon d={d} /></span>
              <h3 className="mt-4 font-display text-lg font-bold">{t}</h3><p className={cx('mt-1 text-sm', i === 3 ? 'text-white/70' : 'text-muted')}>{s}</p>
            </Reveal>))}
        </div>
      </section>

      {/* ------------------------------------------------ sports ribbon */}
      <section aria-label="Sports" className="relative left-1/2 w-screen -translate-x-1/2 py-6">
        <div className="-rotate-2 overflow-hidden bg-gradient-to-r from-[#101B5C] via-[#4B0FD6] to-[#7200FF] py-4 text-white shadow-[0_20px_40px_-20px_rgb(114_0_255/.8)]">
          <div className="flex w-max animate-marquee gap-6 whitespace-nowrap" aria-hidden="true">
            {[...SPORTS, ...SPORTS, ...SPORTS, ...SPORTS].map((s, i) => <span key={i} className="flex items-center gap-6 font-display text-2xl font-extrabold sm:text-3xl">{s}<Icon d={I.play} size={16} className="text-[#FF8C00]" /></span>)}
          </div>
        </div>
        <p className="sr-only">Sports on PlaynX: {SPORTS.join(', ')}</p>
      </section>

      <Testimonials />
      <FAQSection />

      {/* ------------------------------------------------ get started */}
      <section aria-labelledby="start-h" className="brand-panel relative overflow-hidden p-8 text-center sm:p-14">
        <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-[#A100FF]/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-[#FF8C00]/15 blur-3xl" />
        <div className="relative">
          <h2 id="start-h" className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{user ? 'Welcome back' : <>Already with <Grad>PlaynX</Grad>?</>}</h2>
          <p className="mx-auto mt-3 max-w-lg text-muted">{user ? 'Pick up where you left off.' : 'Log in to book your next game, or sign up and start playing today.'}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {user ? <Link to="/home" className={btnMain}>Go to my home <Icon d={I.arrow} size={18} /></Link>
              : <><Link to="/login" className={btnMain}>Login <Icon d={I.arrow} size={18} /></Link><Link to="/register" className="btn rounded-full border-2 border-ink/80 !px-6 !py-3 text-base hover:bg-surface2">Sign up</Link></>}
          </div>
          <p className="mt-6 text-sm text-muted">Own a venue? <Link to="/owner/register" className="font-semibold text-[#7200FF] underline dark:text-[#C9A6FF]">Register your venue</Link></p>
        </div>
      </section>
    </div>
  );
}
