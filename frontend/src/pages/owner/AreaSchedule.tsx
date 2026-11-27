import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiError, put } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Modal, Select, TimeInput } from '../../components/ui';
import { DAYS, cx } from '../../lib/utils';
import { buildPrices, defaultRule, fmtSlot, slotStarts, toMin, toRules, unpricedCount, type Day, type Prices, type Scope } from '../../lib/schedule';

/** The slot whose price was copied; Paste puts that price on another slot. */
type Copy = { scope: Scope; dow: number; m: number };

/**
 * One window for a playing area's opening hours and prices. Set when each day opens and closes and the slots appear for exactly those
 * hours, with a price under each one. Prices can be copied to other slots, to the same slots on other days, or a whole day to other days.
 */
const DayChip = ({ label, ariaLabel, checked, onChange }: { label: string; ariaLabel?: string; checked: boolean; onChange(v: boolean): void }) => (
  <label className={cx('flex cursor-pointer select-none items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition focus-within:ring-2 focus-within:ring-brand/40', checked ? 'border-brand bg-brand/15 text-ink shadow-sm' : 'border-line text-muted hover:border-brand/60 hover:bg-surface2 hover:text-ink')}>
    <input type="checkbox" aria-label={ariaLabel} className="h-4 w-4 cursor-pointer accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>);

export function ScheduleModal({ area, sports, onClose, onSaved }: { area: any; sports: { id: number; name: string }[]; onClose(): void; onSaved(): void }) {
  const { toast } = useToast();
  const step: number = area.slot_minutes ?? 60;
  const scopes = useMemo<Scope[]>(() => ['all', ...((area.sport_ids ?? []) as number[])], [area]);
  const [days, setDays] = useState<Day[]>(() => Array.from({ length: 7 }, (_, d) => {
    const x = (area.availability ?? []).find((a: any) => a.dayOfWeek === d);
    return { dayOfWeek: d, openTime: x?.openTime ?? '06:00', closeTime: x?.closeTime ?? '23:00', isClosed: x?.isClosed ?? false };
  }));
  const def = defaultRule(area.pricing ?? []); // the default price: every slot without its own price costs this
  const defSlot = def ? Math.round((Number(def.pricePerHour) * step) / 60 * 100) / 100 : undefined;
  // every slot starts at the default price; the owner changes only the slots that cost something else
  const [prices, setPrices] = useState<Prices>(() => {
    const p = buildPrices(area.pricing ?? [], days0(area), scopes, step);
    if (defSlot !== undefined) for (const d of Array.from({ length: 7 }, (_, i) => i)) { const row = { ...(p.all?.[d] ?? {}) }; for (const m of slotStarts(days0(area)[d], step)) if (row[m] === undefined) row[m] = defSlot; p.all = { ...(p.all ?? {}), [d]: row }; }
    return p;
  });
  const [dow, setDow] = useState(() => { const first = (area.availability ?? []).find((a: any) => !a.isClosed); return first ? first.dayOfWeek : 1; });
  const [scope, setScope] = useState<Scope>('all');
  const [copy, setCopy] = useState<Copy | null>(null);
  const [dayCopy, setDayCopy] = useState<number[] | null>(null); const [pasteDays, setPasteDays] = useState<number[]>([]);
  const [fill, setFill] = useState({ value: '', every: false });
  const [err, setErr] = useState('');
  const [blank, setBlank] = useState<Set<string>>(new Set()); // boxes the owner emptied while typing: shown empty (they still cost the default)

  const day = days[dow]; const slots = slotStarts(day, step);
  const key = String(scope);
  const priceOf = (sc: Scope, d: number, m: number) => prices[String(sc)]?.[d]?.[m];
  const setPrice = (sc: Scope, d: number, m: number, v: number | undefined) => setPrices((p) => {
    const row = { ...(p[String(sc)]?.[d] ?? {}) }; if (v === undefined) delete row[m]; else row[m] = v;
    return { ...p, [String(sc)]: { ...(p[String(sc)] ?? {}), [d]: row } };
  });
  const setMany = (sc: Scope, d: number, ms: number[], v: number | undefined) => setPrices((p) => {
    const row = { ...(p[String(sc)]?.[d] ?? {}) }; for (const m of ms) { if (v === undefined) delete row[m]; else row[m] = v; }
    return { ...p, [String(sc)]: { ...(p[String(sc)] ?? {}), [d]: row } };
  });
  const patchDay = (d: number, patch: Partial<Day>) => setDays((all) => all.map((x) => (x.dayOfWeek === d ? { ...x, ...patch } : x)));

  const unpriced = unpricedCount(prices, days, step, !!def);
  const pricedToday = slots.filter((m) => priceOf('all', dow, m) !== undefined && (defSlot === undefined || priceOf('all', dow, m) !== defSlot)).length;
  // the sport chosen in "Prices for": how many slots have a price of their own for that sport
  const sportPriced = scope === 'all' ? 0 : slots.filter((m) => priceOf(scope, dow, m) !== undefined).length;
  const scopeName = scope === 'all' ? '' : (sports.find((x) => x.id === scope)?.name ?? 'this sport');

  const applyFill = () => {
    const v = Number(fill.value); if (fill.value === '' || !(v >= 0)) return setErr('Enter the price to set for every slot');
    setErr(''); const targets = fill.every ? days.filter((d) => !d.isClosed) : [day];
    for (const d of targets) setMany(scope, d.dayOfWeek, slotStarts(d, step), v);
    toast(`Every slot ${fill.every ? 'on all open days' : `on ${DAYS[dow]}`} is now ₹${v}`, 'info');
  };
  const startCopy = (m: number) => { const v = priceOf(scope, dow, m); if (v === undefined) return setErr('Enter a price in that slot first, then copy it.'); setErr(''); setCopy({ scope, dow, m }); };
  const copiedPrice = copy ? priceOf(copy.scope, copy.dow, copy.m) : undefined;
  /** Paste the copied price straight onto one slot, a group of slots, or the same time on another day. */
  const pasteOn = (ms: number[]) => { if (copy && copiedPrice !== undefined) setMany(copy.scope, dow, ms, copiedPrice); }; // onto the day being viewed
  const pasteOnDay = (d: number) => { if (copy && copiedPrice !== undefined && slotStarts(days[d], step).includes(copy.m)) setMany(copy.scope, d, [copy.m], copiedPrice); };
  const applyDayCopy = () => {
    if (!dayCopy) return;
    setDays((all) => all.map((x) => (dayCopy.includes(x.dayOfWeek) ? { ...x, openTime: day.openTime, closeTime: day.closeTime, isClosed: day.isClosed } : x)));
    setPrices((p) => { const out: Prices = {}; for (const [k, byDay] of Object.entries(p)) { const next = { ...byDay }; for (const t of dayCopy) next[t] = { ...(byDay[dow] ?? {}) }; out[k] = next; } return out; });
    toast(`${DAYS[dow]}'s hours and prices copied to ${dayCopy.length} day${dayCopy.length === 1 ? '' : 's'}. Press Save to keep them.`, 'info'); setDayCopy(null);
  };

  const save = useMutation({
    mutationFn: () => {
      const bad = days.find((d) => !d.isClosed && toMin(d.closeTime) <= toMin(d.openTime));
      if (bad) throw new Error(`${DAYS[bad.dayOfWeek]}: closing time must be after opening time`);
      // a slot at the default price is not saved as a price of its own: it keeps following the default
      const own: Prices = defSlot === undefined ? prices : { ...prices, all: Object.fromEntries(Object.entries(prices.all ?? {}).map(([d, row]) => [d, Object.fromEntries(Object.entries(row).filter(([, v]) => v !== defSlot))])) };
      return put(`/owner/areas/${area.id}/schedule`, { days, rules: [...toRules(own, days, step), ...(def ? [{ sportId: null, dayType: 'all' as const, dayOfWeek: null, startTime: '00:00', endTime: '24:00', pricePerHour: Number(def.pricePerHour) }] : [])] }); // the default price is kept
    },
    onSuccess: () => { onSaved(); onClose(); toast('Hours and prices saved'); }, onError: (e) => setErr(apiError(e)),
  });

  const sportName = (sc: Scope) => (sc === 'all' ? 'All sports' : sports.find((s) => s.id === sc)?.name ?? 'Sport');
  return (
    <Modal open onClose={onClose} title={`Hours & pricing · ${area.name}`} wide>
      <p className="mb-3 text-sm text-muted">Choose when each day opens and closes. The slots appear for exactly those hours ({step}-minute slots). Type the price of each slot, then copy it to other slots or days.</p>

      <div role="tablist" aria-label="Day of the week" className="mb-3 flex flex-wrap gap-1.5">
        {days.map((d) => <button key={d.dayOfWeek} role="tab" aria-selected={dow === d.dayOfWeek} onClick={() => { setDow(d.dayOfWeek); setDayCopy(null); }}
          className={cx('rounded-xl border px-3 py-1.5 text-sm font-semibold transition', dow === d.dayOfWeek ? 'border-brand bg-brand/15 text-ink' : 'border-line text-muted hover:text-ink', d.isClosed && dow !== d.dayOfWeek && 'opacity-60')}>
          {DAYS[d.dayOfWeek].slice(0, 3)}{d.isClosed && <span className="ml-1 text-[10px] font-normal">closed</span>}</button>)}
      </div>

      <div className="space-y-4 rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <b className="w-24">{DAYS[dow]}</b>
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={day.isClosed} onChange={(e) => patchDay(dow, { isClosed: e.target.checked })} />Closed all day</label>
          <TimeInput ariaLabel={`${DAYS[dow]} opens`} disabled={day.isClosed} value={day.openTime} onChange={(v) => patchDay(dow, { openTime: v })} />
          <span className="text-muted">to</span>
          <TimeInput ariaLabel={`${DAYS[dow]} closes`} disabled={day.isClosed} value={day.closeTime} onChange={(v) => patchDay(dow, { closeTime: v })} />
          <button type="button" aria-expanded={!!dayCopy} onClick={() => setDayCopy(dayCopy ? null : [])} className="ml-auto rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold hover:bg-surface2">Copy this day to ▾</button>
        </div>

        {dayCopy && (
          <div role="group" aria-label={`Copy ${DAYS[dow]} to`} className="space-y-2 rounded-lg bg-surface2/60 p-3">
            <p className="text-xs text-muted">Copy {DAYS[dow]}'s opening hours and every slot price to:</p>
            <div className="flex flex-wrap gap-2">{days.filter((d) => d.dayOfWeek !== dow).map((d) => <DayChip key={d.dayOfWeek} label={DAYS[d.dayOfWeek].slice(0, 3)} ariaLabel={DAYS[d.dayOfWeek].slice(0, 3)} checked={dayCopy.includes(d.dayOfWeek)} onChange={(v) => setDayCopy(v ? [...dayCopy, d.dayOfWeek] : dayCopy.filter((x) => x !== d.dayOfWeek))} />)}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" className="underline" onClick={() => setDayCopy(days.filter((d) => d.dayOfWeek !== dow).map((d) => d.dayOfWeek))}>All days</button>
              <button type="button" className="underline" onClick={() => setDayCopy([1, 2, 3, 4, 5].filter((d) => d !== dow))}>Weekdays</button>
              <button type="button" className="underline" onClick={() => setDayCopy([0, 6].filter((d) => d !== dow))}>Weekends</button>
              <span className="ml-auto flex gap-2"><Button type="button" variant="ghost" className="!py-1" onClick={() => setDayCopy(null)}>Cancel</Button><Button type="button" className="!py-1" disabled={!dayCopy.length} onClick={applyDayCopy}>Copy day</Button></span></div>
          </div>)}

        {day.isClosed ? <p className="rounded-lg bg-surface2/60 p-3 text-sm text-muted">{DAYS[dow]} is closed, so it has no slots. Untick "Closed all day" to open it.</p> : slots.length === 0 ? <p className="rounded-lg bg-warn/10 p-3 text-sm text-warn">Closing time must leave room for at least one {step}-minute slot.</p> : (<>
          <div className="flex flex-wrap items-end gap-3">
            {scopes.length > 1 && <div className="w-48"><Select label="Prices for" value={String(scope)} onChange={(e) => { setScope(e.target.value === 'all' ? 'all' : Number(e.target.value)); setCopy(null); }}>{scopes.map((sc) => <option key={String(sc)} value={String(sc)}>{sportName(sc)}</option>)}</Select></div>}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted">Set every slot to ₹<input type="number" min={0} inputMode="decimal" aria-label="Price for every slot" className="field mt-1 !w-28 !py-1.5" value={fill.value} onChange={(e) => setFill({ ...fill, value: e.target.value })} /></label>
              <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={fill.every} onChange={(e) => setFill({ ...fill, every: e.target.checked })} />every open day</label>
              <Button type="button" variant="ghost" className="!py-1.5" onClick={applyFill}>Apply</Button>
            </div>
            <p className="ml-auto pb-2 text-xs text-muted">{scope !== 'all' ? `${sportPriced} of ${slots.length} slot${slots.length === 1 ? ' has' : 's have'} a ${scopeName} price of ${sportPriced === 1 ? 'its' : 'their'} own; the others use the all-sports price` : def ? `Every slot is filled with the default ₹${defSlot}. ${pricedToday} of ${slots.length} changed to a different price` : `${pricedToday} of ${slots.length} slots priced`}</p>
          </div>
          {scope !== 'all' && <p className="text-xs text-muted">Leave a slot empty to use the all-sports price shown in grey. Only fill it in where {sportName(scope)} costs something different.</p>}

          {copy && (
            <div role="group" aria-label="Copy price" className="space-y-2 rounded-lg border border-brand/40 bg-brand/10 p-3">
              <p className="text-sm font-semibold">Copied ₹{copiedPrice} from {fmtSlot(copy.m)}{copy.dow !== dow ? ` (${DAYS[copy.dow]})` : ''}. Press <b>Paste</b> on any slot to use it there.</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <button type="button" className="underline" onClick={() => pasteOn(slots.filter((m) => m !== copy.m || copy.dow !== dow))}>Paste on all slots this day</button>
                <button type="button" className="underline" onClick={() => pasteOn(slots.filter((m) => m > copy.m || copy.dow !== dow))}>Paste on the slots after it</button>
                {copy.dow === dow && days.filter((d) => d.dayOfWeek !== dow && !d.isClosed).length > 0 && <span className="flex flex-wrap items-center gap-2"><span className="text-muted">Same time on:</span>
                  {days.filter((d) => d.dayOfWeek !== dow && !d.isClosed).map((d) => <DayChip key={d.dayOfWeek} label={DAYS[d.dayOfWeek].slice(0, 3)} ariaLabel={`Paste on ${DAYS[d.dayOfWeek]}`} checked={pasteDays.includes(d.dayOfWeek)} onChange={(v) => setPasteDays(v ? [...pasteDays, d.dayOfWeek] : pasteDays.filter((x) => x !== d.dayOfWeek))} />)}
                  <Button type="button" variant="ghost" className="!py-1" disabled={!pasteDays.length} onClick={() => { pasteDays.forEach(pasteOnDay); setPasteDays([]); }}>Paste on selected days</Button></span>}
                <Button type="button" className="ml-auto !py-1" onClick={() => setCopy(null)}>Done</Button>
              </div>
            </div>)}

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label={`${DAYS[dow]} slots`}>
            {slots.map((m) => {
              const bk = `${String(scope)}:${dow}:${m}`; const v = priceOf(scope, dow, m) ?? (scope === 'all' && !blank.has(bk) ? defSlot : undefined); // a slot with no price of its own (also one added by longer hours) shows the default price
              const fallback = scope === 'all' ? defSlot : priceOf('all', dow, m) ?? defSlot;
              const isSource = copy?.m === m && copy.scope === scope && copy.dow === dow;
              const canPaste = !!copy && copy.scope === scope && !isSource && copiedPrice !== undefined;
              return (
                <li key={m} className={cx('rounded-xl border p-2', v === undefined && scope === 'all' && !def ? 'border-warn/60 bg-warn/5' : 'border-line', isSource && 'border-brand ring-1 ring-brand')}>
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <span className="text-xs font-bold">{fmtSlot(m)}</span>
                    {isSource ? <span className="text-[10px] font-bold uppercase text-[rgb(var(--brand-text))]">Copied</span>
                      : canPaste ? <button type="button" aria-label={`Paste on ${fmtSlot(m)}`} onClick={() => pasteOn([m])} className="rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-bold text-brand-ink">Paste</button>
                      : <button type="button" aria-label={`Copy ${fmtSlot(m)} price`} title="Copy this price" disabled={v === undefined} onClick={() => startCopy(m)} className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30">⧉</button>}
                  </div>
                  <label className="flex items-center gap-1 rounded-lg border border-line bg-surface2/60 px-2 py-1 text-sm focus-within:border-brand"><span className="text-muted">₹</span>
                    <input type="number" min={0} inputMode="decimal" aria-label={`${fmtSlot(m)} price`} placeholder={fallback !== undefined ? String(fallback) : 'Price'} value={v ?? ''} className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted/60"
                      onChange={(e) => { const raw = e.target.value; const nb = new Set(blank); if (raw === '') { nb.add(bk); setBlank(nb); return setPrice(scope, dow, m, undefined); } nb.delete(bk); setBlank(nb); const n = Number(raw); if (n >= 0) setPrice(scope, dow, m, n); }} /></label>
                </li>);
            })}
          </ul>
        </>)}
      </div>

      {unpriced > 0 && <p role="status" className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm"><b>{unpriced} open slot{unpriced === 1 ? ' has' : 's have'} no price</b>, so customers can't book {unpriced === 1 ? 'it' : 'them'}. They are outlined in orange. Use "Set every slot to" or the copy button to fill them in quickly.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">{err && <span role="alert" className="mr-auto text-sm text-danger">{err}</span>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => { setErr(''); save.mutate(); }}>Save hours & prices</Button></div>
    </Modal>
  );
}

/** The days as saved, used to read prices for slots that exist in the saved hours. */
function days0(area: any): Day[] {
  return Array.from({ length: 7 }, (_, d) => {
    const x = (area.availability ?? []).find((a: any) => a.dayOfWeek === d);
    return { dayOfWeek: d, openTime: x?.openTime ?? '06:00', closeTime: x?.closeTime ?? '23:00', isClosed: x?.isClosed ?? false };
  });
}
