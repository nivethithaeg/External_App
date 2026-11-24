import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cx } from '../lib/utils';

/** The KICKOFF orange, used for every active state in the filter section. */
export const NEON = '#FF6500';

/* ------------------------------------------------------------- Dropdown */
export interface Opt { value: string; label: string }

/**
 * A dropdown that expands and collapses smoothly: the arrow turns 180 degrees, options fade in one by one and the
 * chosen option is picked out in green. A real ARIA listbox with keyboard support (arrows, Enter, Esc, Home/End).
 */
export function FancySelect({ label, value, onChange, options, disabled, placeholder = 'Select' }: { label: string; value: string; onChange(v: string): void; options: Opt[]; disabled?: boolean; placeholder?: string }) {
  const uid = useId(); const btn = `${uid}-b`, lab = `${uid}-l`, list = `${uid}-o`;
  const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null); const btnRef = useRef<HTMLButtonElement>(null);
  const cur = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const openList = () => { if (disabled) return; setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (o: Opt) => { onChange(o.value); setOpen(false); btnRef.current?.focus(); };
  const key = (e: KeyboardEvent) => {
    if (disabled) return;
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); } else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) pick(options[active]); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div ref={root} className="relative">
      <span id={lab} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <button ref={btnRef} id={btn} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={list} aria-labelledby={`${lab} ${btn}`}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={key}
        className={cx('field flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50', open && '!border-[#FF6500] !shadow-[0_0_0_3px_rgb(255_101_0/.18)]')}>
        <span className={cx('truncate', !cur && 'text-muted/70')}>{cur?.label ?? placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cx('shrink-0 text-muted transition-transform duration-200', open && 'rotate-180 text-[#FF6500]')}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul id={list} role="listbox" aria-labelledby={lab} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute inset-x-0 z-30 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/.7)]">
            {options.map((o, i) => (
              <motion.li key={o.value || '__all'} role="option" aria-selected={o.value === value} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.02, duration: 0.18 }}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}
                className={cx('flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors', o.value === value ? 'font-semibold text-[#FF6500]' : 'text-ink', active === i && 'bg-[#FF6500]/10')}>
                <span className="truncate">{o.label}</span>
                {o.value === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path className="draw-tick" d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </motion.li>))}
          </motion.ul>)}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------- Price range */
/** Two-thumb price slider with a green progress track. Thumbs grow while dragged; the value is committed when released. */
export function PriceRange({ min, max, bound = 5000, step = 100, onCommit }: { min: number | null; max: number | null; bound?: number; step?: number; onCommit(min: number | null, max: number | null): void }) {
  const [lo, setLo] = useState(min ?? 0); const [hi, setHi] = useState(max ?? bound);
  useEffect(() => { setLo(min ?? 0); setHi(max ?? bound); }, [min, max, bound]);
  const commit = (l = lo, h = hi) => onCommit(l <= 0 ? null : l, h >= bound ? null : h);
  const pct = (v: number) => (v / bound) * 100;
  const fmt = (v: number, top = false) => (top && v >= bound ? `₹${bound}+` : `₹${v}`);
  return (
    <div role="group" aria-label="Price range per hour">
      <div className="mb-3 flex items-baseline justify-between text-sm"><span className="text-xs font-semibold uppercase tracking-wide text-muted">Price per hour</span>
        <span className="font-semibold tabular-nums text-ink" aria-live="polite">{fmt(lo)} – {fmt(hi, true)}</span></div>
      <div className="dual-range relative h-6">
        <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-[left,width] duration-100" style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%`, background: NEON, boxShadow: '0 0 10px rgb(255 101 0 / .45)' }} />
        <input type="range" aria-label="Minimum price" min={0} max={bound} step={step} value={lo} onChange={(e) => setLo(Math.min(+e.target.value, hi - step))} onPointerUp={() => commit()} onKeyUp={() => commit()} onBlur={() => commit()} />
        <input type="range" aria-label="Maximum price" min={0} max={bound} step={step} value={hi} onChange={(e) => setHi(Math.max(+e.target.value, lo + step))} onPointerUp={() => commit()} onKeyUp={() => commit()} onBlur={() => commit()} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted"><span>₹0</span><span>₹{bound}+</span></div>
    </div>
  );
}

/* ------------------------------------------------- Checkbox and radio */
export function FancyCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="fx-check group flex cursor-pointer items-center gap-2.5 py-1 text-sm">
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="fx-box grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 border-line transition-colors duration-150 group-hover:border-[#FF6500]/70" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#101010" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      <span className="transition-colors group-hover:text-ink">{label}</span>
    </label>
  );
}
export function FancyRadio({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange(): void }) {
  return (
    <label className="fx-radio group flex cursor-pointer items-center gap-2.5 py-1 text-sm">
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onChange} />
      <span className="fx-dot grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-line transition-colors duration-150 group-hover:border-[#FF6500]/70" aria-hidden="true"><i className="h-2.5 w-2.5 rounded-full" /></span>
      <span className="transition-colors group-hover:text-ink">{label}</span>
    </label>
  );
}

/* ---------------------------------------------------------- Sport cards */
const ICON: Record<string, string> = { football: '⚽', cricket: '🏏', badminton: '🏸', tennis: '🎾', basketball: '🏀', volleyball: '🏐' };
/** Pick one sport (click again to clear). Selected cards turn green with a tick that draws itself; the icon does one small bounce. */
export function SportCards({ sports, value, onChange }: { sports: { id: number; name: string; slug: string }[]; value: string; onChange(slug: string): void }) {
  return (
    <div role="radiogroup" aria-label="Sport" className="grid grid-cols-2 gap-2">
      {sports.map((s) => { const on = value === s.slug; return (
        <motion.button key={s.slug} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? '' : s.slug)} whileTap={{ scale: 0.96 }}
          className={cx('relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-200', on ? 'border-[#FF6500] bg-[#FF6500]/10 text-ink shadow-[0_0_0_1px_rgb(255_101_0/.35)]' : 'border-line text-muted hover:border-[#FF6500]/50 hover:text-ink')}>
          <span key={String(on)} className={cx('text-xl', on && 'animate-pop')} aria-hidden="true">{ICON[s.slug] ?? '🏟️'}</span>
          <span className="truncate">{s.name}</span>
          <AnimatePresence>{on && <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }} className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full" style={{ background: NEON }} aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path className="draw-tick" d="M5 12.5l4.5 4.5L19 7" stroke="#101010" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg></motion.span>}</AnimatePresence>
        </motion.button>); })}
    </div>
  );
}
