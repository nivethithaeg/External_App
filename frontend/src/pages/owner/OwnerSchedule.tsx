import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, post } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, PageHeader, QueryBoundary, Select, Table, Tabs, Textarea, TimeInput } from '../../components/ui';
import { cx, fmtDate, fmtRange, fmtTime, money, todayISO, titleCase } from '../../lib/utils';
import { isIndianMobile } from '../../lib/phone';

const TZ = 'Asia/Kolkata'; // venues default to IST; item times are rendered in this zone
const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const startOf = (ymd: string) => `${ymd}T00:00:00+05:30`;
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

type Kind = 'booked' | 'pending' | 'blocked' | 'maintenance';
const kindOf = (i: any): Kind => (i.status === 'blocked' ? (i.block_kind === 'maintenance' ? 'maintenance' : 'blocked') : i.status === 'pending' ? 'pending' : 'booked');
const KIND: Record<Kind, { label: string; cls: string }> = {
  booked: { label: 'Booked', cls: 'bg-brand text-brand-ink' }, pending: { label: 'Pending payment', cls: 'bg-warn/80 text-black' },
  blocked: { label: 'Blocked', cls: 'bg-danger/70 text-white' }, maintenance: { label: 'Maintenance', cls: 'bg-purple-500/80 text-white' },
};

