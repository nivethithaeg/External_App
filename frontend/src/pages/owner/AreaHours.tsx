import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { apiError, put } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Button, Input, Modal } from '../../components/ui';
import { DAYS, cx } from '../../lib/utils';

/** JusGo's Opening hours form: the default price, the hours of each day of the week, and optional date-wise hours. */
type Day = { day: number; closed: boolean; open: string; close: string };
type Ex = { date: string; closed: boolean; open: string; close: string; reason: string };
const DAYTIME = { open: '06:00', close: '23:00' }, ALL_DAY = { open: '00:00', close: '24:00' };
const isAllDay = (o: string, c: string) => o === '00:00' && c === '24:00';
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const hhmm = (t?: string | null) => (t ?? '').slice(0, 5);
const label12 = (h: number, m: number) => `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
const TIMES = Array.from({ length: 48 }, (_, i) => { const h = Math.floor(i / 2), m = (i % 2) * 30; return { value: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, label: label12(h, m) }; });

function TimeSelect12({ label, value, onChange, midnightEnd }: { label: string; value: string; onChange(v: string): void; midnightEnd?: boolean }) {
  return <select aria-label={label} className="field !w-auto !py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
    {!TIMES.some((t) => t.value === value) && value !== '24:00' && <option value={value}>{value || 'Select'}</option>}
    {TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}{midnightEnd && <option value="24:00">12:00 AM (midnight)</option>}</select>;
}
function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return <label className={cx('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'opacity-60')}><input type="checkbox" role="switch" aria-label={label} className="h-4 w-4 accent-brand" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}
const Section = ({ title, hint, children, extra }: { title: ReactNode; hint: string; children: ReactNode; extra?: ReactNode }) => (
  <section className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-bold">{title}</h3>{extra}</div><p className="text-sm text-muted">{hint}</p>{children}</section>);

export function AreaHoursModal({ area, onClose, onSaved }: { area: any; onClose(): void; onSaved(): void }) {
  const { toast } = useToast();
  const def = ((area.pricing ?? []) as any[]).find((p) => p.sportId == null && p.dayType === 'all' && p.dayOfWeek == null && p.startTime === '00:00' && p.endTime === '24:00');
  const [basePrice, setBasePrice] = useState(def ? String(def.pricePerHour) : '');
  const [days, setDays] = useState<Day[]>(() => Array.from({ length: 7 }, (_, d) => { const x = (area.availability ?? []).find((a: any) => a.dayOfWeek === d); return { day: d, closed: x?.isClosed ?? false, open: hhmm(x?.openTime) || DAYTIME.open, close: hhmm(x?.closeTime) || DAYTIME.close }; }));
  const [ex, setEx] = useState<Ex[]>(() => ((area.hour_exceptions ?? []) as any[]).map((x) => ({ date: x.date, closed: !!x.closed, open: hhmm(x.openTime) || DAYTIME.open, close: hhmm(x.closeTime) || DAYTIME.close, reason: x.reason ?? '' })));
  const [attempted, setAttempted] = useState(false); const [error, setError] = useState('');
  const setDay = (d: number, patch: Partial<Day>) => setDays((all) => all.map((x) => (x.day === d ? { ...x, ...patch } : x)));
  const setE = (i: number, patch: Partial<Ex>) => setEx((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const priceErr = !(Number(basePrice) > 0) ? 'Enter the default price (more than 0).' : Number(basePrice) > 100000 ? 'The price can be at most ₹100000 an hour.' : '';
  const dayErr = (d: Day) => (!d.closed && d.close <= d.open ? 'Closing time must be after opening time.' : '');
  const exErr = (x: Ex) => (!x.date ? 'Pick the date.' : !x.closed && x.close <= x.open ? 'Closing time must be after opening time.' : '');
  const noDay = days.every((d) => d.closed);
  const dup = new Set(ex.map((x) => x.date).filter(Boolean)).size !== ex.filter((x) => x.date).length;
  const save = useMutation({
    mutationFn: async () => {
      await put(`/owner/areas/${area.id}/availability`, { days: days.map((d) => ({ dayOfWeek: d.day, openTime: d.open, closeTime: d.close, isClosed: d.closed })), exceptions: ex.map((x) => ({ date: x.date, closed: x.closed, ...(x.closed ? {} : { openTime: x.open, closeTime: x.close }), ...(x.reason.trim() ? { reason: x.reason.trim() } : {}) })) });
      if (!def || Number(def.pricePerHour) !== Number(basePrice)) await put(`/owner/areas/${area.id}/default-price`, { basePrice: Number(basePrice) }); // only the default price changes; every other price stays
    },
    onSuccess: () => { onSaved(); onClose(); toast('Opening hours and default price saved. Slots and bookings now follow them.'); }, onError: (e) => setError(apiError(e)),
  });
  const go = () => { setAttempted(true); setError(''); if (priceErr || noDay || dup || days.some((d) => dayErr(d)) || ex.some((x) => exErr(x))) return; save.mutate(); };
  return (
    <Modal open onClose={onClose} title={`Opening hours · ${area.name}`} wide>
      <div className="space-y-5">
        {!(area.availability ?? []).length && <p role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">Opening hours are not set yet, so this playing area cannot take bookings. Adjust the week below and save.</p>}
        <Section title={<>Default price <span className="text-danger" aria-hidden="true">*</span></>} hint="The price per hour for every time without its own slot price.">
          <div className="max-w-xs"><Input mandatory label="Default price (₹ per hour)" type="number" min={1} inputMode="decimal" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} error={attempted ? priceErr : undefined} /></div>
          <p className="text-sm text-muted">You can change this price any time. To charge a different price for some times, days, dates or apps (for example ₹500 an hour for 6–10 PM, or more on weekends), go to <Link to="/owner/pricing" className="font-semibold underline">Pricing</Link>. Any time without its own price there uses this default price.</p>
        </Section>
        <Section title={<>Day-wise hours <span className="text-danger" aria-hidden="true">*</span></>} hint="The hours of each day of the week, every week. Turn a day off to close the playing area on that day.">
          <ul className="divide-y divide-line rounded-xl border border-line">{WEEK.map((n) => { const d = days.find((x) => x.day === n)!; return (
            <li key={n} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3"><span className="w-24 text-sm font-semibold">{DAYS[n]}</span>
              <Toggle label={d.closed ? 'Closed' : 'Open'} checked={!d.closed} onChange={(open) => setDay(n, open ? { closed: false, ...DAYTIME } : { closed: true })} />
              {!d.closed && <Toggle label="24 hours" checked={isAllDay(d.open, d.close)} onChange={(on) => setDay(n, on ? ALL_DAY : DAYTIME)} />}
              {!d.closed && !isAllDay(d.open, d.close) && <div className="flex flex-wrap items-center gap-2"><TimeSelect12 label={`${DAYS[n]} opens`} value={d.open} onChange={(v) => setDay(n, { open: v })} /><span className="text-muted">to</span><TimeSelect12 label={`${DAYS[n]} closes`} midnightEnd value={d.close} onChange={(v) => setDay(n, { close: v })} /></div>}
              <button type="button" className="ml-auto text-sm font-semibold underline" onClick={() => setDays((all) => all.map((x) => ({ ...x, closed: d.closed, open: d.open, close: d.close })))}>Same for all days</button>
              {attempted && dayErr(d) && <p role="alert" className="basis-full text-xs text-danger">{dayErr(d)}</p>}</li>); })}</ul>
          {attempted && noDay && <p role="alert" className="text-xs text-danger">Keep at least one day open.</p>}
        </Section>
        <Section title={<>Date-wise hours <span className="text-sm font-normal text-muted">(Optional)</span></>} hint="A holiday, an event or a shorter day: on these dates these hours are used instead of the day-wise hours."
          extra={<Button type="button" variant="ghost" onClick={() => setEx([...ex, { date: '', closed: true, open: '', close: '', reason: '' }])}>+ Add date</Button>}>
          {ex.length === 0 ? <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">No special dates.</p> : (
            <ul className="space-y-3">{ex.map((x, i) => (
              <li key={i} className="rounded-xl border border-line p-3"><div className="flex flex-wrap items-end gap-3">
                <div><label className="field-label mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={`ex-date-${i}`}>Date</label><input id={`ex-date-${i}`} type="date" className="field !w-44" value={x.date} onChange={(e) => setE(i, { date: e.target.value })} /></div>
                <Toggle label="Closed all day" checked={x.closed} onChange={(c) => setE(i, c ? { closed: true, open: '', close: '' } : { closed: false, ...DAYTIME })} />
                {!x.closed && <Toggle label="24 hours" checked={isAllDay(x.open, x.close)} onChange={(on) => setE(i, on ? ALL_DAY : DAYTIME)} />}
                {!x.closed && !isAllDay(x.open, x.close) && <div className="flex flex-wrap items-center gap-2"><TimeSelect12 label="Opens" value={x.open} onChange={(v) => setE(i, { open: v })} /><span className="text-muted">to</span><TimeSelect12 label="Closes" midnightEnd value={x.close} onChange={(v) => setE(i, { close: v })} /></div>}
                <div className="min-w-[10rem] flex-1"><label className="field-label mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={`ex-reason-${i}`}>Reason <span className="font-normal normal-case">(Optional)</span></label><input id={`ex-reason-${i}`} className="field" value={x.reason} maxLength={100} placeholder="e.g. Pongal holiday" onChange={(e) => setE(i, { reason: e.target.value })} /></div>
                <Button type="button" variant="ghost" aria-label={`Remove special date ${i + 1}`} onClick={() => setEx(ex.filter((_, j) => j !== i))}>🗑</Button></div>
                {attempted && exErr(x) && <p role="alert" className="mt-1 text-xs text-danger">{exErr(x)}</p>}</li>))}</ul>)}
          {attempted && dup && <p role="alert" className="text-xs text-danger">A date is listed twice.</p>}
        </Section>
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="button" loading={save.isPending} onClick={go}>Save opening hours</Button></div>
      </div>
    </Modal>
  );
}
