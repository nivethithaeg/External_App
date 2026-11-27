import { useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Logo } from '../../components/Logo';
import { BackButton, ThemeToggle } from '../../components/Layouts';
import { useLogoutConfirm } from '../../components/LogoutConfirm';
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader, PasswordInput, QueryBoundary, Select, Stat, Table } from '../../components/ui';
import { DAYS, DURATIONS, durationLabel, fmtDateTime, fmtRange, fmtTime, money, titleCase } from '../../lib/utils';
import { isIndianMobile, MOBILE_MESSAGE } from '../../lib/phone';

const TABS: { to: string; label: string; any: string[] }[] = [
  { to: '/staff', label: 'Check-in', any: ['CHECK_IN'] }, { to: '/staff/bookings', label: 'Bookings', any: ['BOOKING_VIEW'] }, { to: '/staff/dashboard', label: 'Dashboard', any: ['DASHBOARD_VIEW'] },
  { to: '/staff/venues', label: 'Venues', any: ['VENUE_VIEW', 'PLAYING_AREA_VIEW'] }, { to: '/staff/pricing', label: 'Pricing', any: ['PRICING_VIEW'] },
  { to: '/staff/new-booking', label: 'New booking', any: ['BOOKING_CREATE'] }, { to: '/staff/calendar', label: 'Calendar', any: ['CALENDAR_VIEW'] }, { to: '/staff/reports', label: 'Reports', any: ['REPORTS_VIEW'] },
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
      <main className="mx-auto max-w-3xl px-4 py-6"><BackButton home="/staff" /><Outlet /></main>
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
export function StaffNewBooking() {
  const { toast } = useToast();
  const opts = useQuery({ queryKey: ['staff-booking-options'], queryFn: () => get<{ venues: any[] }>('/staff/booking-options') });
  const [venueId, setVenueId] = useState(''); const [areaId, setAreaId] = useState(''); const [sportId, setSportId] = useState(''); const [date, setDate] = useState(todayISO()); const [duration, setDuration] = useState('');
  const [slot, setSlot] = useState<string>(''); const [f, setF] = useState({ name: '', phone: '', method: 'cash' }); const [err, setErr] = useState(''); const [done, setDone] = useState<string | null>(null);
  const venue = opts.data?.venues.find((v) => v.id === venueId) ?? opts.data?.venues[0];
  const area = venue?.areas.find((a: any) => a.id === areaId) ?? venue?.areas[0];
  const sport = sportId || String(area?.sports[0]?.id ?? '');
  const durations = area ? DURATIONS.filter((d) => d >= area.minDuration && d <= area.maxDuration && d % area.slotMinutes === 0) : [];
  const dur = duration && (durations as number[]).includes(+duration) ? duration : String(durations[0] ?? '');
  const slots = useQuery({ queryKey: ['staff-slots', area?.id, sport, date, dur], enabled: !!area && !!sport && !!dur, queryFn: () => get<{ slots: { startsAt: string; endsAt: string; price: number; available: boolean }[] }>(`/areas/${area.id}/slots`, { date, sportId: sport, duration: dur }) });
  const book = useMutation({
    mutationFn: () => post<{ reference: string }>('/staff/bookings/offline', { areaId: area.id, sportId: +sport, startsAt: slot, durationMinutes: +dur, customerName: f.name.trim(), customerPhone: f.phone.replace(/[\s-]/g, ''), paymentMethod: f.method }),
    onSuccess: (r) => { setDone(r.reference); setSlot(''); setF({ name: '', phone: '', method: 'cash' }); slots.refetch(); toast('Booked', 'success'); }, onError: (e) => setErr(apiError(e)),
  });
  const go = () => { setErr(''); setDone(null); if (!slot) return setErr('Choose a slot'); if (f.name.trim().length < 2) return setErr('Enter the customer name'); if (!isIndianMobile(f.phone.replace(/[\s-]/g, ''))) return setErr(MOBILE_MESSAGE); book.mutate(); };
  return (<div className="space-y-4"><PageHeader title="New booking" subtitle="Book a slot for someone at the counter." />
    <QueryBoundary q={opts} empty={(d) => d.venues.length === 0 && <p className="text-sm text-muted">No live venues to book.</p>}>{() => (
      <Card className="space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Venue" value={venue?.id ?? ''} onChange={(e) => { setVenueId(e.target.value); setAreaId(''); setSlot(''); }}>{opts.data!.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
          <Select label="Playing area" value={area?.id ?? ''} onChange={(e) => { setAreaId(e.target.value); setSportId(''); setSlot(''); }}>{(venue?.areas ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Select label="Sport" value={sport} onChange={(e) => { setSportId(e.target.value); setSlot(''); }}>{(area?.sports ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          <Input label="Date" type="date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setSlot(''); }} />
          <Select label="Duration" value={dur} onChange={(e) => { setDuration(e.target.value); setSlot(''); }}>{durations.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}</Select></div>
        <div role="listbox" aria-label="Slots" className="grid grid-cols-2 gap-2 sm:grid-cols-3">{(slots.data?.slots ?? []).map((x) => (
          <button key={x.startsAt} type="button" role="option" aria-selected={slot === x.startsAt} disabled={!x.available} onClick={() => setSlot(x.startsAt)}
            className={`rounded-xl border-2 p-2 text-sm ${slot === x.startsAt ? 'border-brand bg-brand/10' : 'border-line'} disabled:opacity-40`}>{fmtRange(x.startsAt, x.endsAt, venue?.timezone ?? 'Asia/Kolkata')}<br /><b>{money(x.price)}</b></button>))}
          {slots.data && slots.data.slots.length === 0 && <p className="col-span-full text-sm text-muted">No slots on this day.</p>}</div>
        <div className="grid gap-3 sm:grid-cols-3"><Input mandatory label="Customer name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><Input mandatory label="Mobile" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Select label="Payment received as" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="unpaid">Not paid yet</option></Select></div>
        {err && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
        {done && <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm font-semibold text-ok">Booked. Reference {done}</p>}
        <Button loading={book.isPending} onClick={go}>Book slot</Button></Card>)}</QueryBoundary></div>);
}
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
