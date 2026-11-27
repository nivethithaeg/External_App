import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const goBook = () => setTimeout(() => document.getElementById('book')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 60);

/** Small floating info card in the hero. */
function FloatCard({ icon, title, sub, className, delay }: { icon: ReactNode; title: string; sub: string; className: string; delay: string }) {
  return (
    <div className={`absolute flex animate-float items-center gap-3 rounded-2xl border border-white/60 bg-white/95 px-4 py-3 text-left shadow-[0_18px_40px_-18px_rgb(16_27_92/.55)] backdrop-blur ${className}`} style={{ animationDuration: '4.5s', animationDelay: delay }}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#F5F0FF] text-[#7200FF]" aria-hidden="true">{icon}</span>
      <span><b className="block text-sm text-[#11152F]">{title}</b><span className="block text-xs text-[#777B90]">{sub}</span></span>
    </div>
  );
}

const ic = (d: string) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

/**
 * The PlaynX hero: "Your Game. Your Place. Your Play." with the brand's motion swooshes and play mark.
 * `greeting` shows above the heading for a signed-in player; `secondary` replaces the second button.
 */
export function BrandHero({ greeting, secondary, primary, sub }: { greeting?: string; secondary?: ReactNode; primary?: ReactNode; sub?: string }) {
  return (
    <section aria-labelledby="hero-h" className="relative overflow-hidden rounded-[2rem] border border-[#E4DEF4] bg-gradient-to-br from-white via-[#F8F4FF] to-[#EDE3FF] px-6 py-10 sm:px-12 sm:py-16 dark:border-line dark:from-[#101B5C] dark:via-[#121E66] dark:to-[#1B1470]">
      {/* motion swooshes taken from the logo's sweep */}
      <svg viewBox="0 0 800 500" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="hero-sw1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#7200FF" stopOpacity="0" /><stop offset=".6" stopColor="#7200FF" stopOpacity=".18" /><stop offset="1" stopColor="#A100FF" stopOpacity=".35" /></linearGradient>
          <linearGradient id="hero-sw2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#101B5C" stopOpacity="0" /><stop offset="1" stopColor="#101B5C" stopOpacity=".12" /></linearGradient>
        </defs>
        <path d="M0 470 C 260 430, 520 300, 800 60 L 800 140 C 560 330, 300 470, 0 500 Z" fill="url(#hero-sw1)" />
        <path d="M120 500 C 380 470, 620 360, 800 230 L 800 270 C 640 390, 420 480, 160 500 Z" fill="url(#hero-sw2)" />
      </svg>
      <div className="relative grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
        <div>
          {greeting && <p className="mb-2 animate-rise text-sm font-semibold text-[#FF8C00]">{greeting}</p>}
          <p className="mb-4 inline-flex animate-rise items-center gap-2 rounded-full border border-[#7200FF]/25 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[.2em] text-[#7200FF] dark:bg-white/10 dark:text-[#C9A6FF]">
            Play <span aria-hidden="true">•</span> Experience <span aria-hidden="true">•</span> Repeat
          </p>
          <h1 id="hero-h" className="animate-rise font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-[#101B5C] sm:text-6xl dark:text-white" style={{ animationDelay: '100ms' }}>
            Your Game.<br />Your <span className="bg-gradient-to-r from-[#7200FF] to-[#A100FF] bg-clip-text text-transparent">Place</span>.<br />Your <span className="bg-gradient-to-r from-[#7200FF] to-[#A100FF] bg-clip-text text-transparent">Play</span>.
          </h1>
          <p className="mt-5 max-w-lg animate-rise text-lg text-[#777B90] dark:text-white/75" style={{ animationDelay: '200ms' }}>{sub ?? 'Discover, book and experience the best sports venues near you.'}</p>
          <div className="mt-8 flex animate-rise flex-wrap gap-3" style={{ animationDelay: '300ms' }}>
            {primary ?? <a href="#book" onClick={goBook} className="btn rounded-full bg-gradient-to-r from-[#7200FF] to-[#A100FF] !px-7 !py-3 text-base text-white shadow-[0_12px_28px_-10px_rgb(114_0_255/.75)] hover:-translate-y-0.5 hover:brightness-110">Book Your Game</a>}
            {secondary ?? <Link to="/nearby" className="btn rounded-full border-2 border-[#101B5C]/15 bg-white !px-7 !py-3 text-base text-[#101B5C] hover:-translate-y-0.5 hover:border-[#7200FF]/50 hover:text-[#7200FF] dark:border-white/25 dark:bg-transparent dark:text-white">Explore Venues</Link>}
          </div>
        </div>

        {/* brand visual: navy court card with the orange play mark and floating info cards */}
        <div className="relative mx-auto hidden aspect-[5/4] w-full max-w-md sm:block">
          <div className="absolute inset-6 rotate-[-4deg] rounded-[2rem] bg-gradient-to-br from-[#101B5C] via-[#2A1A9E] to-[#7200FF] shadow-[0_30px_60px_-25px_rgb(16_27_92/.8)]">
            <svg viewBox="0 0 400 320" className="h-full w-full" aria-hidden="true">
              <g fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="2.5"><rect x="28" y="28" width="344" height="264" rx="16" /><line x1="200" y1="28" x2="200" y2="292" /><circle cx="200" cy="160" r="46" /><rect x="28" y="110" width="44" height="100" /><rect x="328" y="110" width="44" height="100" /></g>
              <defs><linearGradient id="hero-play" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFB020" /><stop offset="1" stopColor="#FF8C00" /></linearGradient></defs>
              <path d="M178 126v68a6 6 0 0 0 9 5.2l58-34a6 6 0 0 0 0-10.4l-58-34a6 6 0 0 0-9 5.2z" fill="url(#hero-play)" />
              <path d="M40 300 C 150 280, 260 220, 380 90" stroke="#A100FF" strokeWidth="6" strokeLinecap="round" fill="none" opacity=".7" />
            </svg>
          </div>
          <FloatCard className="-left-2 top-4" delay="0s" icon={ic('M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4')} title="Available Today" sub="Live slot availability" />
          <FloatCard className="-right-2 top-1/2 -translate-y-1/2" delay=".8s" icon={ic('M13 2 4 14h7l-1 8 9-12h-7l1-8Z')} title="Instant Booking" sub="Confirmed in seconds" />
          <FloatCard className="bottom-2 left-6" delay="1.6s" icon={ic('M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4')} title="Verified Venues" sub="Checked by our team" />
        </div>
      </div>
    </section>
  );
}