export function CalendarPage() {
  const today = localDate(new Date().toISOString()); // today in India time
  const [date, setDate] = useState(today); // the day picked on the calendar; its slots and bookings are shown below
  const [month, setMonth] = useState(today.slice(0, 7)); // 'YYYY-MM' of the month on show
  const [venueId, setVenueId] = useState(''); const [areaId, setAreaId] = useState('');
  const [sel, setSel] = useState<any>(null);
  const [multi, setMulti] = useState<{ areaId: string; from: number; to: number } | null>(null); // free slots picked on the grid: one playing area, consecutive hours
  const areasQ = useQuery({ queryKey: ['owner-areas'], queryFn: () => get<{ areas: any[] }>('/owner/areas') });
  const venues = useMemo(() => { const m = new Map<string, string>(); areasQ.data?.areas.forEach((a) => m.set(a.venue_id, a.venue_name)); return [...m]; }, [areasQ.data]);
  const areas = (areasQ.data?.areas ?? []).filter((a) => (!venueId || a.venue_id === venueId) && (!areaId || a.id === areaId));

  const gridStart = useMemo(() => { const first = `${month}-01`; return addDays(first, -dow(first)); }, [month]);
  const gridDays = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const range = useMemo(() => [gridStart, addDays(gridStart, 42)], [gridStart]);
  const q = useQuery({ queryKey: ['owner-calendar', range, venueId, areaId], queryFn: () => get<{ items: any[] }>('/owner/calendar', { from: startOf(range[0]), to: startOf(range[1]), venueId: venueId || undefined, areaId: areaId || undefined }), refetchInterval: 60000 });
  const items = q.data?.items ?? [];
  const isToday = date === today;
  const prettyDay = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const title = isToday ? `Today · ${prettyDay}` : prettyDay;
  const monthTitle = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const byDay = useMemo(() => { const m = new Map<string, any[]>(); for (const x of items) { const d = localDate(x.starts_at); m.set(d, [...(m.get(d) ?? []), x]); } return m; }, [items]);
  const pick = (d: string) => { setDate(d); if (d.slice(0, 7) !== month) setMonth(d.slice(0, 7)); };
  const goMonth = (dir: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + dir, 1); const m = d.toISOString().slice(0, 7); setMonth(m); setDate(m === today.slice(0, 7) ? today : `${m}-01`); };
  const goToday = () => { setMonth(today.slice(0, 7)); setDate(today); };
  const hours = Array.from({ length: 19 }, (_, i) => i + 5);

  return (
    <div><PageHeader title="Calendar" subtitle="See what is free, booked or blocked." actions={<Link to="/owner/slots" className="btn-primary">Block or schedule maintenance</Link>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select label="Venue" value={venueId} onChange={(e) => { setVenueId(e.target.value); setAreaId(''); }}><option value="">All venues</option>{venues.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        <Select label="Playing area" value={areaId} onChange={(e) => setAreaId(e.target.value)}><option value="">All areas</option>{(areasQ.data?.areas ?? []).filter((a) => !venueId || a.venue_id === venueId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Button variant="ghost" className="!px-3 !py-1.5" onClick={() => pick(addDays(date, -1))}>Previous day</Button><Button variant="ghost" className="!px-3 !py-1.5" onClick={() => pick(addDays(date, 1))}>Next day</Button></div><h2 className="text-2xl font-bold">{title}</h2>
        <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend"><li className="flex items-center gap-1"><i className="h-3 w-3 rounded border border-line" />Available</li>{(Object.keys(KIND) as Kind[]).map((k) => <li key={k} className="flex items-center gap-1"><i className={cx('h-3 w-3 rounded', KIND[k].cls)} />{KIND[k].label}</li>)}</ul></div>

      {areasQ.isLoading || q.isLoading ? <Loading /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : areas.length === 0 ? <Empty icon="🗓️" title="No playing areas" hint="Add a venue and playing area to see its calendar." action={<Link to="/owner/venues" className="btn-primary">Go to venues</Link>} /> : (<>
        {(
          <div className="card overflow-x-auto p-3"><div className="min-w-[760px]">
            <div className="grid items-end" style={{ gridTemplateColumns: `110px repeat(${hours.length}, 1fr)` }}><span />{hours.map((h) => <span key={h} className="pb-1 text-center text-[10px] text-muted">{h % 12 || 12}{h < 12 ? 'a' : 'p'}</span>)}</div>
            {areas.map((a) => (
              <div key={a.id} className="grid items-stretch gap-px border-t border-line py-1" style={{ gridTemplateColumns: `110px repeat(${hours.length}, 1fr)` }}>
                <div className="pr-2 text-xs"><b>{a.name}</b><div className="text-muted">{a.venue_name}</div></div>
                {hours.map((h) => {
                  const cs = new Date(`${date}T${String(h).padStart(2, '0')}:00:00+05:30`).getTime(), ce = cs + 3600000;
                  const it = items.find((x) => x.area_id === a.id && new Date(x.starts_at).getTime() < ce && new Date(x.ends_at).getTime() > cs);
                  return it ? <button key={h} onClick={() => setSel(it)} title={`${it.customer_name ?? KIND[kindOf(it)].label}: ${fmtRange(it.starts_at, it.ends_at, TZ)}`} aria-label={`${a.name} ${h}:00 ${KIND[kindOf(it)].label}${it.customer_name ? `, ${it.customer_name}` : ''}`} className={cx('h-14 overflow-hidden rounded px-0.5 text-[11px] font-bold leading-tight [overflow-wrap:anywhere]', KIND[kindOf(it)].cls)}>{it.customer_name ? it.customer_name.split(' ')[0].slice(0, 9) : ''}</button>
                    : (() => { const on = !!multi && multi.areaId === a.id && h >= multi.from && h <= multi.to;
                      return <button key={h} type="button" aria-pressed={on} aria-label={`${a.name} ${h}:00 available${on ? ', selected' : ''}`} title={on ? 'Selected' : 'Select this slot'}
                        onClick={() => setMulti((r) => {
                          if (!r || r.areaId !== a.id || (h >= r.from && h <= r.to)) return on && r && r.from === r.to ? null : { areaId: a.id, from: h, to: h };
                          const lo = Math.min(h, r.from), hi = Math.max(h, r.to);
                          const clash = items.some((x) => x.area_id === a.id && new Date(x.starts_at).getTime() < new Date(`${date}T${String(hi).padStart(2, '0')}:00:00+05:30`).getTime() + 3600000 && new Date(x.ends_at).getTime() > new Date(`${date}T${String(lo).padStart(2, '0')}:00:00+05:30`).getTime());
                          return clash ? { areaId: a.id, from: h, to: h } : { areaId: a.id, from: lo, to: hi };
                        })}
                        className={cx('h-14 rounded border', on ? 'border-brand bg-brand/30' : 'border-line/60 hover:border-brand')} />; })();
                })}
              </div>))}
          </div></div>)}
        {multi && (() => { const n = multi.to - multi.from + 1; const area = areas.find((x) => x.id === multi.areaId); const t = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
          return <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-brand/10 p-3" role="status">
            <p className="text-sm"><b>{n} slot{n === 1 ? '' : 's'} selected</b> · {area?.name} · {t(multi.from)} to {t(multi.to + 1)}<span className="block text-xs text-muted">Tap more free slots next to it to select several at once.</span></p>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setMulti(null)}>Clear</Button><Link to={`/owner/slots?area=${multi.areaId}&date=${date}&hour=${multi.from}&to=${multi.to + 1}`} className="btn-primary">Block selected</Link></div></div>; })()}
        {(() => {
          const ids = new Set(areas.map((a) => a.id)); const day = items.filter((x) => ids.has(x.area_id) && localDate(x.starts_at) === date).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
          return (
            <section className="mt-4" aria-label={isToday ? 'Bookings today' : 'Bookings on this day'}><h3 className="mb-2 text-xl font-bold">{isToday ? "Today's bookings" : `Bookings on ${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`}</h3>
              {day.length === 0 ? <p className="text-sm text-muted">{isToday ? 'Nothing booked or blocked today.' : 'Nothing booked or blocked on this day.'}</p> : (
                <ul className="grid gap-2 md:grid-cols-2">{day.map((x) => (
                  <li key={x.id}><button onClick={() => setSel(x)} className="card flex w-full items-center gap-3 p-3 text-left transition hover:border-brand/60">
                    <i className={cx('h-10 w-1.5 shrink-0 rounded-full', KIND[kindOf(x)].cls)} aria-hidden="true" />
                    <span className="min-w-0 flex-1"><b className="block truncate text-base">{x.customer_name ?? (x.notes || KIND[kindOf(x)].label)}</b>
                      <span className="block text-xs text-muted">{fmtTime(x.starts_at, TZ)} to {fmtTime(x.ends_at, TZ)} · {x.area_name}{x.sport ? ` · ${x.sport}` : ''}</span></span>
                    <Badge status={x.status} /></button></li>))}</ul>)}
            </section>);
        })()}

      </>)}

        </div>
        <aside className="order-first lg:order-none lg:sticky lg:top-24 lg:self-start" aria-label="Pick a date">
          <section aria-label="Calendar" className="card p-3">
            <div className="mb-2 flex items-center justify-between gap-1">
              <Button variant="ghost" className="!px-2.5 !py-1" aria-label="Previous month" onClick={() => goMonth(-1)}>←</Button>
              <h2 className="text-lg font-bold">{monthTitle}</h2>
              <Button variant="ghost" className="!px-2.5 !py-1" aria-label="Next month" onClick={() => goMonth(1)}>→</Button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-muted" aria-hidden="true">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="mt-1 grid grid-cols-7 gap-0.5">{gridDays.map((d) => {
              const list = byDay.get(d) ?? []; const blocks = list.filter((x) => x.status === 'blocked').length; const count = list.length - blocks; const on = d === date;
              const label = `${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}: ${count ? `${count} booking${count === 1 ? '' : 's'}` : 'no bookings'}${blocks ? `, ${blocks} blocked` : ''}${d === today ? ' (today)' : ''}`;
              return (
                <button key={d} type="button" aria-label={label} aria-pressed={on} onClick={() => pick(d)}
                  className={cx('relative grid h-9 place-items-center rounded-lg text-sm transition', on ? 'bg-brand font-bold text-brand-ink' : 'hover:bg-surface2', d.slice(0, 7) !== month && 'opacity-35', d === today && !on && 'ring-1 ring-brand')}>
                  {+d.slice(8)}
                  {(count > 0 || blocks > 0) && <span className="absolute bottom-0.5 flex gap-0.5" aria-hidden="true">{count > 0 && <i className={cx('h-1.5 w-1.5 rounded-full', on ? 'bg-brand-ink' : 'bg-brand')} />}{blocks > 0 && <i className="h-1.5 w-1.5 rounded-full bg-danger" />}</span>}
                </button>); })}</div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
              <span className="flex items-center gap-3"><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-brand" />booked</span><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-danger" />blocked</span></span>
              <button type="button" onClick={goToday} className="font-semibold text-[rgb(var(--brand-text))] hover:underline">Today</button></div>
          </section>
          <p className="mt-2 text-xs text-muted">Pick a date to see its slots and bookings.</p>
        </aside>
      </div>

      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? KIND[kindOf(sel)].label : ''}>{sel && (<div className="space-y-2 text-sm">
        <p><b>{sel.area_name}</b> · {sel.venue_name}</p><p>{fmtRange(sel.starts_at, sel.ends_at, TZ)}</p>
        {sel.status === 'blocked' ? <p className="text-muted">{sel.notes || 'No reason given'}</p> : <><p>Customer: <b>{sel.customer_name}</b> · {sel.sport}</p><p>Reference: {sel.reference} · {money(sel.total)} · <Badge status={sel.status} /></p><Link className="btn-ghost" to={`/owner/bookings?q=${sel.reference}`}>Open in bookings</Link></>}
        {sel.status === 'blocked' && <Link className="btn-ghost" to="/owner/blocked">Manage blocked slots</Link>}</div>)}</Modal></div>
  );
}

