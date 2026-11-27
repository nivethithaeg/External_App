import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CountUp, SlidingTabs } from '../../components/Motion';
import { AccentLine, AMBER, LineChart, ORANGE, ProgressRing, useAdminIntro, type Series } from '../../components/AdminShowcase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, patch, post, put } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, PageHeader, QueryBoundary, Select, Stat, Table, Textarea, ConfirmButton } from '../../components/ui';
import { cx, fmtDateTime, fmtRange, money, titleCase } from '../../lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { FileLink } from '../../components/FileLink';

type Tab = 'overview' | 'performance' | 'activity';
const TABS: { id: Tab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'performance', label: 'Performance' }, { id: 'activity', label: 'Activity' }];

/** Cards rise and scale in one after another; `at` is the base delay (later while the opening title is showing). */
const enter = (reduce: boolean, at: number, i: number) => (reduce ? {} : { initial: { opacity: 0, y: 18, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { duration: 0.55, delay: at + i * 0.07, ease: 'easeOut' as const } });

export function AdminDashboard() {
  const reduce = !!useReducedMotion();
  const intro = useAdminIntro();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('overview'); const [dir, setDir] = useState(1);
  const [focus, setFocus] = useState<'gmv' | 'commission' | 'bookings' | 'venues' | 'customers' | 'owners'>('gmv');
  const [term, setTerm] = useState('');
  const q = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => get<any>('/admin/dashboard'), refetchInterval: 60000 });
  const recent = useQuery({ queryKey: ['admin-dashboard', 'recent'], queryFn: () => get<{ bookings: any[] }>('/admin/bookings', { limit: 8 }), enabled: tab === 'activity' });
  const go = (t: Tab) => { setDir(TABS.findIndex((x) => x.id === t) > TABS.findIndex((x) => x.id === tab) ? 1 : -1); setTab(t); };
  const glow = useRef<HTMLDivElement>(null);
  const parallax = (e: React.PointerEvent) => { if (reduce || !glow.current) return; const r = e.currentTarget.getBoundingClientRect(); glow.current.style.transform = `translate(${((e.clientX - r.left) / r.width - 0.5) * 40}px, ${((e.clientY - r.top) / r.height - 0.5) * 30}px)`; };
  const at = intro.base;
  return (
    <div className="relative overflow-x-clip" onPointerMove={parallax}>
      {intro.overlay}
      <div ref={glow} aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#7200FF]/10 blur-3xl transition-transform duration-700 ease-out" />
      <motion.div className="relative" initial={reduce || !intro.active ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: Math.max(0, at - 0.4), ease: 'easeOut' }}>
        <PageHeader title="Dashboard" subtitle="What needs you today, and how the platform is doing" />
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <SlidingTabs<Tab> id="admin-tabs" label="Dashboard sections" value={tab} onChange={go} options={TABS} />
          <form role="search" aria-label="Search bookings" onSubmit={(e) => { e.preventDefault(); nav(`/admin/bookings${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`); }}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 transition focus-within:border-[#7200FF] focus-within:shadow-[0_0_0_3px_rgb(255_106_0/.18)] sm:w-80">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-muted"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input aria-label="Search bookings by reference, customer or venue" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search bookings, customers, venues" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-muted/70" /></form>
        </div>
        <QueryBoundary q={q}>{(d) => {
          const trend: any[] = d.trend; const labels = trend.map((t) => t.day.slice(5));
          const series: Series[] = [{ key: 'gmv', label: 'Booking value', color: ORANGE, data: trend.map((t) => t.gmv), format: (n) => money(n) }, { key: 'bookings', label: 'Bookings', color: AMBER, data: trend.map((t) => t.bookings), format: (n) => String(Math.round(n)) }];
          const chartFocus = focus === 'bookings' ? 'bookings' : 'gmv';
          const kpis = [
            { id: 'gmv' as const, label: 'Gross booking value', node: <CountUp value={d.revenue.gmv} format={(n) => money(Math.round(n))} />, hint: `${money(d.revenue.gmv_month)} this month` },
            { id: 'commission' as const, label: 'Platform commission', node: <CountUp value={d.revenue.commission} format={(n) => money(Math.round(n))} />, hint: `${money(d.revenue.commission_month)} this month` },
            { id: 'bookings' as const, label: 'Bookings', node: <CountUp value={d.totals.bookings} />, hint: 'confirmed and completed' },
            { id: 'venues' as const, label: 'Live venues', node: <CountUp value={d.totals.venues} />, hint: '' },
            { id: 'customers' as const, label: 'Customers', node: <CountUp value={d.totals.customers} />, hint: '' },
            { id: 'owners' as const, label: 'Turf owners', node: <CountUp value={d.totals.owners} />, hint: '' }];
          const todo = [
            { n: d.pendingVenues, one: 'venue waiting for approval', many: 'venues waiting for approval', to: '/admin/venues?status=pending' },
            { n: d.pendingOwners, one: 'owner application to review', many: 'owner applications to review', to: '/admin/applications' },
            { n: d.openTickets, one: 'open complaint', many: 'open complaints', to: '/admin/tickets' }].filter((t) => t.n > 0);
          const take = d.revenue.gmv > 0 ? (d.revenue.commission / d.revenue.gmv) * 100 : 0;
          const monthShare = d.revenue.gmv > 0 ? (d.revenue.gmv_month / d.revenue.gmv) * 100 : 0;
          return (
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div key={tab} custom={dir} initial={reduce ? false : { opacity: 0, x: dir * 48 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? undefined : { opacity: 0, x: dir * -48 }} transition={{ duration: 0.32, ease: 'easeInOut' }} className="space-y-6">
                {tab === 'overview' && (<>
                  {todo.length === 0
                    ? <motion.p role="status" {...enter(reduce, at, 0)} className="rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm"><b>Nothing needs your attention.</b> No pending venues, owner applications or complaints.</motion.p>
                    : <section aria-label="Needs your attention"><h2 className="mb-2 text-2xl font-bold">Needs your attention</h2>
                        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{todo.map((t, i) => <motion.li key={t.to} {...enter(reduce, at, i)}><Link to={t.to} className="card group flex items-center justify-between gap-3 border-[#7200FF]/40 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-[#7200FF] hover:shadow-[0_0_24px_-8px_rgb(255_106_0/.6)]"><span><b className="font-display text-3xl text-[#A100FF]">{t.n}</b> <span className="text-sm text-muted">{t.n === 1 ? t.one : t.many}</span></span><span aria-hidden="true" className="text-[#7200FF] transition group-hover:translate-x-1">→</span></Link></motion.li>)}</ul></section>}
                  <section aria-label="Key numbers"><ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {kpis.map((k, i) => { const on = focus === k.id; return (
                      <motion.li key={k.id} {...enter(reduce, at + 0.15, i)}>
                        <button type="button" aria-pressed={on} onClick={() => setFocus(k.id)} className={cx('card relative block w-full overflow-hidden p-5 text-left transition duration-300 hover:-translate-y-1', on ? 'border-[#7200FF]/70 shadow-[0_0_28px_-8px_rgb(255_106_0/.55)]' : 'hover:border-[#7200FF]/40')}>
                          <AccentLine on={on} />
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{k.label}</p>
                          <p className={cx('mt-1 font-display text-4xl font-bold transition-colors duration-300', on ? 'text-[#7200FF]' : 'text-white')} style={on ? { textShadow: '0 0 22px rgb(114 0 255 / .35)' } : undefined}>{k.node}</p>
                          {k.hint && <p className="mt-1 text-xs text-muted">{k.hint}</p>}
                        </button></motion.li>); })}</ul></section>
                  <motion.div {...enter(reduce, at + 0.3, 0)}><Card className="p-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-bold">Last 30 days</h2>
                      <p className="text-xs text-muted">Hover the chart for daily figures. Select Bookings above to bring that line forward.</p></div>
                    <LineChart labels={labels} series={series} focus={chartFocus} delay={at + 0.5} />
                  </Card></motion.div>
                </>)}
                {tab === 'performance' && (<>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <motion.div {...enter(reduce, 0, 0)}><Card className="p-6"><ProgressRing value={take} label="Commission rate" hint="Share of booking value that PlaynX keeps as commission." /></Card></motion.div>
                    <motion.div {...enter(reduce, 0, 1)}><Card className="p-6"><ProgressRing value={monthShare} delay={0.15} label="This month's share" hint="How much of all booking value so far was booked this month." /></Card></motion.div>
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <motion.div {...enter(reduce, 0, 2)}><Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Top venues</h2>{d.topVenues.length === 0 ? <p className="text-sm text-muted">No bookings yet.</p> : <ul className="divide-y divide-line text-sm">{d.topVenues.map((v: any, i: number) => <li key={v.id} className="flex items-center justify-between gap-3 py-2.5"><span className="flex items-center gap-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-surface2 text-xs font-bold text-[#A100FF]">{i + 1}</span>{v.name} <span className="text-muted">({v.bookings})</span></span><b>{money(v.gmv)}</b></li>)}</ul>}</Card></motion.div>
                    <motion.div {...enter(reduce, 0, 3)}><Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Bookings by sport</h2>{d.bookingsBySport.length === 0 ? <p className="text-sm text-muted">No bookings yet.</p> : <ul className="space-y-3 text-sm">{(() => { const max = Math.max(...d.bookingsBySport.map((s: any) => s.bookings)); return d.bookingsBySport.map((s: any, i: number) => <li key={s.name}><div className="flex justify-between"><span>{s.name}</span><b>{s.bookings}</b></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-surface2"><motion.div className="h-2 rounded-full bg-gradient-to-r from-[#7200FF] to-[#A100FF]" initial={reduce ? false : { width: 0 }} animate={{ width: `${(s.bookings / max) * 100}%` }} transition={{ duration: 0.9, delay: 0.25 + i * 0.08, ease: 'easeOut' }} /></div></li>); })()}</ul>}</Card></motion.div></div>
                </>)}
                {tab === 'activity' && (
                  <Card className="p-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-2xl font-bold">Recent bookings</h2><Link to="/admin/bookings" className="text-sm font-semibold text-[#A100FF] hover:underline">View all →</Link></div>
                    {recent.isLoading ? <Loading /> : recent.isError ? <ErrorBox error={recent.error} retry={() => recent.refetch()} /> : (recent.data?.bookings.length ?? 0) === 0 ? <p className="text-sm text-muted">No bookings yet.</p> : (
                      <ul className="divide-y divide-line">{recent.data!.bookings.map((b, i) => (
                        <motion.li key={b.id} initial={reduce ? false : { opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: i * 0.05 }}>
                          <Link to={`/admin/bookings?q=${encodeURIComponent(b.reference)}`} className="flex items-center gap-3 py-3 transition hover:bg-surface2/60">
                            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface2 font-display text-lg font-bold text-[#A100FF] ring-1 ring-[#7200FF]/30">{(b.customer_name ?? '?').trim().charAt(0).toUpperCase()}</span>
                            <span className="min-w-0 flex-1"><b className="block truncate">{b.customer_name ?? 'Walk-in'}</b><span className="block truncate text-xs text-muted">{b.venue_name} · {b.area_name} · {fmtDateTime(b.starts_at)}</span></span>
                            <span className="text-right"><b className="block">{money(b.total)}</b><Badge status={b.status} /></span></Link></motion.li>))}</ul>)}
                  </Card>)}
              </motion.div>
            </AnimatePresence>);
        }}</QueryBoundary>
      </motion.div>
    </div>
  );
}

/** Finance: look at a customer's wallet and add or remove credit with a reason. Wallet money is never paid out as cash. */
function WalletDialog({ user, onClose }: { user: any; onClose(): void }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-wallet', user.id], queryFn: () => get<{ balance: number; entries: { id: number; delta: number; kind: string; note: string | null; created_at: string; reference: string | null; by: string | null }[] }>(`/admin/users/${user.id}/wallet`) });
  const [amount, setAmount] = useState(''); const [reason, setReason] = useState(''); const [mode, setMode] = useState<'credit' | 'debit'>('credit'); const [err, setErr] = useState('');
  const n = Number(amount);
  const save = useMutation({ mutationFn: () => post(`/admin/users/${user.id}/wallet`, { amount: mode === 'credit' ? n : -n, reason: reason.trim() }), onSuccess: () => { setAmount(''); setReason(''); setErr(''); qc.invalidateQueries({ queryKey: ['admin-wallet', user.id] }); toast(mode === 'credit' ? 'Credit added' : 'Credit removed'); }, onError: (e) => setErr(apiError(e)) });
  return (
    <Modal open onClose={onClose} title={`Wallet · ${user.full_name}`}>
      <div className="space-y-4 text-sm">
        <p className="rounded-xl bg-surface2 p-3">Balance <b className="font-display text-2xl text-[rgb(var(--brand-text))]">{q.data ? money(q.data.balance) : '…'}</b></p>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setErr(''); save.mutate(); }}>
          <div role="radiogroup" aria-label="Action" className="flex gap-4">{(['credit', 'debit'] as const).map((m) => <label key={m} className="flex items-center gap-1.5"><input type="radio" name="walletMode" checked={mode === m} onChange={() => setMode(m)} />{m === 'credit' ? 'Add credit' : 'Remove credit'}</label>)}</div>
          <Input label="Amount ₹" type="number" min={1} max={50000} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Reason (the customer sees it)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          {err && <p role="alert" className="text-danger">{err}</p>}
          <Button type="submit" loading={save.isPending} disabled={!(n > 0) || reason.trim().length < 5}>{mode === 'credit' ? 'Add credit' : 'Remove credit'}</Button></form>
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Recent activity</p>
          {(q.data?.entries.length ?? 0) === 0 ? <p className="text-muted">Nothing yet.</p> : <ul className="max-h-56 divide-y divide-line overflow-y-auto">{q.data!.entries.map((e) => <li key={e.id} className="flex justify-between gap-3 py-2"><span>{e.note ?? e.kind}<span className="block text-xs text-muted">{fmtDateTime(e.created_at)}{e.by ? ` · by ${e.by}` : ''}</span></span><b className={e.delta > 0 ? 'text-ok' : ''}>{e.delta > 0 ? '+' : '−'}{money(Math.abs(e.delta))}</b></li>)}</ul>}</div>
      </div>
    </Modal>
  );
}

export function AdminUsers() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ role: '', q: '' }); const [term, setTerm] = useState(''); const [walletFor, setWalletFor] = useState<any>(null);
  const q = useQuery({ queryKey: ['admin-users', f], queryFn: () => get<{ users: any[]; total: number }>('/admin/users', { ...f, limit: 100 }) });
  const toggle = useMutation({ mutationFn: (u: any) => patch(`/admin/users/${u.id}`, { isActive: !u.is_active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }), onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Users" subtitle="Customers, owners and admins" />
      <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_auto]" onSubmit={(e) => { e.preventDefault(); setF({ ...f, q: term }); }}><Input label="Search" placeholder="Name, email or phone" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="">All</option><option value="customer">Customers</option><option value="owner">Owners</option><option value="admin">Admins</option></Select><div className="self-end"><Button type="submit" variant="ghost">Search</Button></div></form>
      <QueryBoundary q={q} empty={(d) => d.users.length === 0 && <Empty title="No users found" icon="👥" />}>{(d) => (<><p className="mb-2 text-xs text-muted">{d.total} users</p><Table rows={d.users} columns={[
        { key: 'full_name', header: 'Name', render: (u) => <div><b>{u.full_name}</b><div className="text-xs text-muted">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></div> },
        { key: 'role', header: 'Role', render: (u) => titleCase(u.admin_role ?? u.role) }, { key: 'v', header: 'Verified', render: (u) => `${u.email_verified ? '✉️' : '—'} ${u.phone_verified ? '📱' : ''}` },
        { key: 'bookings', header: 'Bookings' }, { key: 'created_at', header: 'Joined', render: (u) => u.created_at.slice(0, 10) }, { key: 's', header: 'Status', render: (u) => <Badge status={u.is_active ? 'approved' : 'suspended'}>{u.is_active ? 'Active' : 'Disabled'}</Badge> },
        { key: 'a', header: '', render: (u) => <span className="flex gap-2">{u.role === 'customer' && <Button variant="ghost" className="!py-1" onClick={() => setWalletFor(u)}>Wallet</Button>}<Button variant={u.is_active ? 'danger' : 'ghost'} className="!py-1" onClick={() => window.confirm(`${u.is_active ? 'Disable' : 'Enable'} ${u.full_name}?`) && toggle.mutate(u)}>{u.is_active ? 'Disable' : 'Enable'}</Button></span> }]} /></>)}</QueryBoundary>{walletFor && <WalletDialog user={walletFor} onClose={() => setWalletFor(null)} />}</div>
  );
}

export function AdminOwners() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [status, setStatus] = useState(''); const [sel, setSel] = useState<any>(null);
  const [note, setNote] = useState(''); const [commission, setCommission] = useState('');
  const q = useQuery({ queryKey: ['admin-owners', status], queryFn: () => get<{ owners: any[] }>('/admin/owners', { status: status || undefined }) });
  const [fullRaw, setFull] = useState<{ id: string; accountNumber: string | null } | null>(null); const full = fullRaw && fullRaw.id === sel?.id ? fullRaw : null; // only for the owner it was opened for
  const showBank = useMutation({ mutationFn: () => get<{ bank: { accountNumber: string | null } }>(`/admin/owners/${sel!.id}/bank`), onSuccess: (r) => setFull({ ...r.bank, id: sel.id }) }); // the server notes in the audit log that the full number was looked at
  const verifyBank = useMutation({ mutationFn: (verified: boolean) => post(`/admin/owners/${sel.id}/bank-verification`, { verified }),
    onSuccess: (_r, verified) => { setSel((x: any) => (x ? { ...x, bank_verified: verified } : x)); qc.invalidateQueries({ queryKey: ['admin-owners'] }); toast(verified ? 'Bank account verified. The owner can now be paid.' : 'Bank account marked as not verified.'); }, onError: (e) => toast(apiError(e), 'error') });
  const decide = useMutation({ mutationFn: (s: string) => post(`/admin/owners/${sel.id}/verification`, { status: s, note: note || undefined, commissionOverride: commission === '' ? null : +commission }),
    onSuccess: () => { setSel(null); qc.invalidateQueries({ queryKey: ['admin-owners'] }); toast('Owner updated'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Turf owners" subtitle="Verify business identity before venues go live" actions={<div className="w-44"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></Select></div>} />
      <QueryBoundary q={q} empty={(d) => d.owners.length === 0 && <Empty title="No owners" icon="🧑‍💼" />}>{(d) => <Table rows={d.owners} onRow={(o) => { setSel(o); setNote(o.verification_note ?? ''); setCommission(o.commission_override ?? ''); }} columns={[
        { key: 'business_name', header: 'Business', render: (o) => <div><b>{o.business_name}</b><div className="text-xs text-muted">{o.full_name} · {o.email}</div></div> }, { key: 'gstin', header: 'GSTIN / PAN', render: (o) => `${o.gstin ?? '—'} / ${o.pan ?? '—'}` },
        { key: 'application_status', header: 'Application', render: (o) => <div><Badge status={o.application_status === 'approved' ? 'approved' : o.application_status === 'rejected' ? 'rejected' : 'pending'}>{({ incomplete: 'Not submitted', submitted: 'Submitted', under_review: 'Under review', info_required: 'Info required', resubmission_required: 'Resubmission required', approved: 'Approved', rejected: 'Rejected' } as Record<string, string>)[o.application_status] ?? o.application_status}</Badge>{o.pending_documents > 0 && <div className="mt-1 text-xs text-warn">{o.pending_documents} document{o.pending_documents === 1 ? '' : 's'} to review</div>}</div> },
        { key: 'bank', header: 'Bank', render: (o) => (o.bank_account_masked || o.upi_id ? <Badge status={o.bank_verified ? 'approved' : 'pending'}>{o.bank_verified ? 'Verified' : 'To verify'}</Badge> : <span className="text-xs text-muted">Not added</span>) },
        { key: 'venues', header: 'Venues' }, { key: 'commission_override', header: 'Commission', render: (o) => (o.commission_override != null ? `${o.commission_override}%` : 'Default') }, { key: 'verification_status', header: 'Status', render: (o) => <Badge status={o.verification_status} /> }]} />}</QueryBoundary>
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.business_name ?? ''}>{sel && (<div className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 gap-2"><div><dt className="text-xs text-muted">Owner</dt><dd>{sel.full_name}</dd></div><div><dt className="text-xs text-muted">Contact</dt><dd>{sel.email}<br />{sel.phone}</dd></div><div><dt className="text-xs text-muted">GSTIN</dt><dd>{sel.gstin ?? '—'}</dd></div><div><dt className="text-xs text-muted">PAN</dt><dd>{sel.pan ?? '—'}</dd></div><div className="col-span-2"><dt className="text-xs text-muted">Address</dt><dd>{sel.address ?? '—'}</dd></div><div className="col-span-2"><dt className="text-xs text-muted">Payout account</dt><dd>{sel.bank_account_name ?? '—'} · IFSC {sel.bank_ifsc ?? '—'} · UPI {sel.upi_id ?? '—'}</dd></div></dl>
        {['submitted', 'under_review', 'info_required', 'resubmission_required'].includes(sel.application_status) && <p className="rounded-xl border border-warn/40 bg-warn/10 p-3">This owner has an application in progress{sel.pending_documents > 0 ? ` with ${sel.pending_documents} document(s) to review` : ''}. Business, identity and documents are reviewed under <Link className="font-semibold underline" to={`/admin/applications?owner=${sel.id}`}>Owner applications</Link>, so approval here is turned off to avoid skipping that check.</p>}
        <section aria-label="Bank account" className="rounded-xl border border-line p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-bold">Bank account</h3>
          {sel.bank_account_masked || sel.upi_id ? <Badge status={sel.bank_verified ? 'approved' : 'pending'}>{sel.bank_verified ? 'Verified' : 'Waiting for verification'}</Badge> : <Badge status="rejected">Not added yet</Badge>}</div>
          {sel.bank_account_masked || sel.upi_id ? (<>
            <dl className="grid grid-cols-2 gap-2"><div><dt className="text-xs text-muted">Account holder</dt><dd>{sel.bank_account_name ?? '—'}</dd></div><div><dt className="text-xs text-muted">Account number</dt><dd>{full ? full.accountNumber ?? '—' : sel.bank_account_masked ?? '—'}{sel.bank_account_masked && (full
              ? <button type="button" className="ml-2 text-xs font-semibold underline" onClick={() => setFull(null)}>Hide</button>
              : <button type="button" className="ml-2 text-xs font-semibold underline" disabled={showBank.isPending} onClick={() => showBank.mutate()}>Show full number</button>)}</dd></div>
              <div><dt className="text-xs text-muted">IFSC</dt><dd>{sel.bank_ifsc ?? '—'}</dd></div><div><dt className="text-xs text-muted">UPI ID</dt><dd>{sel.upi_id ?? '—'}</dd></div></dl>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted">Check the holder name against the owner's PAN and identity, then verify. Payouts are blocked until the account is verified.</p>
              {sel.bank_verified ? <ConfirmButton variant="ghost" className="!py-1.5" message="Mark this bank account as not verified? Payouts to this owner will stop until it is verified again." onConfirm={() => verifyBank.mutate(false)}>Mark as not verified</ConfirmButton>
                : <Button loading={verifyBank.isPending} onClick={() => verifyBank.mutate(true)}>Verify bank account</Button>}</div></>)
            : <p className="text-muted">The owner has not added a bank account yet. They are asked for it right after approval.</p>}</section>
        <Textarea label="Note to owner (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Input label="Commission override % (blank = platform default)" type="number" min={0} max={100} step="0.5" value={commission} onChange={(e) => setCommission(e.target.value)} />
        <div className="flex justify-end gap-2">{['submitted', 'under_review', 'info_required', 'resubmission_required'].includes(sel.application_status) ? <Link className="btn-primary" to={`/admin/applications?owner=${sel.id}`}>Review application & documents →</Link> : <><Button variant="danger" disabled={!note.trim()} loading={decide.isPending && decide.variables === 'rejected'} onClick={() => decide.mutate('rejected')}>Reject</Button><Button loading={decide.isPending && decide.variables === 'verified'} onClick={() => decide.mutate('verified')}>Verify owner</Button></>}</div></div>)}</Modal></div>
  );
}

interface CheckItem { id: string; label: string; ok: boolean; detail: string; required: boolean }
interface Checklist { auto: CheckItem[]; manual: { id: string; label: string; checked: boolean; by: string | null }[]; ready: boolean; blocking: number }
interface Score { score: number; grade: string; parts: { key: string; label: string; points: number; max: number; detail: string }[] }

/** What to look at before approving: the facts the system can check, and two judgements only a person can make. Advisory: approving anyway asks to confirm. */
function ApprovalChecklist({ data, onTick, busy }: { data: { checklist: Checklist; score: Score }; onTick(key: string, checked: boolean): void; busy: boolean }) {
  const { checklist: c, score } = data;
  return (
    <section aria-label="Approval checklist" className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xl font-bold">Approval checklist</h3>
        <span className="flex items-center gap-2"><span className={cx('rounded-full px-2.5 py-0.5 text-xs font-bold', c.ready ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>{c.ready ? 'Ready to approve' : `${c.blocking} to resolve`}</span>
          <span title={score.parts.map((p) => `${p.label}: ${p.points}/${p.max}`).join(' · ')} className="rounded-full bg-surface2 px-2.5 py-0.5 text-xs font-bold">Score {score.score}/100 · {score.grade}</span></span></div>
      <ul className="grid gap-1.5 sm:grid-cols-2">{c.auto.map((i) => (
        <li key={i.id} className="flex items-start gap-2"><span aria-hidden="true" className={cx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs', i.ok ? 'bg-ok/20 text-ok' : i.required ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn')}>{i.ok ? '✓' : i.required ? '✗' : '!'}</span>
          <span><span className="sr-only">{i.ok ? 'Passed: ' : i.required ? 'Failed: ' : 'Optional, not done: '}</span><span className="font-semibold">{i.label}</span>{!i.required && <span className="ml-1 text-[10px] uppercase text-muted">optional</span>}<span className="block text-xs text-muted">{i.detail}</span></span></li>))}</ul>
      <div className="border-t border-line pt-2"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">You confirm</p>
        {c.manual.map((m) => (
          <label key={m.id} className="fx-check group flex cursor-pointer items-center gap-2.5 py-1 text-sm"><input type="checkbox" className="sr-only" checked={m.checked} disabled={busy} onChange={(e) => onTick(m.id, e.target.checked)} />
            <span className="fx-box grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 border-line" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#0B1340" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
            <span>{m.label}{m.checked && m.by && <span className="ml-2 text-xs text-muted">ticked by {m.by}</span>}</span></label>))}</div>
    </section>);
}

export function AdminVenues() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [status, setStatus] = useState(new URLSearchParams(location.search).get('status') ?? ''); const [sel, setSel] = useState<string | null>(null); const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['admin-venues', status], queryFn: () => get<{ venues: any[] }>('/admin/venues', { status: status || undefined }) });
  const det = useQuery({ queryKey: ['admin-venue', sel], queryFn: () => get<any>(`/admin/venues/${sel}`), enabled: !!sel });
  const ready = useQuery({ queryKey: ['admin-venue-readiness', sel], queryFn: () => get<{ checklist: Checklist; score: Score }>(`/admin/venues/${sel}/readiness`), enabled: !!sel });
  const templates = useQuery({ queryKey: ['rejection-templates'], queryFn: () => get<{ templates: { id: string; label: string; body: string }[] }>('/admin/rejection-templates'), enabled: !!sel });
  const scores = useQuery({ queryKey: ['admin-venue-scores'], queryFn: () => get<{ scores: Record<string, { score: number; grade: string }> }>('/admin/venue-scores'), enabled: status !== 'pending' && status !== 'rejected' && status !== 'draft' });
  const tick = useMutation({ mutationFn: (v: { key: string; checked: boolean }) => put(`/admin/venues/${sel}/review-checks/${v.key}`, { checked: v.checked }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-venue-readiness', sel] }), onError: (e) => toast(apiError(e), 'error') });
  const saveTemplate = useMutation({ mutationFn: (label: string) => post('/admin/rejection-templates', { label, body: reason.trim() }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['rejection-templates'] }); toast('Saved as a reusable reason'); }, onError: (e) => toast(apiError(e), 'error') });
  const dropTemplate = useMutation({ mutationFn: (id: string) => del(`/admin/rejection-templates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['rejection-templates'] }), onError: (e) => toast(apiError(e), 'error') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-venues'] }); qc.invalidateQueries({ queryKey: ['admin-venue'] }); qc.invalidateQueries({ queryKey: ['admin-dashboard'] }); };
  const decision = useMutation({ mutationFn: (d: string) => post(`/admin/venues/${sel}/decision`, { decision: d, reason: reason || undefined }), onSuccess: () => { refresh(); setReason(''); toast('Decision recorded'); }, onError: (e) => toast(apiError(e), 'error') });
  const changeDecision = useMutation({ mutationFn: (d: string) => post(`/admin/venues/${sel}/changes`, { decision: d, reason: reason || undefined }), onSuccess: () => { refresh(); setReason(''); toast('Decision recorded'); }, onError: (e) => toast(apiError(e), 'error') });
  const docDecision = useMutation({ mutationFn: ({ id, s }: { id: string; s: string }) => patch(`/admin/documents/${id}`, { status: s, note: s === 'rejected' ? reason || 'Document unclear or invalid' : undefined }), onSuccess: () => { refresh(); toast('Document updated'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Venue approvals" subtitle="Review details and documents. Once approved, the owner decides when to publish the venue to customers" actions={<div className="w-44"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['pending', 'changes', 'ready', 'approved', 'rejected', 'suspended', 'draft'].map((s) => <option key={s} value={s}>{s === 'changes' ? 'Changes to review' : titleCase(s)}</option>)}</Select></div>} />
      <QueryBoundary q={q} empty={(d) => d.venues.length === 0 && <Empty title="Nothing here" icon="✅" hint="No venues with this status." />}>{(d) => <Table rows={d.venues} onRow={(v) => setSel(v.id)} columns={[
        { key: 'name', header: 'Venue', render: (v) => <div><b>{v.name}</b><div className="text-xs text-muted">{v.city}</div></div> }, { key: 'owner', header: 'Owner', render: (v) => <div>{v.business_name}<div className="text-xs text-muted">{v.owner_name} · <Badge status={v.verification_status} /></div></div> },
        { key: 'documents', header: 'Docs', render: (v) => `${v.documents - v.pending_documents}/${v.documents} reviewed` }, { key: 'score', header: 'Score', render: (v) => { const sc = scores.data?.scores?.[v.id]; return sc ? <span className={cx('font-bold', sc.score >= 70 ? 'text-ok' : sc.score >= 50 ? 'text-warn' : 'text-danger')} title={sc.grade}>{sc.score}<span className="text-xs font-normal text-muted">/100</span></span> : <span className="text-muted">—</span>; } }, { key: 'status', header: 'Status', render: (v) => <span className="flex flex-wrap gap-1"><Badge status={v.status} />{v.change_pending && <Badge status="pending">Changes to review</Badge>}</span> }]} />}</QueryBoundary>
      <Modal open={!!sel} onClose={() => { setSel(null); setReason(''); }} title={det.data?.venue.name ?? 'Venue'} wide>
        {det.isLoading ? <Loading /> : det.isError ? <ErrorBox error={det.error} /> : det.data && (() => { const { venue: v, documents, images, areas, change } = det.data; const LABEL: Record<string, string> = { name: 'Venue name', description: 'Description', address: 'Address', city: 'City', state: 'State', pincode: 'PIN code', lat: 'Latitude', lng: 'Longitude', contact_phone: 'Contact phone', contact_email: 'Contact email', cancellation_hours: 'Free-cancellation window (hours)', category: 'Venue category', locality: 'Locality / area', country: 'Country' }; return (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge status={v.status} /><span className="text-muted">{v.address}, {v.city} · {v.business_name} ({v.owner_email})</span><Badge status={v.verification_status}>Owner {v.verification_status}</Badge></div>
            {change && <div className="space-y-2 rounded-xl border border-warn/40 bg-warn/10 p-3" aria-label="Changes to review"><h3 className="text-xl font-bold">Changes waiting for approval</h3>
              <p className="text-muted">The owner edited this approved venue. Customers still see the current details until you approve.</p>
              {change.newImages?.length > 0 && <div><p className="font-semibold">New photos and videos ({change.newImages.length})</p><div className="flex gap-2 overflow-x-auto">{change.newImages.map((i: any) => i.kind === 'image' ? <img key={i.id} src={i.url} alt="New photo" className="h-20 rounded-lg" /> : <video key={i.id} src={i.url} className="h-20 rounded-lg" controls />)}</div></div>}
              {change.removedImages?.length > 0 && <div><p className="font-semibold">Photos and videos the owner wants removed ({change.removedImages.length})</p><div className="flex gap-2 overflow-x-auto">{change.removedImages.map((i: any) => i.kind === 'image' ? <img key={i.id} src={i.url} alt="To be removed" className="h-20 rounded-lg opacity-60" /> : <video key={i.id} src={i.url} className="h-20 rounded-lg opacity-60" />)}</div></div>}
              {change.newCover && <div><p className="font-semibold">New cover photo</p><img src={change.newCover.url} alt="New cover" className="h-20 rounded-lg" /></div>}
              {change.newDocuments?.length > 0 && <p><span className="font-semibold">New documents to review:</span> {change.newDocuments.map((d: any) => d.doc_type).join(', ')}. Approve or reject them in the Documents list below.</p>}
              {(Object.keys(change.fields ?? {}).length > 0 || change.facilities) && <table className="w-full text-left"><thead><tr className="text-xs uppercase text-muted"><th className="py-1 pr-3">Detail</th><th className="py-1 pr-3">Now live</th><th className="py-1">Proposed</th></tr></thead><tbody>
                {Object.entries(change.fields as Record<string, unknown>).map(([k, val]) => <tr key={k} className="border-t border-line align-top"><td className="py-1 pr-3 font-semibold">{LABEL[k] ?? k}</td><td className="py-1 pr-3 text-muted">{String(v[k] ?? '—')}</td><td className="py-1">{String(val ?? '—')}</td></tr>)}
                {change.facilities && <tr className="border-t border-line align-top"><td className="py-1 pr-3 font-semibold">Facilities</td><td className="py-1 pr-3 text-muted">{change.facilities.from.join(', ') || '—'}</td><td className="py-1">{change.facilities.to.join(', ') || '—'}</td></tr>}
              </tbody></table>}
              <div className="flex flex-wrap justify-end gap-2"><Button variant="danger" disabled={!reason.trim()} loading={changeDecision.isPending && changeDecision.variables === 'reject'} onClick={() => changeDecision.mutate('reject')}>Reject changes</Button><Button loading={changeDecision.isPending && changeDecision.variables === 'approve'} onClick={() => changeDecision.mutate('approve')}>Approve changes</Button></div>
              <p className="text-xs text-muted">Enter a reason in the box below to reject.</p></div>}
            {v.description && <p className="text-muted">{v.description}</p>}
            {images.length > 0 && <div className="flex gap-2 overflow-x-auto">{images.map((i: any) => i.kind === 'image' ? <img key={i.id} src={i.url} alt="" className="h-24 rounded-lg" /> : <video key={i.id} src={i.url} className="h-24 rounded-lg" controls />)}</div>}
            <div><h3 className="mb-1 text-xl font-bold">Documents</h3>{documents.length === 0 ? <p className="text-muted">None uploaded.</p> : <ul className="divide-y divide-line">{documents.map((d: any) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><FileLink path={`/admin/venue-documents/${d.id}/file`} url={d.url}>{d.doc_type}</FileLink><span className="flex items-center gap-2"><Badge status={d.status} />{d.status !== 'approved' && <Button className="!py-1" onClick={() => docDecision.mutate({ id: d.id, s: 'approved' })}>Approve</Button>}{d.status !== 'rejected' && <Button variant="danger" className="!py-1" onClick={() => docDecision.mutate({ id: d.id, s: 'rejected' })}>Reject</Button>}</span></li>))}</ul>}</div>
            <p className="text-muted">{areas.length} playing area(s)</p>
            {ready.data?.checklist && <ApprovalChecklist data={ready.data} onTick={(key, checked) => tick.mutate({ key, checked })} busy={tick.isPending} />}
            {(templates.data?.templates?.length ?? 0) > 0 && <div aria-label="Saved reasons"><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Saved reasons (click to use)</p>
              <div className="flex flex-wrap gap-2">{templates.data!.templates.map((t) => (
                <span key={t.id} className="chip !px-0 overflow-hidden"><button type="button" className="px-3 py-1 hover:text-ink" onClick={() => setReason(t.body)}>{t.label}</button>
                  <button type="button" aria-label={`Delete saved reason ${t.label}`} className="border-l border-line px-2 py-1 text-muted hover:text-danger" onClick={() => window.confirm(`Delete the saved reason "${t.label}"?`) && dropTemplate.mutate(t.id)}>✕</button></span>))}</div></div>}
            <Textarea label="Reason (required to reject or suspend; shared with owner)" value={reason} onChange={(e) => setReason(e.target.value)} />
            {reason.trim().length >= 10 && <button type="button" className="text-xs font-semibold text-[rgb(var(--brand-text))] hover:underline" onClick={() => { const l = window.prompt('Name for this reason, so you can reuse it'); if (l && l.trim().length >= 2) saveTemplate.mutate(l.trim()); }}>Save this reason for reuse</button>}
            <div className="flex flex-wrap justify-end gap-2">
              {v.status === 'pending' && <><Button variant="danger" disabled={!reason.trim()} loading={decision.isPending && decision.variables === 'reject'} onClick={() => decision.mutate('reject')}>Reject</Button><Button loading={decision.isPending && decision.variables === 'approve'} onClick={() => { if (ready.data?.checklist && !ready.data.checklist.ready && !window.confirm(`${ready.data.checklist.blocking} approval check${ready.data.checklist.blocking === 1 ? ' is' : 's are'} not complete. Approve anyway?`)) return; decision.mutate('approve'); }}>Approve</Button></>}
              {(v.status === 'approved' || v.status === 'ready') && <Button variant="danger" disabled={!reason.trim()} loading={decision.isPending && decision.variables === 'suspend'} onClick={() => decision.mutate('suspend')}>Suspend</Button>}
              {v.status === 'suspended' && <Button loading={decision.isPending && decision.variables === 'reinstate'} onClick={() => decision.mutate('reinstate')}>Reinstate</Button>}</div>
          </div>); })()}
      </Modal></div>
  );
}

export function AdminBookings() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ status: '', q: '', from: '', to: '' }); const [cancel, setCancel] = useState<any>(null); const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['admin-bookings', f], queryFn: () => get<{ bookings: any[]; total: number }>('/admin/bookings', { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), limit: 100 }) /* empty dates are not sent: the server only accepts real dates */ });
  const cx = useMutation({ mutationFn: () => post(`/admin/bookings/${cancel.id}/cancel`, { reason }), onSuccess: () => { setCancel(null); setReason(''); qc.invalidateQueries({ queryKey: ['admin-bookings'] }); toast('Booking cancelled & refunded'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Bookings" subtitle="All bookings across venues" />
      <div className="mb-4 grid gap-3 sm:grid-cols-4"><Input label="Search" placeholder="Reference, email, venue" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /><Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{['confirmed', 'completed', 'pending', 'cancelled', 'expired'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select><Input label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
      <QueryBoundary q={q} empty={(d) => d.bookings.length === 0 && <Empty icon="📅" title="No bookings match" />}>{(d) => (<><p className="mb-2 text-xs text-muted">{d.total} bookings</p><Table animated rows={d.bookings} columns={[
        { key: 'reference', header: 'Ref', render: (b) => <b>{b.reference}</b> }, { key: 'customer_name', header: 'Customer', render: (b) => <div>{b.customer_name}<div className="text-xs text-muted">{b.customer_email}</div></div> },
        { key: 'venue_name', header: 'Venue', render: (b) => <div>{b.venue_name}<div className="text-xs text-muted">{b.area_name}</div></div> }, { key: 'when', header: 'When', watch: (b) => [b.starts_at, b.ends_at], render: (b) => <span className="text-xs">{fmtRange(b.starts_at, b.ends_at)}</span> },
        { key: 'total', header: 'Total', render: (b) => money(b.total) }, { key: 'commission_amount', header: 'Commission', render: (b) => money(b.commission_amount) }, { key: 'status', header: 'Status', render: (b) => <Badge status={b.status} /> },
        { key: 'a', header: '', render: (b) => ['confirmed'].includes(b.status) ? <Button variant="danger" className="!py-1" onClick={() => setCancel(b)}>Cancel</Button> : null }]} /></>)}</QueryBoundary>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title={`Cancel ${cancel?.reference ?? ''}`}><p className="mb-3 text-sm text-muted">The customer receives a full refund and both parties are notified. This is recorded in the audit log.</p><Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setCancel(null)}>Back</Button><Button variant="danger" disabled={reason.trim().length < 3} loading={cx.isPending} onClick={() => cx.mutate()}>Cancel & refund</Button></div></Modal></div>
  );
}

export { fmtDateTime };
