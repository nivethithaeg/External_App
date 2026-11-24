import { createPortal } from 'react-dom';
import { memo, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, createContext, useContext } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cx, statusTone, titleCase } from '../lib/utils';
import { apiError } from '../lib/api';
import { autoRules } from '../lib/inputRules';

export function Button({ variant = 'primary', loading, children, className, disabled, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean }) {
  return (
    <button {...p} disabled={disabled || loading} className={cx(variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost', className)}>
      {loading && <Spinner size={16} />}{children}
    </button>
  );
}

export function Spinner({ size = 24 }: { size?: number }) {
  return <svg role="status" aria-label="Loading" width={size} height={size} viewBox="0 0 24 24" className="animate-spin"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

/** `mandatory` shows a red * after the label (drawn by CSS so the label text itself is unchanged for screen readers, which get aria-required instead). */
export function Field({ label, error, hint, mandatory, soft, children }: { label: string; error?: string; hint?: string; mandatory?: boolean; soft?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={cx('block text-xs font-semibold uppercase tracking-wide text-muted', mandatory && "after:ml-1 after:font-bold after:text-danger after:content-['*']")}>{label}</label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role={soft ? 'status' : 'alert'} className="text-xs text-danger">{error}</p>}
    </div>
  );
}
/**
 * Keeps wrong characters out of a box as the person types, and says why underneath ("Only letters are allowed here").
 * `blocked` matches the characters to remove; `max` caps the length; `upper` capitalises.
 */
export interface InputFilter { blocked: RegExp; message: string; max?: number; upper?: boolean }
function useFilter(filter: InputFilter | undefined, onChange: ((e: React.ChangeEvent<HTMLInputElement>) => void) | undefined) {
  const [note, setNote] = useState('');
  if (!filter) return { note: '', change: onChange, blur: () => undefined };
  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value; let v = raw.replace(new RegExp(filter.blocked.source, filter.blocked.flags.includes('g') ? filter.blocked.flags : `${filter.blocked.flags}g`), '');
    let msg = v !== raw ? filter.message : '';
    if (filter.upper) v = v.toUpperCase();
    if (filter.max && v.length > filter.max) { v = v.slice(0, filter.max); msg = `At most ${filter.max} characters are allowed here.`; }
    setNote(msg);
    if (v !== raw) e.target.value = v;
    onChange?.(e);
  };
  return { note, change, blur: () => setNote('') };
}
/**
 * Fills the gaps in a box from its label (an example inside it, what may be typed, what is valid) and checks it once the person leaves it,
 * saying what is wrong underneath. A form's own `placeholder`, `filter` and `error` always win.
 */
function useRules(label: string, p: { type?: string; autoComplete?: string; value?: unknown; placeholder?: string; required?: boolean }, filter: InputFilter | undefined, mandatory?: boolean, textarea?: boolean) {
  const rules = autoRules(label, { type: p.type, autoComplete: p.autoComplete, textarea });
  const [snap, setSnap] = useState<string | null>(null); // the value when the box was left (for boxes the form does not control)
  const value = p.value !== undefined ? String(p.value ?? '') : snap ?? '';
  const required = !!(mandatory || p.required);
  let soft = '';
  if (snap !== null) soft = required && !value.trim() ? 'This field is required.' : value ? rules.validate?.(value) ?? '' : '';
  return { placeholder: p.placeholder ?? rules.placeholder, filter: filter ?? rules.filter, soft, left: (v: string) => setSnap(v) };
}
export function Input({ label, error, hint, mandatory, filter, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; mandatory?: boolean; filter?: InputFilter }) {
  const r = useRules(label, p, filter, mandatory);
  const f = useFilter(r.filter, p.onChange);
  const soft = !error && !f.note && !!r.soft; error = error ?? (f.note || undefined) ?? (r.soft || undefined);
  const outerBlur = p.onBlur; // the caller's own handler, kept before ours replaces it
  p = { ...p, placeholder: r.placeholder, onChange: f.change, onBlur: (e) => { f.blur(); r.left(e.target.value); outerBlur?.(e); } };
  return <Field label={label} error={error} soft={soft} hint={hint} mandatory={mandatory || p.required}>{(id) => <input id={id} aria-required={mandatory || p.required ? true : undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...p} className={cx('field', error && 'border-danger', p.className)} />}</Field>;
}
/** Password field with a Show/Hide toggle. The toggle is a real button, reachable by keyboard, and announces its state. */
export function PasswordInput({ label, error, hint, mandatory, filter, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; error?: string; hint?: string; mandatory?: boolean; filter?: InputFilter }) {
  const [show, setShow] = useState(false);
  const r = useRules(label, { ...p, type: 'password' }, filter, mandatory);
  const f = useFilter(r.filter, p.onChange);
  const soft = !error && !f.note && !!r.soft; error = error ?? (f.note || undefined) ?? (r.soft || undefined);
  const outerBlur = p.onBlur; // the caller's own handler, kept before ours replaces it
  p = { ...p, placeholder: r.placeholder, onChange: f.change, onBlur: (e) => { f.blur(); r.left(e.target.value); outerBlur?.(e); } };
  return (
    <Field label={label} error={error} soft={soft} hint={hint} mandatory={mandatory || p.required}>{(id) => (
      <div className="relative">
        <input id={id} type={show ? 'text' : 'password'} aria-required={mandatory || p.required ? true : undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...p} className={cx('field !pr-16', error && 'border-danger', p.className)} />
        <button type="button" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((x) => !x)} className="absolute inset-y-0 right-3 text-xs font-semibold text-muted hover:text-ink">{show ? 'Hide' : 'Show'}</button>
      </div>)}</Field>
  );
}
/**
 * 12-hour time picker (hour, minute, AM/PM) that always shows AM/PM, whatever the computer's clock format is. Value and onChange use
 * the 24-hour "HH:mm" string the API expects.
 */
