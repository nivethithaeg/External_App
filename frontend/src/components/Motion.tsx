import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { animate, LayoutGroup, motion, useReducedMotion } from 'framer-motion';

/** Fades and lifts its children into view the first time they scroll on screen. Plain (no animation) when the visitor prefers reduced motion. */
export function Reveal({ children, delay = 0, y = 24, className, as = 'div' }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: 'div' | 'section' | 'li' }) {
  const reduce = useReducedMotion();
  const Tag = as === 'section' ? motion.section : as === 'li' ? motion.li : motion.div;
  if (reduce || typeof IntersectionObserver === 'undefined') { const Plain = as; return <Plain className={className}>{children}</Plain>; }
  return <Tag className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -8% 0px' }} transition={{ duration: 0.55, delay, ease: 'easeOut' }}>{children}</Tag>;
}

/** A soft entrance for a whole page whenever the route changes. Opacity and transform only, so nothing jumps. */
export function PageTransition({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return <motion.div key={routeKey} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>{children}</motion.div>;
}

const canAnimate = () => typeof IntersectionObserver !== 'undefined';

/** True once the element has scrolled into view (and stays true). Always true where IntersectionObserver does not exist. */
function useSeen(ref: { current: Element | null }, margin = '0px') {
  const [seen, setSeen] = useState(!canAnimate());
  useEffect(() => {
    if (seen || !ref.current || !canAnimate()) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, ref, margin]);
  return seen;
}

/** A heading whose orange underline draws itself in when it scrolls into view. */
export function TitleUnderline({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref, '0px 0px -10% 0px');
  const live = !reduce && canAnimate();
  return (
    <span ref={ref} className="relative inline-block">{children}
      <i aria-hidden="true" className="absolute -bottom-1.5 left-0 h-[3px] w-full origin-left rounded bg-brand transition-transform duration-700 ease-out" style={{ transform: !live || seen ? 'scaleX(.28)' : 'scaleX(0)' }} /></span>
  );
}

/** Counts up to `value` the first time it is on screen. `format` turns the running number into text (for example money). */
export function CountUp({ value, format = (n: number) => String(Math.round(n)), duration = 1.2 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref);
  const [n, setN] = useState(reduce || !canAnimate() ? value : 0);
  useEffect(() => {
    if (reduce || !canAnimate()) { setN(value); return; }
    if (!seen) return;
    const c = animate(0, value, { duration, ease: 'easeOut', onUpdate: setN });
    return () => c.stop();
  }, [seen, value, reduce, duration]);
  return <span ref={ref}>{format(n)}</span>;
}

/**
 * A dashboard number: counts up from 0 the first time it is on screen, then glides from the old value to the new one
 * whenever the data changes (a refresh). It never runs on its own. Reduced motion shows the value at once.
 */
export function AnimatedNumber({ value, format = (n: number) => String(Math.round(n)), duration = 1.1 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref);
  const still = reduce || !canAnimate();
  const [n, setN] = useState(still ? value : 0);
  const shown = useRef(still ? value : 0);
  useEffect(() => {
    if (still) { shown.current = value; setN(value); return; }
    if (!seen || shown.current === value) return;
    const c = animate(shown.current, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: (x) => { shown.current = x; setN(x); } });
    return () => c.stop();
  }, [seen, value, still, duration]);
  return <span ref={ref} className="tabular-nums">{format(n)}</span>;
}

/** Cycles through a list of words with a small slide, for headlines like "Find your next ___ turf". */
export function RotatingWord({ words, every = 2200 }: { words: string[]; every?: number }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => { if (reduce || words.length < 2) return; const t = setInterval(() => setI((x) => (x + 1) % words.length), every); return () => clearInterval(t); }, [words.length, every, reduce]);
  if (words.length === 0) return null;
  return <span key={words[i % words.length]} className="inline-block animate-rise font-extrabold text-[#7200FF]">{words[i % words.length]}</span>;
}

/** An icon that pops in with a little wiggle when it first appears. */
export function PopIcon({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce || !canAnimate()) return <div className={className} aria-hidden="true">{children}</div>;
  return <motion.div aria-hidden="true" className={className} initial={{ scale: 0.5, rotate: -14, opacity: 0 }} whileInView={{ scale: 1, rotate: 0, opacity: 1 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 12, delay }}>{children}</motion.div>;
}

