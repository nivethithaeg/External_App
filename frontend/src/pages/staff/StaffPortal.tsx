import { useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/Layouts';
import { useLogoutConfirm } from '../../components/LogoutConfirm';
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader, PasswordInput, QueryBoundary, Select, Stat, Table } from '../../components/ui';
import { DAYS, DURATIONS, durationLabel, fmtDateTime, fmtRange, fmtTime, money, titleCase } from '../../lib/utils';
import { isIndianMobile, MOBILE_MESSAGE } from '../../lib/phone';

const TABS: { to: string; label: string; any: string[] }[] = [
  { to: '/staff', label: 'Check-in', any: ['CHECK_IN'] }, { to: '/staff/bookings', label: 'Bookings', any: ['BOOKING_VIEW'] }, { to: '/staff/dashboard', label: 'Dashboard', any: ['DASHBOARD_VIEW'] },
  { to: '/staff/venues', label: 'Venues', any: ['VENUE_VIEW', 'PLAYING_AREA_VIEW'] }, { to: '/staff/pricing', label: 'Pricing', any: ['PRICING_VIEW'] },
  { to: '/staff/calendar', label: 'Calendar', any: ['CALENDAR_VIEW'] }, { to: '/staff/reports', label: 'Reports', any: ['REPORTS_VIEW'] },
  { to: '/staff/blocks', label: 'Block slots', any: ['BLOCK_SLOTS'] }, { to: '/staff/customers', label: 'Customers', any: ['CUSTOMER_VIEW'] }, { to: '/staff/payments', label: 'Event payments', any: ['PAYMENT_RECORD'] },
];
export const useStaffMe = () => useQuery({ queryKey: ['staff-me'], queryFn: () => get<{ business: string; permissions: string[] }>('/staff/me') });
/** Only the pages the owner ticked for this person are shown. */
function StaffTabs() {
  const me = useStaffMe();
  const tabs = [...TABS.filter((t) => t.any.some((p) => me.data?.permissions.includes(p))), { to: '/staff/profile', label: 'Profile', any: [] as string[] }];
  return <nav aria-label="Staff pages" className="border-b border-line bg-surface"><div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4">{tabs.map((t) => (
    <NavLink key={t.to} to={t.to} end className={({ isActive }) => `whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold ${isActive ? 'border-brand text-[rgb(var(--brand-text))]' : 'border-transparent text-muted hover:text-ink'}`}>{t.label}</NavLink>))}</div></nav>;
}
/** The landing page: the first page this person is allowed to use. */
export function StaffHome() {
  const me = useStaffMe();
  if (me.isLoading) return <Loading />;
  if (me.isError) return <ErrorBox error={me.error} retry={() => me.refetch()} />;
  const first = TABS.find((t) => t.any.some((p) => me.data!.permissions.includes(p)));
  if (!first) return <p className="rounded-xl border border-line p-4 text-sm">Your venue owner has not given you access to any pages yet. Please ask them to update your permissions.</p>;
  return first.to === '/staff' ? <StaffCheckIn /> : <Navigate to={first.to} replace />;
}

/** The gate staff's portal: one screen to check players in. It has no money, bookings management or settings. */
export function StaffLayout() {
  const { user, logout } = useAuth(); const nav = useNavigate();
  const ask = useLogoutConfirm(() => { logout(); nav('/owner/login'); }, 'owner');
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface"><div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4"><Logo subtitle="Venue staff" />
        <div className="flex items-center gap-2"><ThemeToggle /><span className="hidden text-sm text-muted sm:block">{user?.fullName}</span><Button variant="ghost" className="!py-2" onClick={ask.ask}>Log out</Button></div></div></header>
      <StaffTabs />
      <main className="mx-auto max-w-3xl px-4 py-6"><Outlet /></main>
      {ask.dialog}
    </div>
  );
}

interface Booking { reference: string; status: string; starts_at: string; ends_at: string; area_name: string; venue_name: string; customer_name: string; checked_in_at: string | null }
const timeOnly = (b: { starts_at: string; ends_at: string }, tz = 'Asia/Kolkata') => `${fmtTime(b.starts_at, tz)} – ${fmtTime(b.ends_at, tz)}`;