export function TimeInput({ label, ariaLabel, value, onChange, disabled, error }: { label?: string; ariaLabel?: string; value: string; onChange(v: string): void; disabled?: boolean; error?: string }) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  const h24 = m ? Math.min(23, Number(m[1])) : null, min = m ? Number(m[2]) : null;
  const ap = h24 === null ? '' : h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 === null ? '' : String(h24 % 12 === 0 ? 12 : h24 % 12);
  const emit = (h: string, mi: string, a: string) => {
    const hh = Number(h || 12) % 12 + (( a || 'AM') === 'PM' ? 12 : 0);
    onChange(`${String(hh).padStart(2, '0')}:${String(mi === '' ? 0 : Number(mi)).padStart(2, '0')}`);
  };
  const mins = Array.from({ length: 12 }, (_, i) => i * 5); if (min !== null && !mins.includes(min)) mins.push(min);
  const name = label ?? ariaLabel ?? 'Time';
  const sel = 'field !w-auto min-w-0 !px-2 !py-2';
  const body = (id?: string) => (
    <div role="group" aria-label={name} className="flex flex-wrap items-center gap-1.5">
      <select id={id} aria-label={`${name} hour`} className={sel} disabled={disabled} value={h12} onChange={(e) => emit(e.target.value, String(min ?? 0), ap)}>{h12 === '' && <option value="">--</option>}{Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}</option>)}</select>
      <span aria-hidden="true">:</span>
      <select aria-label={`${name} minutes`} className={sel} disabled={disabled} value={min === null ? '' : String(min)} onChange={(e) => emit(h12, e.target.value, ap)}>{min === null && <option value="">--</option>}{mins.sort((a, b) => a - b).map((v) => <option key={v} value={v}>{String(v).padStart(2, '0')}</option>)}</select>
      <select aria-label={`${name} AM or PM`} className={sel} disabled={disabled} value={ap} onChange={(e) => emit(h12, String(min ?? 0), e.target.value)}>{ap === '' && <option value="">--</option>}<option value="AM">AM</option><option value="PM">PM</option></select>
    </div>
  );
  return label ? <Field label={label} error={error}>{(id) => body(id)}</Field> : body();
}

export function Textarea({ label, error, mandatory, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; mandatory?: boolean }) {
  const r = useRules(label, p, undefined, mandatory, true); const soft = !error && !!r.soft; error = error ?? (r.soft || undefined);
  const outerBlur = p.onBlur; p = { ...p, placeholder: r.placeholder, onBlur: (e) => { r.left(e.target.value); outerBlur?.(e); } };
  return <Field label={label} error={error} soft={soft} mandatory={mandatory || p.required}>{(id) => <textarea id={id} rows={3} aria-required={mandatory || p.required ? true : undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...p} className={cx('field', error && 'border-danger', p.className)} />}</Field>;
}
export function Select({ label, error, hint, mandatory, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string; mandatory?: boolean }) {
  return <Field label={label} error={error} hint={hint} mandatory={mandatory || p.required}>{(id) => <select id={id} aria-required={mandatory || p.required ? true : undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...p} className={cx('field', error && 'border-danger', p.className)}>{children}</select>}</Field>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('card', className)}>{children}</div>;
}

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const tone = statusTone(status);
  return (
    <span key={status} className={cx('badge-pop inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
      tone === 'ok' && 'bg-ok/15 text-ok', tone === 'warn' && 'bg-warn/15 text-warn', tone === 'danger' && 'bg-danger/15 text-danger', tone === 'neutral' && 'bg-surface2 text-muted')}>
      {children ?? titleCase(status)}
    </span>
  );
}