/* ----------------------------------------------------------- Slot management */
export function SlotsPage() {
  const [sp] = useSearchParams();
  const { toast } = useToast(); const qc = useQueryClient();
  const areasQ = useQuery({ queryKey: ['owner-areas'], queryFn: () => get<{ areas: any[] }>('/owner/areas') });
  const hr = sp.get('hour');
  const [f, setF] = useState({ date: sp.get('date') ?? todayISO(), start: hr ? `${hr.padStart(2, '0')}:00` : '06:00', end: hr ? `${String(Math.min(24, +(sp.get('to') ?? +hr + 1))).padStart(2, '0')}:00` : '07:00', kind: 'blocked', reason: '', note: '', repeat: '0', endDate: '', days: [] as number[], event: false, eventKind: 'event', cname: '', cphone: '', amount: '', paid: '', method: 'cash', cancel: false });
  const [areaIds, setAreaIds] = useState<string[]>(sp.get('area') ? [sp.get('area')!] : []);
  const [result, setResult] = useState<{ created: number; conflicts: { area: string; startsAt: string }[] } | null>(null);
  useEffect(() => { if (areaIds.length === 0 && areasQ.data?.areas.length === 1) setAreaIds([areasQ.data.areas[0].id]); }, [areasQ.data, areaIds.length]);
  // JusGo picks the slots to block on a grid: the slots of the chosen playing area on the chosen date, a click selects or clears one
  const gridArea = areaIds.length === 1 && !f.endDate ? areasQ.data?.areas.find((a) => a.id === areaIds[0]) : undefined;
  const [picked, setPicked] = useState<string[]>([]);
  const gridQ = useQuery({ queryKey: ['block-grid', gridArea?.id, f.date], enabled: !!gridArea && !!(gridArea.sport_ids ?? [])[0], queryFn: () => get<{ slots: any[] }>(`/areas/${gridArea!.id}/slots`, { date: f.date, sportId: gridArea!.sport_ids[0], duration: gridArea!.slot_minutes }) });
  const gridSlots = (gridQ.data?.slots ?? []).filter((x) => x.reason !== 'past');
  useEffect(() => { setPicked([]); }, [gridArea?.id, f.date]);
  const ranges = useMemo(() => { // the chosen slots joined into runs of neighbouring slots
    const chosen = gridSlots.filter((x) => picked.includes(x.startsAt)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)); const out: { startsAt: string; endsAt: string }[] = [];
    for (const x of chosen) { const last = out[out.length - 1]; if (last && last.endsAt === x.startsAt) last.endsAt = x.endsAt; else out.push({ startsAt: x.startsAt, endsAt: x.endsAt }); }
    return out;
  }, [picked, gridSlots]);
  const isEvent = f.reason === 'Private event' || f.reason === 'Academic event'; // an event or academy is paid for: who, how much, how it was paid
  const save = useMutation({
    mutationFn: async () => { const body = (starts: string, ends: string) => ({ areaIds, startsAt: starts, endsAt: ends, kind: f.reason === 'Temporary closure' ? 'maintenance' : 'blocked', reason: [f.reason, f.note.trim()].filter(Boolean).join(': ').slice(0, 200) || undefined, repeatWeeks: f.endDate ? 0 : +f.repeat,
      ...(f.endDate ? { endDate: f.endDate, weekdays: f.days } : {}), ...(f.cancel ? { cancelBookings: true } : {}),
      ...(isEvent ? { customerName: f.cname.trim(), customerPhone: f.cphone.replace(/[\s-]/g, ''), amount: Number(f.amount || 0), paymentMethod: f.method, eventKind: f.reason === 'Academic event' ? 'academic' : 'event', ...(f.method !== 'unpaid' && f.paid !== '' ? { amountPaid: Number(f.paid) } : {}) } : {}) });
      if (!ranges.length) return post('/owner/blocks/bulk', body(`${f.date}T${f.start}:00+05:30`, `${f.date}T${f.end}:00+05:30`));
      let created = 0, cancelled = 0; const conflicts: any[] = [];
      for (const r of ranges) { try { const x: any = await post('/owner/blocks/bulk', body(r.startsAt, r.endsAt)); created += x.created ?? 0; cancelled += x.cancelled ?? 0; conflicts.push(...(x.conflicts ?? [])); } catch (e: any) { if (e?.response?.data?.conflicts) conflicts.push(...e.response.data.conflicts); else throw e; } }
      return { created, cancelled, conflicts };
    },
    onSuccess: (r: any) => { setResult(r); qc.invalidateQueries({ queryKey: ['owner-pending-payments'] }); qc.invalidateQueries({ queryKey: ['owner-blocks'] }); qc.invalidateQueries({ queryKey: ['owner-calendar'] }); toast(`${r.created} slot block(s) created`); },
    onError: (e: any) => { if (e?.response?.data?.conflicts) { setResult(e.response.data); toast('Those times overlap existing bookings or blocks', 'error'); } else toast(apiError(e), 'error'); },
  });
  const grouped = useMemo(() => { const m = new Map<string, any[]>(); areasQ.data?.areas.forEach((a) => m.set(a.venue_name, [...(m.get(a.venue_name) ?? []), a])); return [...m]; }, [areasQ.data]);
  return (
    <div className="max-w-3xl"><PageHeader title="Slot management" subtitle="Block time for private events or schedule maintenance. Customers cannot book blocked time." />
      {areasQ.isLoading ? <Loading /> : areasQ.isError ? <ErrorBox error={areasQ.error} /> : grouped.length === 0 ? <Empty title="No playing areas" hint="Add a playing area first." action={<Link to="/owner/venues" className="btn-primary">Go to venues</Link>} /> : (
        <Card className="p-5"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setResult(null); if (!ranges.length && f.end <= f.start) return toast('End time must be after start time', 'error'); if (!f.reason) return toast('Please select a reason.', 'error'); if (isEvent && (f.cname.trim().length < 2 || !isIndianMobile(f.cphone.replace(/[\s-]/g, '')))) return toast('Enter the customer name and a valid mobile number', 'error'); if (f.endDate && f.endDate < f.date) return toast('The end date cannot be before the start date', 'error'); if (!areaIds.length) return toast('Choose at least one area', 'error'); save.mutate(); }}>
          <fieldset><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Playing areas</legend>
            {grouped.map(([venue, list]) => <div key={venue} className="mb-2"><p className="text-sm font-semibold">{venue}</p><div className="flex flex-wrap gap-2">{list.map((a) => { const on = areaIds.includes(a.id); return <button type="button" key={a.id} aria-pressed={on} onClick={() => setAreaIds(on ? areaIds.filter((i) => i !== a.id) : [...areaIds, a.id])} className={cx('chip !px-3 !py-1.5 text-sm', on && '!border-brand bg-brand/15 text-ink')}>{on ? '✓ ' : ''}{a.name}</button>; })}</div></div>)}</fieldset>
          <div className="grid gap-3 sm:grid-cols-3"><Input label="Date" type="date" min={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /><TimeInput label="From" value={f.start} onChange={(v) => setF({ ...f, start: v })} /><TimeInput label="To" value={f.end} onChange={(v) => setF({ ...f, end: v })} /></div>
          {gridArea && (
            <section aria-label="Slots to block" className="space-y-2 rounded-xl border border-line p-3"><h3 className="text-sm font-bold">Slots to block on {fmtDate(`${f.date}T00:00:00+05:30`)}</h3>
              {gridQ.isLoading ? <p className="text-sm text-muted">Loading time slots…</p> : gridSlots.length === 0 ? <p className="text-sm text-muted">No time slots on this day.</p> : (
                <><ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="Time slots">{gridSlots.map((x) => { const on = picked.includes(x.startsAt); const taken = !x.available && x.reason !== 'unpriced'; const label = `${fmtTime(x.startsAt)} – ${fmtTime(x.endsAt)}`;
                  return <li key={x.startsAt}><button type="button" aria-pressed={on} aria-label={`${label}, ${taken ? (x.reason === 'blocked' ? 'blocked' : 'booked') : on ? 'selected' : 'free'}`} disabled={x.reason === 'blocked'} onClick={() => setPicked(on ? picked.filter((p) => p !== x.startsAt) : [...picked, x.startsAt])}
                    className={`w-full rounded-xl border px-2 py-2 text-xs transition ${on ? 'border-brand bg-brand/15 font-semibold' : taken ? 'border-warn/50 bg-warn/10' : 'border-line hover:border-brand/50'} ${x.reason === 'blocked' ? 'opacity-50' : ''}`}>{label}{taken && <span className="block text-[10px] text-warn">{x.reason === 'blocked' ? 'Blocked' : 'Booked'}</span>}</button></li>; })}</ul>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>{picked.length ? `${picked.length} slot${picked.length === 1 ? '' : 's'} chosen` : 'Choose the slots, or use the From and To times above.'}</span>{picked.length > 0 && <button type="button" className="underline" onClick={() => setPicked([])}>Clear</button>}</div>
                  {gridSlots.some((x) => picked.includes(x.startsAt) && !x.available) && <p role="status" className="text-xs text-warn">A chosen slot is booked. Tick "Cancel bookings that are already in this time" to cancel it, or it is skipped.</p>}</>)}
            </section>)}
          <div className="grid gap-3 sm:grid-cols-2"><Select mandatory label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}><option value="" disabled>Select a reason</option>{['Private event', 'Academic event', 'Temporary closure'].map((r) => <option key={r} value={r}>{r}</option>)}</Select>
            <Select label="Repeat weekly" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })}><option value="0">Does not repeat</option>{[1, 2, 3, 4, 8, 12, 26].map((n) => <option key={n} value={n}>For {n} more week{n > 1 ? 's' : ''}</option>)}</Select></div>
          <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">Several days (optional)</legend>
            <div className="grid gap-3 sm:grid-cols-2"><Input label="End date" type="date" min={f.date} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} hint="Leave empty for just the start date" /></div>
            {f.endDate && <div className="mt-2"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Days</p><div className="flex flex-wrap items-center gap-2" role="group" aria-label="Days of the week">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => { const on = f.days.includes(i); return <button type="button" key={d} aria-pressed={on} onClick={() => setF({ ...f, days: on ? f.days.filter((x) => x !== i) : [...f.days, i] })} className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-brand bg-brand/10 font-semibold' : 'border-line'}`}>{d}</button>; })}
              <button type="button" className="text-xs underline" onClick={() => setF({ ...f, days: [0, 1, 2, 3, 4, 5, 6] })}>Select all</button><button type="button" className="text-xs underline" onClick={() => setF({ ...f, days: [] })}>Clear</button></div>
              <p className="mt-1 text-xs text-muted">{f.days.length ? 'Only the chosen days are blocked.' : 'No day chosen: every day between the dates is blocked.'}</p></div>}</fieldset>
          {isEvent && (<fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">Customer and payment (for an event)</legend>
            {isEvent && <div className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2">
              <Input mandatory label="Customer name" value={f.cname} onChange={(e) => setF({ ...f, cname: e.target.value })} /><Input mandatory label="Customer mobile" type="tel" value={f.cphone} onChange={(e) => setF({ ...f, cphone: e.target.value })} placeholder="9876543210" /></div>
              <div className="grid gap-3 sm:grid-cols-3"><Input mandatory label="Amount for the event ₹" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                <Select label="Mode of payment" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="unpaid">Not paid yet</option></Select>
                {f.method !== 'unpaid' && <Input label="Collected now ₹ (optional)" type="number" min={0} value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} hint="Blank = the full amount" />}</div></div>}</fieldset>)}
          <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm"><input type="checkbox" className="mt-1" checked={f.cancel} onChange={(e) => setF({ ...f, cancel: e.target.checked })} /><span><b>Cancel bookings that are already in this time</b><span className="block text-xs text-muted">Customers are refunded in full and told. Leave this off to skip booked slots instead.</span></span></label>
          <Textarea label="Note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} rows={2} placeholder="Add details for your records" />
          <p className="-mt-2 text-xs text-muted">Up to 200 characters.</p>
          <p className="text-xs text-muted">Times are IST. Existing bookings are never overwritten. Overlapping times are skipped and reported.</p>
          <Button type="submit" loading={save.isPending}>Apply to {areaIds.length || 'selected'} area{areaIds.length === 1 ? '' : 's'}</Button></form>
          {result && (<div className="mt-4 rounded-xl border border-line p-4 text-sm" role="status"><p><b>{result.created}</b> block(s) created.{(result as any).cancelled > 0 && <> {(result as any).cancelled} booking(s) cancelled and refunded.</>}</p>
            {result.conflicts.length > 0 && <div className="mt-2"><p className="text-warn">Skipped {result.conflicts.length} overlapping with existing bookings or blocks:</p><ul className="list-disc pl-5 text-muted">{result.conflicts.map((c, i) => <li key={i}>{c.area} · {new Date(c.startsAt).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })}</li>)}</ul></div>}
            <Link className="mt-3 inline-block underline" to="/owner/blocked">View blocked slots</Link></div>)}</Card>)}
    </div>
  );
}