export function StaffCheckIn() {
  const { toast } = useToast(); const qc = useQueryClient();
  const today = useQuery({ queryKey: ['staff-overview'], queryFn: () => get<{ business: string; bookings: (Booking & { id: string; timezone: string })[] }>('/staff/overview'), refetchInterval: 60000 });
  const [code, setCode] = useState('');
  const [res, setRes] = useState<{ valid: boolean; booking: Booking; checkedAt?: string | null } | null>(null); const [err, setErr] = useState('');
  const verify = useMutation({
    mutationFn: (text: string) => post<{ valid: boolean; booking: Booking }>('/staff/verify', { reference: text.trim() }),
    onMutate: () => { setErr(''); setRes(null); },
    onSuccess: (r) => setRes({ valid: r.valid, booking: r.booking, checkedAt: r.booking.checked_in_at }), onError: (e) => setErr(apiError(e)) });
  const checkIn = useMutation({
    mutationFn: (text: string) => post<{ alreadyCheckedIn: boolean; at: string; booking: Booking }>('/staff/check-in', { reference: text.trim() }),
    onSuccess: (r) => { setRes((x) => (x ? { ...x, checkedAt: r.at } : x)); toast(r.alreadyCheckedIn ? 'Already checked in earlier' : 'Checked in', r.alreadyCheckedIn ? 'info' : 'success'); qc.invalidateQueries({ queryKey: ['staff-overview'] }); },
    onError: (e) => toast(apiError(e), 'error') });
  return (
    <div className="space-y-6">
      <PageHeader title="Check-in" subtitle={today.data ? `${today.data.business}. Type the booking reference the player shows you.` : "Type the booking reference the player shows you"} />
      <Card className="space-y-4 p-5">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6) verify.mutate(code); }}>
          <input className="field uppercase" aria-label="Booking reference" placeholder="PX-XXXXXXX" autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="submit" loading={verify.isPending} disabled={code.trim().length < 6}>Check</Button></form>
        {err && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{err}</p>}
        {res && (
          <div role="status" aria-label="Check-in result" className={`rounded-xl border p-4 ${res.valid ? 'border-ok/50 bg-ok/10' : 'border-danger/50 bg-danger/10'}`}>
            <p className="text-xl font-bold">{res.valid ? '✓ Valid booking' : '✗ Not valid for entry'}</p>
            <p className="mt-1 font-semibold">{res.booking.customer_name}</p>
            <p className="text-sm">{res.booking.area_name} · {res.booking.venue_name}</p><p className="text-xs text-muted">{fmtRange(res.booking.starts_at, res.booking.ends_at, 'Asia/Kolkata')} · {res.booking.status}</p>
            {res.valid && (res.checkedAt
              ? <p className="mt-3 rounded-lg bg-ok/20 px-3 py-2 text-sm font-semibold text-ok">✓ Checked in at {fmtTime(res.checkedAt, 'Asia/Kolkata')}</p>
              : <Button className="mt-3 w-full justify-center" loading={checkIn.isPending} onClick={() => checkIn.mutate(code)}>Check player in</Button>)}
          </div>)}
      </Card>
      <section aria-label="Today's bookings"><h2 className="mb-2 text-2xl font-bold">Today</h2>
        {today.isLoading ? <Loading /> : today.isError ? <ErrorBox error={today.error} retry={() => today.refetch()} /> : today.data!.bookings.length === 0 ? <p className="text-sm text-muted">No bookings today.</p> : (
          <ul className="space-y-2">{today.data!.bookings.map((b) => (
            <li key={b.id} className="card flex items-center justify-between gap-3 p-3"><span className="min-w-0"><b className="block truncate">{b.customer_name}</b><span className="block text-xs text-muted">{timeOnly(b, b.timezone)} · {b.area_name} · {b.reference}</span></span>
              {b.checked_in_at ? <span className="chip !border-ok/50 !text-ok">Checked in</span> : new Date(b.ends_at) < new Date() ? <span className="chip">Ended</span> : <span className="chip">Expected</span>}</li>))}</ul>)}</section>
    </div>
  );
}