/** A horizontal snap strip that slides to the next card every few seconds, and stops while the pointer or focus is on it. */
export function AutoSlider({ children, every = 5000, className }: { children: ReactNode; every?: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLUListElement>(null);
  const paused = useRef(false);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      const el = ref.current; if (!el || paused.current || el.scrollWidth <= el.clientWidth + 8) return;
      const step = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth; const gap = 16;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) el.scrollTo({ left: 0, behavior: 'smooth' }); else el.scrollBy({ left: step + gap, behavior: 'smooth' });
    }, every);
    return () => clearInterval(t);
  }, [every, reduce]);
  return <ul ref={ref} className={className} onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }} onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }} onTouchStart={() => { paused.current = true; }}>{children}</ul>;
}

/** A coupon code with a copy button that confirms with a tick. */
export function CopyCode({ code }: { code: string }) {
  const [done, setDone] = useState(false); const [burst, setBurst] = useState(0);
  return (
    <button type="button" aria-label={`Copy code ${code}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(code).then(() => { setDone(true); setBurst((n) => n + 1); setTimeout(() => setDone(false), 1800); }).catch(() => {}); }}
      className="relative rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-muted transition hover:border-brand hover:text-ink active:scale-95">
      {done ? <span key="ok" className="inline-block animate-pop text-ok">✓ Copied</span> : 'Copy'}<Burst fire={burst} glyphs={['■', '▮', '★']} colors={['#43C85A', '#7200FF', '#FFFFFF', '#B8BCC2']} count={12} size={8} /></button>
  );
}

const fineHover = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/** Pointer-driven 3D tilt and a spotlight that follows the cursor. Off on touch devices and with reduced motion. */
export function useTilt(max = 5) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const on = !reduce && fineHover();
  const move = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current; if (!el || !on) return;
    const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${px * 100}%`); el.style.setProperty('--my', `${py * 100}%`);
    el.style.setProperty('--shift-x', `${(0.5 - px) * 10}px`); el.style.setProperty('--shift-y', `${(0.5 - py) * 8}px`);
    el.style.transform = `perspective(900px) rotateX(${(0.5 - py) * max * 2}deg) rotateY(${(px - 0.5) * max * 2}deg) translateY(-4px)`;
  };
  const leave = () => { const el = ref.current; if (!el) return; el.style.transform = ''; el.style.setProperty('--shift-x', '0px'); el.style.setProperty('--shift-y', '0px'); };
  return { ref, on, handlers: { onPointerMove: move, onPointerLeave: leave } };
}

/** A short burst of particles from the middle of its parent. Change `fire` to set it off. */
export function Burst({ fire, glyphs = ['♥'], colors = ['#7200FF', '#43C85A', '#FFFFFF'], count = 8, size = 12 }: { fire: number; glyphs?: string[]; colors?: string[]; count?: number; size?: number }) {
  const reduce = useReducedMotion();
  if (!fire || reduce) return null;
  return (
    <span key={fire} aria-hidden="true" className="pointer-events-none absolute inset-0">
      {Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2 + Math.random() * 0.5, d = 22 + Math.random() * 22;
        return <span key={i} className="burst-p" style={{ '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 6}px`, '--rot': `${Math.round(Math.random() * 240 - 120)}deg`, color: colors[i % colors.length], fontSize: size, lineHeight: 1 } as CSSProperties}>{glyphs[i % glyphs.length]}</span>; })}
    </span>
  );
}

/** "Ends in 2d 4h" for a deadline that is close, refreshing every 30 seconds. Shows nothing for far-off or past deadlines. */
export function Countdown({ to, withinDays = 7 }: { to: string; withinDays?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const ms = new Date(to).getTime() - now;
  if (!(ms > 0) || ms > withinDays * 86400000) return null;
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn"><span aria-hidden="true">⏳</span>Ends in {d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`}</span>;
}

/** A segmented control (grid / list / map) whose orange pill slides to the chosen option. */
export function SlidingTabs<T extends string>({ options, value, onChange, label, id }: { options: { id: T; label: string }[]; value: T; onChange(v: T): void; label: string; id: string }) {
  const reduce = useReducedMotion();
  return (
    <LayoutGroup id={id}>
      <div role="group" aria-label={label} className="relative flex overflow-hidden rounded-xl border border-line text-sm font-semibold">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={`relative px-3 py-2 transition-colors ${value === o.id ? 'text-brand-ink' : 'text-muted hover:text-ink'}`}>
            {value === o.id && (reduce ? <span className="absolute inset-0 bg-brand" /> : <motion.span layoutId="pill" className="absolute inset-0 bg-brand" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />)}
            <span className="relative">{o.label}</span>
          </button>))}
      </div>
    </LayoutGroup>
  );
}