/* ------------------------------------------------------------ Blocked slots */
export function BlockedPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-blocks'], queryFn: () => get<{ blocks: any[] }>('/owner/blocks') });
  const rm = useMutation({ mutationFn: (id: string) => del(`/owner/blocks/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner-blocks'] }); qc.invalidateQueries({ queryKey: ['owner-calendar'] }); toast('Slot reopened'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Blocked slots" subtitle="Upcoming blocks and maintenance. Unblock to make the time bookable again." actions={<Link to="/owner/slots" className="btn-primary">+ Block slots</Link>} />
      <QueryBoundary q={q} empty={(d) => d.blocks.length === 0 && <Empty icon="⛔" title="Nothing blocked" hint="All your open hours are available to customers." />}>
        {(d) => <Table rows={d.blocks} columns={[{ key: 'area_name', header: 'Area', render: (b) => <div><b>{b.area_name}</b><div className="text-xs text-muted">{b.venue_name}</div></div> }, { key: 'when', header: 'When', render: (b) => fmtRange(b.starts_at, b.ends_at, b.timezone) },
          { key: 'kind', header: 'Type', render: (b) => <Badge status={b.kind === 'maintenance' ? 'pending' : 'cancelled'}>{titleCase(b.kind ?? 'blocked')}</Badge> }, { key: 'reason', header: 'Reason', render: (b) => b.reason ?? '—' },
          { key: 'a', header: '', render: (b) => <Button variant="danger" className="!py-1" loading={rm.isPending && rm.variables === b.id} onClick={() => window.confirm('Reopen this time for bookings?') && rm.mutate(b.id)}>Unblock</Button> }]} />}
      </QueryBoundary></div>
  );
}