/* ---- the pages the owner can switch on for a staff login ---- */
export function StaffBookings() {
  const q = useQuery({ queryKey: ['staff-bookings'], queryFn: () => get<{ bookings: (Booking & { id: string })[] }>('/staff/bookings') });
  return (<div className="space-y-4"><PageHeader title="Bookings" subtitle="Upcoming bookings and the last 7 days. No payment amounts." />
    <QueryBoundary q={q} empty={(d) => d.bookings.length === 0 && <p className="text-sm text-muted">No bookings.</p>}>{(d) => <Table rows={d.bookings} columns={[
      { key: 'starts_at', header: 'When', render: (b: any) => fmtDateTime(b.starts_at) }, { key: 'customer_name', header: 'Customer' },
      { key: 'area_name', header: 'Where', render: (b: any) => `${b.venue_name} · ${b.area_name}` }, { key: 'reference', header: 'Reference' },
      { key: 'status', header: 'Status', render: (b: any) => (b.checked_in_at ? 'Checked in' : titleCase(b.status)) }]} />}</QueryBoundary></div>);
}
export function StaffDashboard() {
  const q = useQuery({ queryKey: ['staff-dashboard'], queryFn: () => get<any>('/staff/dashboard') });
  return (<div className="space-y-4"><PageHeader title="Dashboard" subtitle="Counts for today and the coming days." />
    <QueryBoundary q={q}>{(d) => <div className="grid grid-cols-2 gap-3 sm:gap-4"><Stat label="Today's bookings" value={d.today} /><Stat label="Upcoming bookings" value={d.upcoming} /><Stat label="Checked in today" value={d.checked_in_today} /><Stat label="Venues / playing areas" value={`${d.venues} / ${d.areas}`} /></div>}</QueryBoundary></div>);
}
export function StaffVenues() {
  const q = useQuery({ queryKey: ['staff-venues'], queryFn: () => get<{ venues: any[] }>('/staff/venues') });
  return (<div className="space-y-4"><PageHeader title="Venues" subtitle="Your owner's venues and playing areas." />
    <QueryBoundary q={q} empty={(d) => d.venues.length === 0 && <p className="text-sm text-muted">No venues.</p>}>{(d) => <div className="space-y-3">{d.venues.map((v) => (
      <Card key={v.id} className="p-4"><b className="text-lg">{v.name}</b><p className="text-sm text-muted">{v.address}, {v.city} · {titleCase(v.status)}</p>
        {v.areas.length > 0 && <ul className="mt-2 divide-y divide-line text-sm">{v.areas.map((a: any) => <li key={a.id} className="flex justify-between py-1.5"><span>{a.name}{a.surface ? ` · ${a.surface}` : ''}</span><span className="text-muted">{a.capacity ? `${a.capacity} players · ` : ''}{a.slotMinutes} min slots{a.isActive ? '' : ' · inactive'}</span></li>)}</ul>}</Card>))}</div>}</QueryBoundary></div>);
}
export function StaffPricing() {
  const q = useQuery({ queryKey: ['staff-pricing'], queryFn: () => get<{ prices: any[] }>('/staff/pricing') });
  return (<div className="space-y-4"><PageHeader title="Pricing" subtitle="Current prices per hour. You can look but not change them." />
    <QueryBoundary q={q} empty={(d) => d.prices.length === 0 && <p className="text-sm text-muted">No prices set yet.</p>}>{(d) => <Table rows={d.prices.map((p, i) => ({ ...p, id: String(i) }))} columns={[
      { key: 'venue_name', header: 'Where', render: (p: any) => `${p.venue_name} · ${p.area_name}` }, { key: 'sport', header: 'Sport' },
      { key: 'day_type', header: 'Days', render: (p: any) => (p.day_of_week != null ? DAYS[p.day_of_week] : titleCase(p.day_type ?? 'all')) },
      { key: 'start_time', header: 'Time', render: (p: any) => `${String(p.start_time).slice(0, 5)}–${String(p.end_time).slice(0, 5)}` }, { key: 'price_per_hour', header: 'Per hour', render: (p: any) => money(p.price_per_hour) }]} />}</QueryBoundary></div>);
}