/** The page's colour theme class, so a dialog drawn outside the page still uses the same palette. */
const themeClass = () => (typeof document === 'undefined' ? '' : document.querySelector('.admin-theme') ? 'admin-theme' : document.querySelector('.customer-theme') ? 'customer-theme' : '');

/** `locked` makes it impossible to skip: no close button, Escape or click outside. The content decides when it goes away. */
/** Inside this, a pop-up is drawn in place on the page (a tab's content) instead of over it. Pop-ups opened from it are normal again. */
export const InlineModalCtx = createContext(false);
export function Modal({ open, onClose, title, children, wide, locked }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean; locked?: boolean }) {
  const inline = useContext(InlineModalCtx);
  useEffect(() => {
    if (!open || locked || inline) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose, locked, inline]);
  if (!open) return null;
  if (inline) return <section aria-label={title} className="card p-5"><h2 className="mb-4 text-2xl font-bold">{title}</h2><InlineModalCtx.Provider value={false}>{children}</InlineModalCtx.Provider></section>;
  // drawn at the top level of the page, so no page layer (a sticky column, an animated card, the footer) can ever paint over it
  return createPortal(
    <div className={cx('fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4', themeClass())} onMouseDown={(e) => !locked && e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('card animate-rise max-h-[92vh] w-full overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">{title}</h2>
          {!locked && <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-surface2">✕</button>}</div>
        {children}
      </div>
    </div>, document.body);
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-3 py-16 text-muted"><Spinner /><span>{label}</span></div>;
}
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 border-danger/40 p-8 text-center">
      <div className="text-3xl">⚠️</div><p className="text-sm text-danger">{apiError(error)}</p>
      {retry && <Button variant="ghost" onClick={retry}>Try again</Button>}
    </div>
  );
}
export function Empty({ title, hint, action, icon = '🏟️' }: { title: string; hint?: string; action?: ReactNode; icon?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center"><div className="text-4xl">{icon}</div>
      <h3 className="text-xl font-bold">{title}</h3>{hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}{action}</div>
  );
}
export const SkeletonCards = ({ n = 6 }: { n?: number }) => (
  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton h-72" />)}</div>
);

/** Renders loading / error / empty / data states for a React Query result. */
export function QueryBoundary<T>({ q, children, empty }: { q: { isLoading: boolean; isError: boolean; error: unknown; data: T | undefined; refetch(): unknown }; children: (d: T) => ReactNode; empty?: (d: T) => boolean | ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.data === undefined) return null;
  const e = empty?.(q.data);
  if (e) return <>{e === true ? null : e}</>;
  return <>{children(q.data)}</>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange(v: any): void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition', value === t.id ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className={cx('card min-w-0 p-4 sm:p-5', accent && 'border-brand/50')}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-xs">{label}</p>
      <p className={cx('mt-1 break-words font-display text-2xl font-bold leading-tight sm:text-4xl', accent && 'text-[rgb(var(--brand-text))]')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export interface Column<T> { key: string; header: string; render?(row: T): ReactNode; className?: string; /** the value whose change should flash this cell (animated tables); defaults to row[key] */ watch?(row: T): unknown }

export function Table<T extends { id?: string }>({ columns, rows, onRow, animated, pageKey }: { columns: Column<T>[]; rows: T[]; onRow?(r: T): void; animated?: boolean; pageKey?: string | number }) {
  if (animated) return <AnimatedTable columns={columns} rows={rows} onRow={onRow} pageKey={pageKey} />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
          {columns.map((c) => <th key={c.key} className={cx('border-r border-line/60 px-4 py-3 font-semibold last:border-r-0', c.className)}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={(r as any).id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={cx('border-b border-line/60 last:border-0', onRow && 'cursor-pointer hover:bg-surface2/60')}>
              {columns.map((c) => <td key={c.key} className={cx('border-r border-line/60 px-4 py-3 align-middle last:border-r-0', c.className)}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The same table, with motion: rows rise in one after another, hovering lights a row with a sliding orange edge, rows can be ticked
 * (several at once), paging fades the old rows out and brings the new ones up under a stationary header, and a cell whose value
 * changes after a refresh flashes orange for a moment. Nothing about the columns, widths or colours changes.
 */
function AnimatedTable<T extends { id?: string }>({ columns, rows, onRow, pageKey }: { columns: Column<T>[]; rows: T[]; onRow?(r: T): void; pageKey?: string | number }) {
  const reduce = !!useReducedMotion();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [flash, setFlash] = useState<Set<string>>(() => new Set());
  const seen = useRef<Map<string, string[]>>(new Map());
  const idOf = (r: T, i: number) => String((r as any).id ?? i);
  const sig = (r: T) => columns.map((c) => { try { return JSON.stringify(c.watch ? c.watch(r) : (r as any)[c.key] ?? null); } catch { return ''; } });

  useEffect(() => { // find the cells that changed since the last data; the first load is never flashed
    const changed = new Set<string>(); const next = new Map<string, string[]>();
    rows.forEach((r, i) => { const id = idOf(r, i); const now = sig(r); const before = seen.current.get(id); next.set(id, now);
      if (before) now.forEach((v, ci) => { if (v !== before[ci]) changed.add(`${id}::${columns[ci].key}`); }); });
    seen.current = next;
    setPicked((p) => { const keep = new Set([...p].filter((id) => next.has(id))); return keep.size === p.size ? p : keep; }); // a row that left the table is no longer selected
    if (changed.size === 0) return;
    setFlash(changed); const t = setTimeout(() => setFlash(new Set()), 1800); return () => clearTimeout(t);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div>
      <AnimatePresence initial={false}>{picked.size > 0 && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
          <p role="status" className="mb-2 flex items-center gap-3 text-xs text-muted"><b className="text-ink">{picked.size} selected</b><button type="button" onClick={() => setPicked(new Set())} className="font-semibold text-[rgb(var(--brand-text))] hover:underline">Clear selection</button></p></motion.div>)}</AnimatePresence>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {columns.map((c) => <th key={c.key} className={cx('border-r border-line/60 px-4 py-3 font-semibold last:border-r-0', c.className)}>{c.header}</th>)}</tr></thead>
          <AnimatePresence mode="wait" initial={false}>
            <motion.tbody key={String(pageKey ?? 'all')} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.15 }}>
              {rows.map((r, i) => { const id = idOf(r, i); const on = picked.has(id);
                return (
                  <motion.tr key={id} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: Math.min(i, 10) * 0.08, ease: 'easeOut' }}
                    aria-selected={on || undefined} onClick={onRow ? () => onRow(r) : undefined} className={cx('bk-row border-b border-line/60 last:border-0', onRow && 'cursor-pointer', on && 'is-picked')}>
                    {columns.map((c, ci) => (
                      <td key={c.key} className={cx('border-r border-line/60 px-4 py-3 align-middle last:border-r-0', c.className, flash.has(`${id}::${c.key}`) && 'cell-flash')}>
                        {ci === 0 && <label className="fx-check bk-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="sr-only" aria-label="Select this row" checked={on} onChange={() => toggle(id)} /><span className="fx-box grid h-[15px] w-[15px] place-items-center rounded-[4px] border-2 border-line transition-colors" aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#101010" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg></span></label>}
                        {c.render ? c.render(r) : String((r as any)[c.key] ?? '—')}</td>))}
                  </motion.tr>); })}
            </motion.tbody>
          </AnimatePresence>
        </table>
      </div>
    </div>
  );
}

/** A page shown inside a tab of another page leaves its own title out and keeps only its buttons. */
export const EmbeddedCtx = createContext(false);
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  const embedded = useContext(EmbeddedCtx);
  if (embedded) return actions ? <div className="mb-3 flex flex-wrap justify-end gap-2">{actions}</div> : null;
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-4xl font-extrabold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <svg key={i} width={size} height={size} viewBox="0 0 24 24" style={{ animationDelay: `${i * 90}ms` }} className={cx('animate-star', i <= Math.round(value) ? 'fill-brand' : 'fill-line')}><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z" /></svg>)}
    </span>
  );
}
export function StarInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  return (
    <div role="radiogroup" aria-label="Rating" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} onClick={() => onChange(i)}>
          <svg width="30" height="30" viewBox="0 0 24 24" className={i <= value ? 'fill-brand' : 'fill-line hover:fill-brand/50'}><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z" /></svg>
        </button>
      ))}
    </div>
  );
}

export function ConfirmButton({ children, message, onConfirm, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { message: string; onConfirm(): void; variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean }) {
  return <Button {...p} onClick={() => { if (window.confirm(message)) onConfirm(); }}>{children}</Button>;
}
