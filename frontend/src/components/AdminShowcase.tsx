import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CountUp } from './Motion';
import { cx } from '../lib/utils';

export const ORANGE = '#FF6A00';
export const AMBER = '#FF8C32';

/* ------------------------------------------------------------------ Intro */
const SEEN = 'kickoff_admin_intro_seen';
/** One short opening per browser session: black screen, "Welcome to Admin Portal" fading up with an orange glow, then the dashboard zooms in underneath. Click or Esc skips it. */
export function useAdminIntro(): { active: boolean; base: number; overlay: React.ReactNode } {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(() => { try { return !reduce && sessionStorage.getItem(SEEN) !== '1'; } catch { return false; } });
  const done = () => { try { sessionStorage.setItem(SEEN, '1'); } catch { /* ignore */ } setActive(false); };
  useEffect(() => { if (!active) return; const t = setTimeout(done, 2900); const k = (e: KeyboardEvent) => e.key === 'Escape' && done(); window.addEventListener('keydown', k); return () => { clearTimeout(t); window.removeEventListener('keydown', k); }; }, [active]);
  const overlay = (
    <AnimatePresence>
      {active && (
        <motion.div key="intro" aria-hidden="true" onClick={done} className="fixed inset-0 z-[90] grid cursor-pointer place-items-center bg-[#080808]" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: 'easeInOut' }}>
          <motion.div className="pointer-events-none absolute h-72 w-72 rounded-full blur-3xl" style={{ background: 'rgb(255 106 0 / .28)' }} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1.15 }} transition={{ duration: 1.8, ease: 'easeOut' }} />
          <motion.div className="relative text-center" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ scale: 1.08 }} transition={{ duration: 0.9, ease: 'easeOut' }}>
            <p className="mb-2 text-sm font-semibold uppercase tracking-[.35em] text-white/60 sm:text-base">Welcome to</p>
            <h1 className="font-display text-6xl font-extrabold tracking-tight text-white sm:text-8xl">Admin <span style={{ color: ORANGE, textShadow: '0 0 28px rgb(255 106 0 / .6)' }}>Portal</span></h1>
          </motion.div>
        </motion.div>)}
    </AnimatePresence>);
  return { active, base: active ? 1.9 : 0, overlay };
}

/* ---------------------------------------------------------------- Line chart */
export interface Series { key: string; label: string; color: string; data: number[]; format(n: number): string }