/* ---- counter booking, calendar and reports ---- */
const todayISO = () => new Date().toISOString().slice(0, 10);
export function StaffCalendar() {
  const [date, setDate] = useState(todayISO());
  const q = useQuery({ queryKey: ['staff-calendar', date], queryFn: () => get<{ items: any[] }>('/staff/calendar', { date }), placeholderData: (p) => p });
  return (<div className="space-y-4"><PageHeader title="Calendar" subtitle="What is booked or blocked on a day." /><div className="max-w-xs"><Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
    <QueryBoundary q={q} empty={(d) => d.items.length === 0 && <p className="text-sm text-muted">Nothing booked or blocked on this day.</p>}>{(d) => <ul className="space-y-2">{d.items.map((b) => (
      <li key={b.id} className="card flex items-center justify-between gap-3 p-3"><span><b className="block">{b.status === 'blocked' ? 'Blocked' : b.event_title ?? b.customer_name}</b><span className="text-xs text-muted">{b.venue_name} · {b.area_name} · {fmtRange(b.starts_at, b.ends_at, 'Asia/Kolkata')}</span></span><span className="chip">{titleCase(b.status)}</span></li>))}</ul>}</QueryBoundary></div>);
}
export function StaffReports() {
  const q = useQuery({ queryKey: ['staff-reports'], queryFn: () => get<any>('/staff/reports') });
  return (<div className="space-y-4"><PageHeader title="Reports" subtitle="Bookings and revenue for the last 30 days." />
    <QueryBoundary q={q}>{(d) => <><div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3"><Stat label="Bookings" value={d.totals.bookings} /><Stat label="Cancelled" value={d.totals.cancelled} /><Stat label="Revenue" value={money(d.totals.revenue)} accent /></div>
      <Table rows={d.venues.map((v: any) => ({ ...v, id: v.venue_name }))} columns={[{ key: 'venue_name', header: 'Venue' }, { key: 'bookings', header: 'Bookings' }, { key: 'cancelled', header: 'Cancelled' }, { key: 'revenue', header: 'Revenue', render: (v: any) => money(v.revenue) }]} /></>}</QueryBoundary></div>);
}

