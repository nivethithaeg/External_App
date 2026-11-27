import { useAuth } from '../../lib/auth';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, post, put } from '../../lib/api';
import { BarChart } from '../../components/BarChart';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Input, Loading, Modal, PageHeader, QueryBoundary, Select, Stat, Table, Tabs, TimeInput } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { AreasTab, DocumentsTab } from './VenueEditor';
import { ScheduleModal } from './AreaSchedule';
import { AreaHoursModal } from './AreaHours';
import { buildPrices, fmtSlot, slotStarts, toMin, type Day } from '../../lib/schedule';
import { FileLink } from '../../components/FileLink';
import { DAYS, cx, fmtDate, fmtDateTime, fmtRange, fmtTime, money, titleCase, todayISO } from '../../lib/utils';

const VENUE_STATUS: Record<string, string> = { draft: 'Not published', pending: 'Under approval', ready: 'Approved · not published', approved: 'Published', rejected: 'Needs changes', suspended: 'Suspended' };

/* ------------------------------------------------------------- Overview */
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export function OverviewPage() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['owner-overview'], queryFn: () => get<any>('/owner/overview'), refetchInterval: 60000 });
  const dash = useQuery({ queryKey: ['owner-dashboard'], queryFn: () => get<any>('/owner/dashboard') });
  const checklist = useQuery({ queryKey: ['owner-checklist'], queryFn: () => get<{ venue: { name: string } | null; items: { id: string; label: string; done: boolean; link: string }[]; done: number; total: number; complete: boolean }>('/owner/checklist') });
  const [range, setRange] = useState<'day' | 'week' | 'month' | 'year'>('day');
  return (
    <div><PageHeader title={<>{greeting()}, {user?.fullName ?? ''} <span className="wave-hand" role="img" aria-label="waving hand">👋</span></>} subtitle={`What is happening with your venues right now.${dash.data?.ownerCode ? ` Owner ID ${dash.data.ownerCode}` : ''}`} />
      <QueryBoundary q={q}>{(d) => {
        const series = d.revenue[range] as { period: string; revenue: number; bookings: number }[];
        const total = d.statusBreakdown.reduce((s: number, x: any) => s + x.n, 0);
        return (
          <div className="space-y-6">
            {(d.closedAreas?.length ?? 0) > 0 && (
              <div role="status" className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
                {d.closedAreas.length === 1 ? <>You have closed <Link className="font-semibold underline" to={`/owner/venues/${d.closedAreas[0].venueId}`}>{d.closedAreas[0].name}</Link>. It cannot accept bookings until you open it again.</>
                  : <>You have closed {d.closedAreas.length} playing areas ({d.closedAreas.map((a: any, i: number) => <span key={a.id}>{i > 0 && ', '}<Link className="font-semibold underline" to={`/owner/venues/${a.venueId}`}>{a.name}</Link></span>)}). They cannot accept bookings until you open them again.</>}</div>)}
            {(d.unpricedAreas?.length ?? 0) > 0 && (
              <div role="status" className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
                {d.unpricedAreas.map((u: any) => <p key={u.id}><Link className="font-semibold underline" to={`/owner/pricing?area=${u.id}`}>{u.name}</Link> has slots with no price {u.today && u.tomorrow ? 'today and tomorrow' : u.today ? 'today' : 'tomorrow'} ({u.today + u.tomorrow} slot{u.today + u.tomorrow === 1 ? '' : 's'}). Customers cannot book them until you set a price.</p>)}</div>)}
            {dash.data && dash.data.verification !== 'verified' && <p role="status" className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm"><b>Account {dash.data.verification}.</b> Our team verifies owners before venues go live. <Link className="underline" to="/owner/account/business">Review business details</Link></p>}
            {checklist.data?.items && !checklist.data.complete && (
              <section aria-label="Go-live checklist" className="card p-5">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-2xl font-bold">Get {checklist.data.venue ? `${checklist.data.venue.name} ` : 'your venue '}live</h2><p className="text-sm text-muted">{checklist.data.done} of {checklist.data.total} steps done. Customers can book once the venue is approved.</p></div>
                  <span className="font-display text-3xl font-bold text-[rgb(var(--brand-text))]">{Math.round((checklist.data.done / checklist.data.total) * 100)}%</span></div>
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.data.total} aria-valuenow={checklist.data.done} aria-label="Checklist progress"><div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${(checklist.data.done / checklist.data.total) * 100}%` }} /></div>
                <ol className="grid gap-2 sm:grid-cols-2">{checklist.data.items.map((i) => (
                  <li key={i.id}>{i.done
                    ? <span className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted line-through"><span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-ok/20 text-xs text-ok no-underline">✓</span><span className="sr-only">Done: </span>{i.label}</span>
                    : <Link to={i.link} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold transition hover:border-brand hover:bg-surface2"><span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-line" /><span className="sr-only">To do: </span>{i.label}<span aria-hidden="true" className="ml-auto text-brand">→</span></Link>}</li>))}</ol>
              </section>)}
            <div className="flex flex-wrap justify-end gap-2" aria-label="Quick actions">
              <Link to="/owner/bookings/new" className="btn-primary">Add Booking</Link><Link to="/owner/reports?tab=payments&status=pending" className="btn-ghost">Record Payment</Link></div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Stat index={0} to="/owner/venues" label="Total Venues" count={d.counts.venues} /><Stat index={1} to="/owner/areas" label="Total Playing Areas" count={d.counts.areas} />
              <Stat index={2} to="/owner/bookings?preset=today" label="Today's Bookings" count={d.today.bookings} /><Stat index={3} to="/owner/bookings/upcoming" label="Upcoming Bookings" count={d.upcoming} />
              <Stat index={4} to="/owner/bookings?status=completed" label="Completed Bookings" count={d.statusBreakdown.find((x: any) => x.status === 'completed')?.n ?? 0} /><Stat index={5} to="/owner/bookings/cancelled" label="Cancelled Bookings" count={d.statusBreakdown.find((x: any) => x.status === 'cancelled')?.n ?? 0} />
              <Stat index={6} to="/owner/reports" label="Total Revenue (GTV)" count={Number(d.counts.gtv ?? 0)} format={(n) => money(Math.round(n))} valueLabel={money(d.counts.gtv ?? 0)} accent />
              {d.slotsToday
                ? <Stat index={7} to="/owner/slots" label="Open Slots Today" live={d.slotsToday.open > 0} count={d.slotsToday.open} suffix={<span className="text-2xl text-muted"> / {d.slotsToday.total}</span>} valueLabel={`${d.slotsToday.open} open of ${d.slotsToday.total} slots today`} hint="Free to book now or later / all of today's slots, every playing area" />
                : <Stat index={7} to="/owner/slots" label="Open Slots Today" live={d.slots.available > 0} count={d.slots.available} hint="Free to book now or later / all of today's slots, every playing area" />}
            </div>

            <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Booking trend, last 30 days</h2>
              {(d.trend ?? []).every((x: any) => !x.bookings) ? <p className="py-6 text-center text-sm text-muted">No bookings in the last 30 days yet.</p> : <BarChart title="Bookings per day, last 30 days" data={d.trend} valueKey="bookings" labelKey="period" height={180} currency={false} />}</Card>
            <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
              <Card className="space-y-3 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-2xl font-bold">Revenue overview</h2>
                <div className="w-72"><Tabs tabs={[{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }, { id: 'year', label: 'Yearly' }]} value={range} onChange={setRange} /></div></div>
                {series.length === 0 ? <p className="py-10 text-center text-sm text-muted">No revenue recorded for this period yet. Only confirmed and completed paid bookings count.</p> : <BarChart title={`Your earnings, by ${range}`} data={series} valueKey="revenue" labelKey="period" height={200} />}</Card>
              <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Booking status</h2>
                {total === 0 ? <p className="text-sm text-muted">No bookings yet.</p> : <ul className="space-y-3">{d.statusBreakdown.map((s: any) => (
                  <li key={s.status}><div className="flex justify-between text-sm"><span>{titleCase(s.status)}</span><b>{s.n}</b></div><div className="mt-1 h-2 rounded-full bg-surface2"><div className={`h-2 rounded-full ${['cancelled', 'expired'].includes(s.status) ? 'bg-danger' : s.status === 'pending' ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${(s.n / total) * 100}%` }} /></div></li>))}</ul>}</Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Today's schedule</h2>
                {d.schedule.length === 0 ? <p className="text-sm text-muted">No bookings today.</p> : <ul className="divide-y divide-line text-sm">{d.schedule.map((b: any) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><b>{fmtTime(b.starts_at, b.timezone)} – {fmtTime(b.ends_at, b.timezone)}</b> · {b.customer_name}<div className="text-xs text-muted">{b.venue_name} · {b.area_name} · {b.sport}</div></div><Badge status={b.status} /></li>))}</ul>}</Card>
              <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Upcoming bookings</h2>
                {d.nextBookings.length === 0 ? <p className="text-sm text-muted">Nothing scheduled.</p> : <ul className="divide-y divide-line text-sm">{d.nextBookings.map((b: any) => (
                  <li key={b.id} className="py-2"><b>{fmtRange(b.starts_at, b.ends_at, b.timezone)}</b><div className="text-xs text-muted">{b.customer_name} · {b.venue_name} · {b.area_name} · {b.sport}</div></li>))}</ul>}</Card>
              <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Popular playing areas</h2>
                {d.popularAreas.length === 0 ? <p className="text-sm text-muted">Appears once you have bookings.</p> : <ul className="divide-y divide-line text-sm">{d.popularAreas.map((a: any) => <li key={a.id} className="flex justify-between py-2"><span>{a.name} <span className="text-muted">· {a.venue_name}</span></span><span><b>{a.bookings}</b> bookings · {money(a.revenue)}</span></li>)}</ul>}</Card>
              <Card className="p-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-2xl font-bold">Recent transactions</h2><Link className="text-sm underline" to="/owner/payments">View all</Link></div>
                {d.recentTransactions.length === 0 ? <p className="text-sm text-muted">No payments yet.</p> : <ul className="divide-y divide-line text-sm">{d.recentTransactions.map((t: any) => <li key={t.id} className="flex items-center justify-between gap-2 py-2"><span><b>{t.reference}</b><span className="block text-xs text-muted">{fmtDateTime(t.at)}</span></span><span className="flex items-center gap-2">{money(t.amount)} <Badge status={t.status} /></span></li>)}</ul>}</Card>
            </div>

            <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Venue approval status</h2>
              {d.venues.length === 0 ? <Empty title="No venues yet" hint="Add your first venue to get started." action={<Link to="/owner/venues/new" className="btn-primary">Add venue</Link>} /> : (
                <ul className="divide-y divide-line text-sm">{d.venues.map((v: any) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><Link className="font-semibold underline-offset-2 hover:underline" to={`/owner/venues/${v.id}`}>{v.name} <span className="font-normal text-muted">· {v.city}</span></Link>
                  <span className="flex items-center gap-2">{v.status === 'rejected' && v.rejection_reason && <span className="text-xs text-danger">{v.rejection_reason}</span>}<Badge status={v.status}>{VENUE_STATUS[v.status] ?? v.status}</Badge></span></li>)}</ul>)}</Card>
          </div>);
      }}</QueryBoundary></div>
  );
}

/* --------------------------------------------------------- Venue picker */
/** Loads the owner's venues, lets them pick one, and passes the full venue record down. */
function WithVenue({ children, label = 'Venue', editableWhenPending = false, alwaysPick = false }: { children(venue: any): ReactNode; label?: string; editableWhenPending?: boolean; alwaysPick?: boolean }) {
  const list = useQuery({ queryKey: ['owner-venues'], queryFn: () => get<{ venues: any[] }>('/owner/venues') });
  const [sp] = useSearchParams();
  const [sel, setSel] = useState(sp.get('venue') ?? ''); // ?venue=ID opens the page on that venue
  const id = list.data?.venues.some((v) => v.id === sel) ? sel : list.data?.venues[0]?.id;
  const det = useQuery({ queryKey: ['owner-venue', id], queryFn: () => get<{ venue: any }>(`/owner/venues/${id}`), enabled: !!id });
  if (list.isLoading) return <Loading />;
  if (list.isError) return <ErrorBox error={list.error} retry={() => list.refetch()} />;
  if (!list.data!.venues.length) return <Empty title="No venues yet" hint="Add a venue first." action={<Link to="/owner/venues/new" className="btn-primary">Add venue</Link>} />;
  return (
    <div className="space-y-5">
      {(alwaysPick || list.data!.venues.length > 1) && <div className="max-w-sm"><Select label={label} value={id} onChange={(e) => setSel(e.target.value)}>{list.data!.venues.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? ` · ${v.city}` : ''}{['ready', 'approved'].includes(v.status) ? '' : ` · ${({ pending: 'Waiting for approval', draft: 'Not sent for approval yet', rejected: 'Needs changes', suspended: 'Suspended' } as Record<string, string>)[v.status] ?? 'Waiting for approval'}`}</option>)}</Select></div>}
      {det.isLoading ? <Loading /> : det.isError ? <ErrorBox error={det.error} retry={() => det.refetch()} /> : det.data && (det.data.venue.status === 'pending' && !editableWhenPending
        ? <><p role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm"><b>Under approval.</b> This venue was sent to PlaynX, so its details can't be changed until it is reviewed.</p>
          <fieldset disabled aria-label="Locked while under approval" className="m-0 min-w-0 border-0 p-0 opacity-70">{children(det.data.venue)}</fieldset></>
        : children(det.data.venue))}
    </div>
  );
}

/* ---------------------------------------------------------- Playing areas */
export function AreasPage() {
  return (
    <div><PageHeader title="Playing areas" subtitle="Each ground or court is booked on its own. Add areas, choose their sports, and set pricing, opening hours and blocked time." />
      <WithVenue alwaysPick label="Create playing areas for venue">{(v) => <AreasTab venue={v} />}</WithVenue></div>
  );
}

/* ---------------------------------------------------------------- Media */
/* ------------------------------------------------------------ Documents */
const DOC_LABEL: Record<string, string> = { approved: 'Verified', pending: 'Pending', rejected: 'Rejected' };
/** The venue documents (list, verification status, upload or replace). Shown inside Business information. */
export function DocumentsSection() {
  const q = useQuery({ queryKey: ['owner-documents'], queryFn: () => get<{ documents: any[] }>('/owner/documents') });
  const qc = useQueryClient();
  return (
    <div>
      <div className="space-y-6">
        <QueryBoundary q={q} empty={(d) => d.documents.length === 0 && <Empty icon="📑" title="No documents uploaded" hint="Upload below. Venues cannot be submitted without one." />}>
          {(d) => <Table rows={d.documents} columns={[
            { key: 'doc_type', header: 'Document', render: (x) => <FileLink path={`/owner/venue-documents/${x.id}/file`} url={x.url}>{x.doc_type}</FileLink> }, { key: 'venue_name', header: 'Venue' },
            { key: 'created_at', header: 'Uploaded', render: (x) => fmtDateTime(x.created_at) },
            { key: 'status', header: 'Verification', render: (x) => <Badge status={x.status}>{x.status === 'rejected' ? 'Rejected · re-upload required' : DOC_LABEL[x.status]}</Badge> },
            { key: 'note', header: 'Admin comments', render: (x) => x.note ?? '—' }]} />}
        </QueryBoundary>
        <div onClickCapture={() => setTimeout(() => qc.invalidateQueries({ queryKey: ['owner-documents'] }), 1500)}><h2 className="mb-2 text-2xl font-bold">Upload or replace a document</h2><p className="mb-3 text-sm text-muted">If a document was rejected, upload a corrected version here and it will be reviewed again.</p>
          <WithVenue>{(v) => <DocumentsTab venue={v} />}</WithVenue></div>
      </div></div>
  );
}

/** Old stand-alone page, kept only for links that still point at it. */
export function DocumentsPage() {
  return <div><PageHeader title="Venue documents" subtitle="Ownership and licence documents reviewed by PlaynX" /><DocumentsSection /></div>;
}

/* ---------------------------------------------------------------- Hours */
/** One playing area's week at a glance: opening hours, and how many slots there are and what they cost, for each day. */
function AreaScheduleCard({ a, onEdit }: { a: any; onEdit(): void }) {
  const step: number = a.slot_minutes ?? 60;
  const days: Day[] = Array.from({ length: 7 }, (_, d) => { const x = (a.availability ?? []).find((r: any) => r.dayOfWeek === d); return { dayOfWeek: d, openTime: x?.openTime ?? '06:00', closeTime: x?.closeTime ?? '23:00', isClosed: x ? !!x.isClosed : true }; });
  const prices = buildPrices(a.pricing ?? [], days, ['all'], step);
  const none = !(a.availability ?? []).some((r: any) => !r.isClosed);
  return (
    <section aria-label={`Schedule of ${a.name}`}><Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-2xl font-bold">{a.name}</h3><p className="text-xs text-muted">{step}-minute slots{a.surface ? ` · ${a.surface}` : ''}{a.is_active === false ? ' · Inactive' : ''}</p></div>
        <Button variant="ghost" onClick={onEdit}>Edit opening hours</Button></div>
      {none ? <p className="text-sm text-warn">No hours set. Customers can't book this area.</p> : (
        <ul className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">{days.map((d) => {
          const slots = slotStarts(d, step); const row = prices.all?.[d.dayOfWeek] ?? {}; const vals = Object.values(row); const unpriced = slots.filter((m) => row[m] === undefined).length;
          return (
            <li key={d.dayOfWeek} className={`space-y-0.5 rounded-xl border p-3 text-sm ${d.isClosed ? 'border-line/50 text-muted' : 'border-line'}`}>
              <div className="font-semibold">{DAYS[d.dayOfWeek].slice(0, 3)}</div>
              {d.isClosed ? <div>Closed</div> : (<>
                <div>{fmtSlot(toMin(d.openTime))} to {fmtSlot(toMin(d.closeTime))}</div>
                <div className="text-xs text-muted">{slots.length} slot{slots.length === 1 ? '' : 's'}</div>
                {vals.length > 0 && <div className="text-xs font-semibold">{money(Math.min(...vals))}{Math.max(...vals) !== Math.min(...vals) ? `–${money(Math.max(...vals))}` : ''} / slot</div>}
                {unpriced > 0 && <div className="text-xs text-warn">{unpriced} unpriced</div>}</>)}
            </li>); })}</ul>)}
    </Card></section>
  );
}

/** The playing areas of the chosen venue, each with its schedule. With several areas, one can be picked to look at on its own. */
function HoursByArea({ venue, onEdit }: { venue: any; onEdit(a: any): void }) {
  const [areaId, setAreaId] = useState('');
  if (venue.areas.length === 0) return <Empty title="No playing areas" hint={`${venue.name} has no playing areas yet. Add one first.`} action={<Link className="btn-primary" to={`/owner/areas?venue=${venue.id}`}>Add area</Link>} />;
  const areas = venue.areas.filter((a: any) => !areaId || a.id === areaId);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted"><b className="text-ink">{venue.name}</b> · {[venue.locality, venue.city].filter(Boolean).join(', ')} · {venue.areas.length} playing area{venue.areas.length === 1 ? '' : 's'}</p>
      {venue.areas.length > 1 && <div className="max-w-sm"><Select label="Playing area" value={areaId} onChange={(e) => setAreaId(e.target.value)}><option value="">All playing areas</option>{venue.areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>}
      {areas.map((a: any) => <AreaScheduleCard key={a.id} a={a} onEdit={() => onEdit(a)} />)}
    </div>
  );
}

export function HoursPage() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<any>(null);
  const sportsQ = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string }[] }>('/sports'), staleTime: Infinity });
  return (
    <div><PageHeader title="Operating hours" subtitle="Choose a venue to see its playing areas and their weekly schedule: opening hours, slots and prices. Slots outside these hours cannot be booked." />
      <WithVenue editableWhenPending alwaysPick>{(v) => <HoursByArea key={v.id} venue={v} onEdit={setEdit} />}</WithVenue>
      {edit && <AreaHoursModal area={edit} onClose={() => setEdit(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['owner-venue', edit.venue_id] }); qc.invalidateQueries({ queryKey: ['owner-venues'] }); }} />}
    </div>
  );
}

/* -------------------------------------------------------------- Special-date pricing */
/** A price change for a period (Diwali +20%, an off-season -10%). It applies to every area of the venue on those dates. */
function SpecialDatesCard({ venueId }: { venueId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-price-adjustments', venueId], queryFn: () => get<{ adjustments: { id: string; label: string; start_date: string; end_date: string; percent: number }[] }>(`/owner/venues/${venueId}/price-adjustments`) });
  const [f, setF] = useState({ label: '', start: '', end: '', percent: '' }); const [err, setErr] = useState('');
  const add = useMutation({ mutationFn: () => post(`/owner/venues/${venueId}/price-adjustments`, { label: f.label.trim(), startDate: f.start, endDate: f.end || f.start, percent: Math.round(Number(f.percent)) }),
    onSuccess: () => { setF({ label: '', start: '', end: '', percent: '' }); setErr(''); qc.invalidateQueries({ queryKey: ['owner-price-adjustments', venueId] }); }, onError: (e) => setErr(apiError(e)) });
  const rm = useMutation({ mutationFn: (id: string) => del(`/owner/venues/${venueId}/price-adjustments/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-price-adjustments', venueId] }) });
  const go = () => { setErr(''); if (f.label.trim().length < 2) return setErr('Give it a name, e.g. Pongal holiday'); if (!f.start) return setErr('Pick the date'); if (f.end && f.end < f.start) return setErr('The end date cannot be before the start date'); const n = Number(f.percent); if (!Number.isFinite(n) || Math.round(n) === 0 || n < -50 || n > 200) return setErr('Enter a percentage between -50 and 200 (not 0)'); add.mutate(); };
  return (
    <Card className="space-y-3 p-5"><div><h3 className="text-2xl font-bold">Special dates</h3><p className="text-sm text-muted">A holiday, an event or a shorter day: on these dates every price at this venue is raised or lowered by the percentage you set.</p></div>
      <div className="grid gap-3 sm:grid-cols-5">
        <div className="sm:col-span-2"><Input label="Name" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Pongal holiday" maxLength={60} /></div>
        <Input label="Date" type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        <Input label="To (optional)" type="date" min={f.start} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        <Input label="Change %" type="number" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} placeholder="+20 or -10" /></div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div><Button loading={add.isPending} onClick={go}>Add date</Button></div>
      <QueryBoundary q={q} empty={(d) => d.adjustments.length === 0 && <p className="text-sm text-muted">No special dates.</p>}>
        {(d) => <ul className="divide-y divide-line text-sm">{d.adjustments.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{a.label}</b> <span className="text-muted">{a.start_date}{a.end_date !== a.start_date ? ` to ${a.end_date}` : ''}</span></span>
            <span className="flex items-center gap-3"><b className={a.percent > 0 ? 'text-warn' : 'text-ok'}>{a.percent > 0 ? '+' : ''}{a.percent}%</b><ConfirmButton variant="danger" className="!py-1" message={`Remove ${a.label}?`} onConfirm={() => rm.mutate(a.id)}>Remove</ConfirmButton></span></li>))}</ul>}
      </QueryBoundary></Card>
  );
}

/* -------------------------------------------------------------- Pricing */
/** Slot wise pricing for chosen dates: a price for a time window on one date; it is used instead of the weekly prices on that date. */
function DatePrices({ area }: { area: any }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const q = useQuery({ queryKey: ['owner-date-prices', area.id], queryFn: () => get<{ prices: { id: string; date: string; startTime: string; endTime: string; pricePerHour: number }[] }>(`/owner/areas/${area.id}/date-prices`) });
  const [f, setF] = useState({ date: '', start: '06:00', end: '23:00', price: '' }); const [err, setErr] = useState('');
  const add = useMutation({ mutationFn: () => put(`/owner/areas/${area.id}/date-prices`, { entries: [{ date: f.date, startTime: f.start, endTime: f.end, pricePerHour: Number(f.price) }] }),
    onSuccess: () => { setF({ ...f, date: '', price: '' }); setErr(''); qc.invalidateQueries({ queryKey: ['owner-date-prices', area.id] }); qc.invalidateQueries({ queryKey: ['price-preview', area.id] }); toast('Price saved for that date.'); }, onError: (e) => setErr(apiError(e)) });
  const rm = useMutation({ mutationFn: (id: string) => del(`/owner/areas/${area.id}/date-prices/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner-date-prices', area.id] }); qc.invalidateQueries({ queryKey: ['price-preview', area.id] }); } });
  const go = () => { setErr(''); if (!f.date) return setErr('Choose the date.'); if (f.end <= f.start) return setErr('The end time must be after the start time.'); if (!(Number(f.price) > 0)) return setErr('Enter the price per hour (more than 0).'); add.mutate(); };
  return (
    <section aria-label="Prices for chosen dates" className="space-y-3 rounded-xl border border-line p-4"><h4 className="text-base font-bold">Prices for chosen dates</h4>
      <p className="text-sm text-muted">A price for a time window on one date (a holiday, an event). On that date it is used instead of the weekly prices.</p>
      <div className="grid gap-3 sm:grid-cols-4"><Input label="Price date" type="date" min={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /><TimeInput label="From" value={f.start} onChange={(v) => setF({ ...f, start: v })} /><TimeInput label="To" value={f.end} onChange={(v) => setF({ ...f, end: v })} /><Input label="Price per hour (₹)" type="number" min={1} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="button" variant="ghost" loading={add.isPending} onClick={go}>Save date price</Button>
      {(q.data?.prices ?? []).length === 0 ? <p className="text-sm text-muted">No prices for chosen dates.</p> : (
        <ul className="divide-y divide-line text-sm" aria-label="Date prices">{q.data!.prices.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{fmtDate(p.date)}</b> · {p.startTime} – {p.endTime}</span><span className="flex items-center gap-3"><b>{money(p.pricePerHour)}/hr</b><button type="button" className="text-xs text-danger underline" aria-label={`Remove price for ${p.date} ${p.startTime}`} onClick={() => rm.mutate(p.id)}>Remove</button></span></li>)}</ul>)}
    </section>);
}

/** The slots of one day with the price each gets from the saved pricing: the same amounts a booking gets. */
function PricePreview({ area }: { area: any }) {
  const [date, setDate] = useState(todayISO()); const sid: number | undefined = (area.sport_ids ?? [])[0]; const dur: number = area.min_duration_minutes ?? 60;
  const q = useQuery({ queryKey: ['price-preview', area.id, date], enabled: !!sid, queryFn: () => get<{ slots: any[] }>(`/areas/${area.id}/slots`, { date, sportId: sid, duration: dur }) });
  const slots = (q.data?.slots ?? []).filter((x) => x.reason !== 'past');
  return (
    <section aria-label="Price preview" className="space-y-3 rounded-xl border border-line p-4"><div className="flex flex-wrap items-end justify-between gap-3"><h4 className="text-base font-bold">Price preview</h4><div className="w-44"><Input label="Preview date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div></div>
      {q.isLoading ? <p className="text-sm text-muted">Loading prices…</p> : slots.length === 0 ? <p className="text-sm text-muted">No time slots on this day.</p> : (
        <>{slots.some((x) => x.price == null) && <p role="status" className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Some times have no price, so they cannot be booked.</p>}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`Prices on ${date}`}>{slots.map((x) => <li key={x.startsAt} className="rounded-xl border border-line px-3 py-2 text-sm"><div className="font-semibold">{fmtTime(x.startsAt)}</div><div className={x.price == null ? 'text-xs text-danger' : 'text-xs'}>{x.price == null ? 'Price not set' : money(x.price)}</div></li>)}</ul></>)}
    </section>);
}

const PRICING_MODES = [{ value: 'default', title: '1. Default pricing', text: 'One price for every time.' }, { value: 'slot', title: '2. Slot wise pricing', text: 'A price for each slot.' }] as const;

/** JusGo's Pricing: per playing area, choose Default pricing (one price for every time) or Slot wise pricing (a price for each slot). */
function AreaPricing({ area, sportName, dayLabel, onSlotWise, onSaved }: { area: any; sportName(id: number | null): string; dayLabel(t: string): string; onSlotWise(): void; onSaved(): void }) {
  const def = (area.pricing ?? []).find((p: any) => p.sportId == null && p.dayType === 'all' && p.dayOfWeek == null && p.startTime === '00:00' && p.endTime === '24:00');
  const others = (area.pricing ?? []).filter((p: any) => p !== def);
  const [mode, setMode] = useState<'default' | 'slot' | ''>(def && !others.length ? 'default' : others.length ? 'slot' : '');
  const [price, setPrice] = useState(def ? String(def.pricePerHour) : ''); const [attempted, setAttempted] = useState(false); const [confirming, setConfirming] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState('');
  const problem = !(Number(price) > 0) ? 'Enter the default price (more than 0).' : Number(price) > 100000 ? 'The price can be at most ₹100000 an hour.' : '';
  const replaces = [others.length ? `${others.length} day and time price${others.length === 1 ? '' : 's'}` : '', (area.pricing ?? []).length ? '' : ''].filter(Boolean);
  const apply = useMutation({ mutationFn: () => put(`/owner/areas/${area.id}/default-price`, { basePrice: Number(price), applyToAll: false }),
    onSuccess: () => { setConfirming(false); setSaved(`Default price saved: ${money(Number(price))} per hour for every slot of ${area.name} that has no price of its own.`); setAttempted(false); onSaved(); }, onError: (e) => { setConfirming(false); setError(apiError(e)); } });
  const submit = (e: React.FormEvent) => { e.preventDefault(); setAttempted(true); setError(''); setSaved(''); if (problem) return; apply.mutate(); };
  return (
    <section aria-label={`Pricing of ${area.name}`}><Card className="space-y-4 p-5">
      <h3 className="text-2xl font-bold">{area.name}</h3>
      <fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">How do you want to price {area.name}?</legend>
        <div role="radiogroup" aria-label="Pricing type" className="grid gap-3 sm:grid-cols-2">{PRICING_MODES.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => setMode(m.value)} className={cx('flex items-start gap-3 rounded-xl border-2 p-4 text-left transition', mode === m.value ? 'border-brand bg-brand/10' : 'border-line hover:border-brand/50')}>
            <span aria-hidden="true" className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', mode === m.value ? 'border-brand' : 'border-muted')}>{mode === m.value && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}</span>
            <span className="min-w-0"><span className="block text-base font-bold">{m.title}</span><span className="mt-0.5 block text-sm text-muted">{m.text}</span></span></button>))}</div></fieldset>
      {(mode === 'default' || mode === 'slot') && (
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}{saved && <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm">{saved}</p>}
          <section className="rounded-xl border border-line p-4"><h4 className="text-base font-bold">Default pricing</h4><p className="mb-3 text-sm text-muted">{def ? `Set when the playing area was created. ` : ''}Every slot without a price of its own costs this. Prices you set for particular slots stay and are used for those slots.</p>
            <div className="max-w-xs"><Input mandatory label="Default price (₹ per hour)" type="number" min={1} inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setSaved(''); }} error={attempted ? problem : undefined} /></div></section>
          <div className="flex justify-end"><Button type="submit" loading={apply.isPending}>{def ? 'Change default price' : 'Set default price'}</Button></div>
        </form>)}
      {mode === 'slot' && (
        <section aria-label="Slot wise pricing" className="space-y-3">
          <p className="text-sm text-muted">A price for each slot, for each day of the week. Anything without its own price uses the default price{def ? ` (${money(Number(def.pricePerHour))} an hour)` : ''}.</p>
          {(area.pricing ?? []).length === 0 ? <p className="text-sm text-warn">No prices set. Customers can't book this area.</p> : (
            <Table rows={(area.pricing ?? []).slice(0, 14).map((p: any) => ({ ...p, id: p.id }))} columns={[{ key: 'w', header: 'Time window', render: (p: any) => `${p.startTime} – ${p.endTime}` }, { key: 'dayType', header: 'Days', render: (p: any) => (p.dayOfWeek != null ? DAYS[p.dayOfWeek] : dayLabel(p.dayType)) }, { key: 'sportId', header: 'Sport', render: (p: any) => sportName(p.sportId) }, { key: 'pricePerHour', header: 'Price / hour', render: (p: any) => <b>{money(p.pricePerHour)}</b> }]} />)}
          <Button type="button" onClick={onSlotWise}>Set slot prices</Button>
          <DatePrices area={area} />
        </section>)}
      {mode && <PricePreview area={area} />}
    </Card></section>
  );
}

/** Pricing: pick the venue, then one of its playing areas; only that area's prices are shown (?area=ID opens one directly). */
function AreaPick({ areas, children }: { areas: any[]; children(area: any): ReactNode }) {
  const [sp] = useSearchParams();
  const [id, setId] = useState(sp.get('area') ?? '');
  const area = areas.find((a) => a.id === id) ?? areas[0];
  return (<div className="space-y-4">
    <div className="-mt-2 max-w-sm"><Select label="Select playing area" value={area.id} onChange={(e) => setId(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
    {children(area)}</div>);
}
export function PricingPage() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<any>(null);
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string }[] }>('/sports'), staleTime: Infinity });
  const hist = useQuery({ queryKey: ['owner-pricing-history'], queryFn: () => get<{ history: any[] }>('/owner/pricing/history') });
  const name = (id: number | null) => (id ? sports.data?.sports.find((s) => s.id === id)?.name ?? 'Sport' : 'All sports');
  const dayLabel = (t: string) => ({ all: 'Every day', weekday: 'Weekdays', weekend: 'Weekends' } as Record<string, string>)[t] ?? t;
  return (
    <div><PageHeader title="Pricing & rates" subtitle="Hourly prices by time window, sport and day type. Changes apply to new bookings immediately." />
      <div className="space-y-8">
        <WithVenue editableWhenPending alwaysPick label="Select venue">{(v) => v.areas.length === 0 ? <Empty title="No playing areas" hint="Add a playing area first." action={<Link className="btn-primary" to={`/owner/areas?venue=${v.id}`}>Add area</Link>} /> : (
          <div className="space-y-4"><AreaPick areas={v.areas}>{(a: any) => (
            <AreaPricing key={a.id} area={a} sportName={name} dayLabel={dayLabel} onSlotWise={() => setEdit(a)} onSaved={() => { qc.invalidateQueries({ queryKey: ['owner-venue', v.id] }); qc.invalidateQueries({ queryKey: ['owner-pricing-history'] }); qc.invalidateQueries({ queryKey: ['price-preview', a.id] }); qc.invalidateQueries({ queryKey: ['pricing-gate'] }); qc.invalidateQueries({ queryKey: ['owner-overview'] }); }} />)}</AreaPick><SpecialDatesCard venueId={v.id} />
            {edit && <ScheduleModal area={edit} sports={sports.data?.sports ?? []} onClose={() => setEdit(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['owner-venue', v.id] }); qc.invalidateQueries({ queryKey: ['owner-pricing-history'] }); qc.invalidateQueries({ queryKey: ['price-preview', edit.id] }); qc.invalidateQueries({ queryKey: ['pricing-gate'] }); qc.invalidateQueries({ queryKey: ['owner-overview'] }); }} />}</div>)}</WithVenue>
        <section><h2 className="mb-3 text-3xl font-bold">Pricing history</h2>
          <QueryBoundary q={hist} empty={(d) => d.history.length === 0 && <p className="text-sm text-muted">No pricing changes recorded yet.</p>}>
            {(d) => <ul className="space-y-3">{d.history.map((h, i) => (
              <li key={i} className="card p-4 text-sm"><div className="mb-2 flex flex-wrap justify-between gap-2"><b>{h.area_name} <span className="font-normal text-muted">· {h.venue_name}</span></b><span className="text-muted">{fmtDateTime(h.created_at)}</span></div>
                <div className="grid gap-3 sm:grid-cols-2"><div><div className="mb-1 text-xs uppercase text-muted">Before</div>{h.metadata.before.length === 0 ? <span className="text-muted">No prices</span> : h.metadata.before.map((p: any, j: number) => <div key={j}>{p.startTime}–{p.endTime} · {money(p.pricePerHour)}</div>)}</div>
                  <div><div className="mb-1 text-xs uppercase text-muted">After</div>{h.metadata.after.map((p: any, j: number) => <div key={j}>{p.startTime}–{p.endTime} · <b>{money(p.pricePerHour)}</b></div>)}</div></div></li>))}</ul>}</QueryBoundary></section>
      </div></div>
  );
}