const smooth = (pts: [number, number][], top: number, bottom: number) => {
  if (pts.length < 2) return '';
  const clampY = (y: number) => Math.min(bottom, Math.max(top, y));
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${clampY(p1[1] + (p2[1] - p0[1]) / 6)} ${p2[0] - (p3[0] - p1[0]) / 6},${clampY(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`;
  }
  return d;
};

/** Smooth curves that draw themselves left to right, with gradient areas fading in underneath. Each line is scaled to its own peak so both stay readable; the focused one is bolder. */
export function LineChart({ labels, series, focus, delay = 0, height = 260 }: { labels: string[]; series: Series[]; focus: string; delay?: number; height?: number }) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const W = 800, H = 240, padX = 8, top = 14, bottom = H - 22;
  const n = Math.max(1, labels.length);
  const x = (i: number) => padX + (n === 1 ? (W - 2 * padX) / 2 : (i / (n - 1)) * (W - 2 * padX));
  const shaped = useMemo(() => series.map((s) => {
    const max = Math.max(1, ...s.data); const pts = s.data.map((v, i) => [x(i), bottom - (v / max) * (bottom - top)] as [number, number]);
    const line = smooth(pts, top, bottom); const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0]},${bottom} L${pts[0][0]},${bottom} Z` : '';
    return { ...s, pts, line, area, max };
  }), [series, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const move = (e: React.PointerEvent<SVGSVGElement>) => { const r = box.current?.getBoundingClientRect(); if (!r) return; const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - padX) / (W - 2 * padX)) * (n - 1))))); };
  const t = (d: number) => (reduce ? { duration: 0 } : { duration: 1.6, delay: delay + d, ease: [0.4, 0, 0.2, 1] as const });
  return (
    <figure className="w-full">
      <div className="relative">
        <svg ref={box} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full touch-none" style={{ height }} role="img" aria-label={`${series.map((s) => s.label).join(' and ')}, last ${n} days`} onPointerMove={move} onPointerLeave={() => setHover(null)}>
          <defs>{shaped.map((s) => <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".38" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>)}</defs>
          {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={top + (bottom - top) * g} y2={top + (bottom - top) * g} stroke="#303030" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
          {shaped.map((s) => { const on = s.key === focus; return (
            <g key={s.key} style={{ opacity: on ? 1 : 0.45, transition: 'opacity .4s' }}>
              {s.area && <motion.path d={s.area} fill={`url(#${uid}-${s.key})`} initial={{ opacity: 0 }} animate={{ opacity: on ? 1 : 0.5 }} transition={reduce ? { duration: 0 } : { duration: 1, delay: delay + 1.1 }} />}
              <motion.path d={s.line} fill="none" stroke={s.color} strokeWidth={on ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ filter: on ? `drop-shadow(0 0 6px ${s.color}88)` : undefined }} initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={t(0)} />
            </g>); })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={bottom} stroke="#FF6A00" strokeOpacity=".5" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {hover !== null && shaped.map((s) => <circle key={s.key} cx={x(hover)} cy={s.pts[hover]?.[1] ?? bottom} r="4.5" fill="#080808" stroke={s.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
        </svg>
        <AnimatePresence>{hover !== null && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="pointer-events-none absolute top-1 rounded-xl border border-line bg-[#121212]/95 px-3 py-2 text-xs shadow-[0_8px_24px_-8px_#000]" style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > n / 2 ? '-105%' : '5%'})` }} aria-hidden="true">
            <div className="mb-1 font-semibold text-white">{labels[hover]}</div>{shaped.map((s) => <div key={s.key} className="flex items-center gap-2 text-muted"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}<b className="ml-auto pl-3 text-white">{s.format(s.data[hover] ?? 0)}</b></div>)}</motion.div>)}</AnimatePresence>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted"><span>{labels[0]}</span>
        <span className="flex flex-wrap gap-4">{shaped.map((s) => <span key={s.key} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label} · peak <b className="text-white">{s.format(s.max)}</b></span>)}</span><span>{labels[labels.length - 1]}</span></figcaption>
      <div className="sr-only"><table><caption>Daily figures</caption><tbody>{labels.map((l, i) => <tr key={l + i}><th>{l}</th>{series.map((s) => <td key={s.key}>{s.label}: {s.format(s.data[i] ?? 0)}</td>)}</tr>)}</tbody></table></div>
    </figure>
  );
}

/* ------------------------------------------------------------ Progress ring */
/** A circular progress indicator whose orange stroke draws round, with the percentage counting up in the middle. */
export function ProgressRing({ value, label, hint, delay = 0, size = 132 }: { value: number; label: string; hint?: string; delay?: number; size?: number }) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value)); const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(pct)} percent`}>
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90"><circle cx="60" cy="60" r={r} fill="none" stroke="#2a2a2a" strokeWidth="10" />
          <motion.circle cx="60" cy="60" r={r} fill="none" stroke={ORANGE} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} style={{ filter: 'drop-shadow(0 0 6px rgb(255 106 0 / .55))' }}
            initial={{ strokeDashoffset: reduce ? c * (1 - pct / 100) : c }} animate={{ strokeDashoffset: c * (1 - pct / 100) }} transition={reduce ? { duration: 0 } : { duration: 1.4, delay, ease: 'easeOut' }} /></svg>
        <div className="absolute inset-0 grid place-items-center font-display text-3xl font-bold text-white"><span><CountUp value={pct} format={(n) => `${Math.round(n)}%`} duration={1.4} /></span></div>
      </div>
      <div><p className="text-sm font-semibold text-white">{label}</p>{hint && <p className="mt-0.5 max-w-[16rem] text-xs text-muted">{hint}</p>}</div>
    </div>
  );
}

/** A thin orange line that sweeps across the top of a card when it is the focused one. */
export function AccentLine({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={cx('absolute inset-x-5 top-0 h-[2px] origin-left rounded bg-gradient-to-r from-[#FF6A00] to-[#FF8C32] transition-transform duration-700 ease-out', on ? 'scale-x-100' : 'scale-x-0')} />;
}