/** JusGo's staff "Profile": who this is, what the owner allows, and a way to change the password. */
export function StaffProfile() {
  const { user } = useAuth(); const me = useStaffMe(); const { toast } = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' }); const [confirm, setConfirm] = useState(''); const [err, setErr] = useState('');
  const change = useMutation({ mutationFn: () => post('/auth/change-password', pw), onSuccess: () => { setPw({ currentPassword: '', newPassword: '' }); setConfirm(''); toast('Your password has been changed.'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Profile" subtitle="Your staff account." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-4 p-5"><h2 className="text-xl font-bold">Your account</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Name</dt><dd>{user?.fullName}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Email</dt><dd className="break-all">{user?.email}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Role</dt><dd>Staff</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Status</dt><dd><Badge status="active">Active</Badge></dd></div>
          </dl>
          <div><h3 className="mb-2 text-sm font-bold uppercase tracking-wide">What you can access</h3>
            {me.data?.permissions.length ? <ul className="flex flex-wrap gap-2">{me.data.permissions.map((p) => <li key={p} className="chip">{titleCase(p.toLowerCase().replace(/_/g, ' '))}</li>)}</ul> : <p className="text-sm text-muted">Nothing yet.</p>}
            <p className="mt-3 text-xs text-muted">Your Venue Owner decides these. Ask them if you need something changed.</p></div></Card>
        <Card className="p-5"><h2 className="mb-3 text-xl font-bold">Change password</h2>
          <form className="max-w-md space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setErr(''); if (!pw.currentPassword) return setErr('Enter your current password.'); if (!(pw.newPassword.length >= 8 && /[A-Za-z]/.test(pw.newPassword) && /\d/.test(pw.newPassword))) return setErr('Use at least 8 characters with a letter and a digit.'); if (confirm !== pw.newPassword) return setErr('The two passwords do not match.'); change.mutate(); }}>
            <PasswordInput mandatory label="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <PasswordInput mandatory label="New password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint="At least 8 characters with a letter and a digit" />
            <PasswordInput mandatory label="Confirm new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <Button type="submit" loading={change.isPending}>Change password</Button></form></Card>
      </div></div>);
}

/** Close a slot for maintenance or rain, and open it again. Venue events added by the owner are not shown here. */
export function StaffBlocks() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff-blocks'], queryFn: () => get<{ areas: any[]; blocks: any[] }>('/staff/blocks') });
  const [f, setF] = useState({ areaId: '', date: todayISO(), from: '', to: '', reason: '' }); const [err, setErr] = useState('');
  const areaId = f.areaId || q.data?.areas[0]?.id || '';
  const add = useMutation({ mutationFn: () => post('/staff/blocks', { areaId, startsAt: `${f.date}T${f.from}:00+05:30`, endsAt: `${f.date}T${f.to}:00+05:30`, reason: f.reason.trim() }),
    onSuccess: () => { toast('Slot blocked'); setF({ ...f, from: '', to: '', reason: '' }); qc.invalidateQueries({ queryKey: ['staff-blocks'] }); }, onError: (e) => setErr(apiError(e)) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/staff/blocks/${id}`), onSuccess: () => { toast('Slot opened again'); qc.invalidateQueries({ queryKey: ['staff-blocks'] }); }, onError: (e) => toast(apiError(e), 'error') });
  const go = () => { setErr(''); if (!areaId) return setErr('Choose the playing area'); if (!f.from || !f.to) return setErr('Enter the start and end time'); if (f.to <= f.from) return setErr('The end time must be after the start time'); if (f.reason.trim().length < 2) return setErr('Enter the reason, e.g. Rain or Maintenance'); add.mutate(); };
  return (<div className="space-y-4"><PageHeader title="Block slots" subtitle="Close a slot for maintenance or rain. Customers cannot book it until you open it again." />
    <QueryBoundary q={q}>{(d) => (<>
      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <Select label="Playing area" value={areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })}>{d.areas.map((a) => <option key={a.id} value={a.id}>{a.venue_name} · {a.name}</option>)}</Select>
        <Input label="Date" type="date" min={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Input label="From" type="time" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input label="To" type="time" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <div className="sm:col-span-2"><Input label="Reason" placeholder="e.g. Rain, Maintenance" maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><Button loading={add.isPending} onClick={go}>Block slot</Button>{err && <p role="alert" className="text-sm text-danger">{err}</p>}</div>
      </Card>
      <h2 className="text-xl font-bold">Blocked slots</h2>
      {d.blocks.length === 0 ? <p className="text-sm text-muted">No slots are blocked.</p> : <ul className="space-y-2">{d.blocks.map((b) => (
        <li key={b.id} className="card flex items-center justify-between gap-3 p-3"><span><b className="block">{b.reason || 'Blocked'}</b><span className="text-xs text-muted">{b.venue_name} · {b.area_name} · {fmtRange(b.starts_at, b.ends_at, b.timezone)}</span></span>
          <Button variant="ghost" className="!py-1.5" loading={remove.isPending && remove.variables === b.id} onClick={() => remove.mutate(b.id)}>Open again</Button></li>))}</ul>}
    </>)}</QueryBoundary></div>);
}

/** Customer names and mobile numbers, to call someone who is late. No payment amounts. */
export function StaffCustomers() {
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['staff-customers'], queryFn: () => get<{ customers: any[] }>('/staff/customers') });
  return (<div className="space-y-4"><PageHeader title="Customers" subtitle="Names and mobile numbers of the people who booked." />
    <div className="max-w-sm"><Input label="Search" placeholder="Name, mobile or city" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    <QueryBoundary q={q} empty={(d) => d.customers.length === 0 && <p className="text-sm text-muted">No customers yet.</p>}>{(d) => {
      const t = search.trim().toLowerCase(); const rows = t ? d.customers.filter((c) => [c.name, c.mobile, c.city].some((x) => x && String(x).toLowerCase().includes(t))) : d.customers;
      return rows.length === 0 ? <p className="text-sm text-muted">No customer matches.</p> : <Table rows={rows.map((c, i) => ({ ...c, id: c.mobile ?? String(i) }))} columns={[
        { key: 'name', header: 'Name', render: (c: any) => <b>{c.name ?? '—'}</b> },
        { key: 'mobile', header: 'Mobile', render: (c: any) => c.mobile ? <a className="underline" href={`tel:${c.mobile}`}>{c.mobile}</a> : '—' },
        { key: 'city', header: 'City', render: (c: any) => c.city ?? '—' }, { key: 'bookings', header: 'Bookings', render: (c: any) => c.bookings },
        { key: 'last', header: 'Last booking', render: (c: any) => (c.last_booking ? fmtDateTime(c.last_booking) : '—') }]} />;
    }}</QueryBoundary></div>);
}

/** Money received at the venue for an event the owner added: cash, UPI or card. */
export function StaffEventPayments() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff-event-payments'], queryFn: () => get<{ events: any[] }>('/staff/event-payments') });
  const [open, setOpen] = useState<any>(null); const [f, setF] = useState({ amount: '', mode: '', note: '' }); const [err, setErr] = useState('');
  const save = useMutation({ mutationFn: () => post(`/staff/event-payments/${open.id}`, { amount: Number(f.amount), mode: f.mode, ...(f.note.trim() ? { note: f.note.trim() } : {}) }),
    onSuccess: () => { toast('Payment recorded'); setOpen(null); qc.invalidateQueries({ queryKey: ['staff-event-payments'] }); }, onError: (e) => setErr(apiError(e)) });
  const go = () => { setErr(''); const a = Number(f.amount); if (!(a > 0)) return setErr('Enter the amount received'); if (a > open.pending) return setErr(`Only ${money(open.pending)} is pending`); if (!f.mode) return setErr('Choose the mode of payment'); save.mutate(); };
  return (<div className="space-y-4"><PageHeader title="Event payments" subtitle="Events the owner added that are not fully paid. Record money as you receive it." />
    <QueryBoundary q={q} empty={(d) => d.events.length === 0 && <p className="text-sm text-muted">Nothing pending. Every event is fully paid.</p>}>{(d) => <ul className="space-y-2">{d.events.map((e) => (
      <li key={e.id} className="card space-y-3 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><span><b className="block">{e.title || e.name}</b><span className="text-xs text-muted">{e.name}{e.mobile ? ` · ${e.mobile}` : ''} · {e.venue_name} · {e.area_name} · {fmtDateTime(e.starts_at)}</span></span>
        <span className="text-right text-sm"><span className="block font-bold text-danger">{money(e.pending)} pending</span><span className="text-xs text-muted">{money(e.paid)} of {money(e.total)} paid</span></span></div>
        {open?.id === e.id ? (<div className="grid gap-3 sm:grid-cols-3">
          <Input label="Amount received (₹)" type="number" min={0} inputMode="decimal" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} />
          <Select label="Mode of payment" value={f.mode} onChange={(x) => setF({ ...f, mode: x.target.value })}><option value="" disabled>Select mode</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></Select>
          <Input label="Note (optional)" maxLength={200} value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} />
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3"><Button loading={save.isPending} onClick={go}>Save payment</Button><Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>{err && <p role="alert" className="text-sm text-danger">{err}</p>}</div></div>)
          : <Button variant="ghost" className="!py-1.5" onClick={() => { setOpen(e); setF({ amount: String(e.pending), mode: '', note: '' }); setErr(''); }}>Record payment</Button>}</li>))}</ul>}</QueryBoundary></div>);
}
