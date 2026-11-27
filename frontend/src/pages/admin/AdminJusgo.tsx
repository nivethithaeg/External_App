import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, patch, post, put } from '../../lib/api';
import { BarChart } from '../../components/BarChart';
import { Badge, Button, Card, ConfirmButton, Empty, Input, Modal, PageHeader, QueryBoundary, Select, Stat, Table, Textarea } from '../../components/ui';
import { fmtDateTime, money, titleCase } from '../../lib/utils';

const todayISO = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/* ------------------------------------------------------------- Sports */
export function AdminSports() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-sports'], queryFn: () => get<{ sports: any[] }>('/admin/sports') });
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [edit, setEdit] = useState<{ id: number; name: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-sports'] });
  const add = useMutation({ mutationFn: () => post('/admin/sports', { name: name.trim() }), onSuccess: () => { setName(''); setErr(''); refresh(); }, onError: (e) => setErr(apiError(e)) });
  const toggle = useMutation({ mutationFn: (s: any) => patch(`/admin/sports/${s.id}`, { isActive: !s.isActive }), onSuccess: refresh });
  const rename = useMutation({ mutationFn: () => patch(`/admin/sports/${edit!.id}`, { name: edit!.name.trim() }), onSuccess: () => { setEdit(null); refresh(); }, onError: (e) => setErr(apiError(e)) });
  return (
    <div><PageHeader title="Sports" subtitle="The sports venues can offer. Switch one off to stop new venues choosing it." />
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-4"><div className="min-w-56 flex-1"><Input label="Add a sport" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Padel tennis" maxLength={40} /></div>
        <Button loading={add.isPending} disabled={name.trim().length < 2} onClick={() => add.mutate()}>Add sport</Button>{err && <p role="alert" className="w-full text-sm text-danger">{err}</p>}</Card>
      <QueryBoundary q={q} empty={(d) => d.sports.length === 0 && <Empty icon="⚽" title="No sports yet" />}>{(d) => <Table rows={d.sports} columns={[
        { key: 'name', header: 'Sport', render: (s: any) => <b>{s.name}</b> }, { key: 'venues', header: 'Venues' }, { key: 'areas', header: 'Playing areas' },
        { key: 'isActive', header: 'Status', render: (s: any) => <Badge status={s.isActive ? 'approved' : 'suspended'}>{s.isActive ? 'Active' : 'Off'}</Badge> },
        { key: 'a', header: '', render: (s: any) => <span className="flex gap-2"><Button variant="ghost" className="!py-1" onClick={() => setEdit({ id: s.id, name: s.name })}>Rename</Button><Button variant="ghost" className="!py-1" loading={toggle.isPending && toggle.variables?.id === s.id} onClick={() => toggle.mutate(s)}>{s.isActive ? 'Switch off' : 'Switch on'}</Button></span> }]} />}</QueryBoundary>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Rename sport">{edit && <div className="space-y-3"><Input label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />{err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={rename.isPending} onClick={() => rename.mutate()}>Save</Button></div></div>}</Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Listing changes */
export function AdminListingChanges() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-listing-changes'], queryFn: () => get<{ changes: any[] }>('/admin/listing-changes') });
  const [rej, setRej] = useState<any | null>(null); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-listing-changes'] });
  const decide = useMutation({ mutationFn: (v: { id: string; decision: 'approve' | 'reject'; reason?: string }) => post(`/admin/venues/${v.id}/changes`, { decision: v.decision, ...(v.reason ? { reason: v.reason } : {}) }),
    onSuccess: () => { setRej(null); setReason(''); setErr(''); refresh(); }, onError: (e) => setErr(apiError(e)) });
  return (
    <div><PageHeader title="Listing changes" subtitle="Edits to live venues wait here. Customers keep seeing the approved version until you approve." />
      <QueryBoundary q={q} empty={(d) => d.changes.length === 0 && <Empty icon="✅" title="Nothing to review" hint="Edits owners make to live venues appear here." />}>{(d) => <div className="space-y-3">{d.changes.map((c) => (
        <Card key={c.venueId} className="space-y-2 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-lg">{c.venueName}</b><div className="text-xs text-muted">{c.ownerName} · {fmtDateTime(c.updatedAt)}</div></div>
          <div className="flex gap-2"><Button variant="ghost" onClick={() => { setRej(c); setReason(''); setErr(''); }}>Reject</Button><Button loading={decide.isPending && decide.variables?.id === c.venueId} onClick={() => decide.mutate({ id: c.venueId, decision: 'approve' })}>Approve</Button></div></div>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">{Object.entries(c.fields ?? {}).map(([k, v]) => <li key={k}><span className="text-muted">{titleCase(k)}:</span> <b>{String(v)}</b></li>)}
            {c.facilitiesChanged && <li><span className="text-muted">Facilities:</span> <b>changed</b></li>}{c.newMedia > 0 && <li><span className="text-muted">New photos/videos:</span> <b>{c.newMedia}</b></li>}{c.removedMedia > 0 && <li><span className="text-muted">Removal requests:</span> <b>{c.removedMedia}</b></li>}</ul></Card>))}</div>}</QueryBoundary>
      <Modal open={!!rej} onClose={() => setRej(null)} title={`Reject changes to ${rej?.venueName ?? ''}`}><div className="space-y-3"><Textarea label="Reason (the owner sees this)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />{err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRej(null)}>Cancel</Button><Button variant="danger" loading={decide.isPending} disabled={reason.trim().length < 3} onClick={() => decide.mutate({ id: rej.venueId, decision: 'reject', reason: reason.trim() })}>Reject changes</Button></div></div></Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Playing area approvals */
export function AdminAreaApprovals() {
  const qc = useQueryClient();
  // the admin email for a delete request links here with ?view=deletions
  const [status, setStatus] = useState(() => (new URLSearchParams(window.location.search).get('view') === 'deletions' ? 'del:pending' : 'pending'));
  const delView = status.startsWith('del:');
  const q = useQuery({ queryKey: ['admin-areas', status], queryFn: () => get<{ areas: any[] }>('/admin/areas', delView ? { deletion: status.slice(4) } : status ? { status } : undefined), placeholderData: (p) => p });
  const [delRej, setDelRej] = useState<any | null>(null); const [delOk, setDelOk] = useState<any | null>(null);
  const decideDel = useMutation({ mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string }) => post(`/admin/areas/${v.id}/deletion`, { decision: v.decision, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => { setDelRej(null); setDelOk(null); setReason(''); setErr(''); qc.invalidateQueries({ queryKey: ['admin-areas'] }); }, onError: (e) => setErr(apiError(e)) });
  const [rej, setRej] = useState<any | null>(null); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const decide = useMutation({ mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string }) => post(`/admin/areas/${v.id}/decision`, { decision: v.decision, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => { setRej(null); setReason(''); setErr(''); qc.invalidateQueries({ queryKey: ['admin-areas'] }); }, onError: (e) => setErr(apiError(e)) });
  return (
    <div><PageHeader title="Playing area approvals" subtitle="A new playing area stays hidden from customers until you approve it." />
      <div className="mb-4 max-w-xs"><Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Waiting for approval</option><option value="rejected">Rejected</option><option value="approved">Approved</option><option value="">All</option><option value="del:pending">Delete requests</option><option value="del:deleted">Deleted areas</option></Select></div>
      <QueryBoundary q={q} empty={(d) => d.areas.length === 0 && <Empty icon="✅" title="Nothing to review" hint={delView ? 'Delete requests from owners appear here.' : 'New playing areas added by owners appear here.'} />}>{(d) => <div className="space-y-3">{d.areas.map((a) => delView ? (
        <Card key={a.id} className={`space-y-2 p-4 ${a.deletionStatus === 'deleted' ? 'opacity-70 grayscale' : ''}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-lg">{a.name}</b> <Badge status={a.deletionStatus === 'deleted' ? 'rejected' : 'pending'}>{a.deletionStatus === 'deleted' ? 'Deleted' : 'Delete requested'}</Badge>
          <div className="text-xs text-muted">{a.venueName}, {a.city} · {a.ownerName}</div></div>
          {a.deletionStatus === 'pending' && <div className="flex gap-2"><Button variant="ghost" onClick={() => { setDelRej(a); setReason(''); setErr(''); }}>Reject request</Button><Button variant="danger" onClick={() => { setErr(''); setDelOk(a); }}>Approve delete</Button></div>}</div>
          {a.deletionReason && <p className="text-sm">Owner's reason: {a.deletionReason}</p>}
          <p className="text-sm text-muted">{a.totalBookings} booking{a.totalBookings === 1 ? '' : 's'} in its history{a.deletionRequestedAt ? ` · requested ${new Date(a.deletionRequestedAt).toLocaleString('en-IN')}` : ''}</p>
          {a.upcomingBookings > 0 && <p role="alert" className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">{a.upcomingBookings} upcoming booking{a.upcomingBookings === 1 ? ' is' : 's are'} still booked here. Deleting does not cancel {a.upcomingBookings === 1 ? 'it' : 'them'}: make sure the owner honours or cancels {a.upcomingBookings === 1 ? 'it' : 'them'}.</p>}
        </Card>) : (
        <Card key={a.id} className="space-y-2 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-lg">{a.name}</b> <Badge status={a.approvalStatus === 'approved' ? 'approved' : a.approvalStatus === 'rejected' ? 'rejected' : 'pending'}>{titleCase(a.approvalStatus)}</Badge>
          <div className="text-xs text-muted">{a.venueName}, {a.city} · {a.ownerName}</div></div>
          {a.approvalStatus !== 'approved' && <div className="flex gap-2">{a.approvalStatus === 'pending' && <Button variant="ghost" onClick={() => { setRej(a); setReason(''); setErr(''); }}>Reject</Button>}<Button loading={decide.isPending && decide.variables?.id === a.id} onClick={() => decide.mutate({ id: a.id, decision: 'approve' })}>Approve</Button></div>}</div>
          <div className="flex flex-wrap gap-1.5 text-sm">{(a.sports as string[]).map((n) => <span key={n} className="chip">{n}</span>)}{a.capacity && <span className="chip">{a.capacity} players</span>}<span className="chip">{a.priceRules} price rule{a.priceRules === 1 ? '' : 's'}</span></div>
          {a.approvalNote && <p className="text-sm text-muted">Reason given: {a.approvalNote}</p>}</Card>))}</div>}</QueryBoundary>
      <Modal open={!!delOk} onClose={() => setDelOk(null)} title={delOk ? `Delete ${delOk.name}?` : ''}>{delOk && <div className="space-y-4 text-sm">
        <p className="text-muted">{delOk.venueName}, {delOk.city} · {delOk.ownerName}</p>
        <div className="flex items-start gap-3 rounded-2xl bg-danger/10 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger/15 text-lg text-danger" aria-hidden="true">🗑</span>
          <ul className="space-y-1.5">
            <li>No one can book this area anymore.</li>
            <li>Its booking history is kept.</li>
          </ul>
        </div>
        {delOk.deletionReason && <p>Owner's reason: {delOk.deletionReason}</p>}
        {delOk.upcomingBookings > 0 && <p role="alert" className="rounded-xl bg-warn/10 px-3 py-2 text-warn">{delOk.upcomingBookings} upcoming booking{delOk.upcomingBookings === 1 ? ' is' : 's are'} not cancelled by this. Make sure the owner honours or cancels {delOk.upcomingBookings === 1 ? 'it' : 'them'}.</p>}
        {err && <p role="alert" className="text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDelOk(null)}>Cancel</Button><Button variant="danger" loading={decideDel.isPending} onClick={() => decideDel.mutate({ id: delOk.id, decision: 'approve' })}>Delete playing area</Button></div>
      </div>}</Modal>
      <Modal open={!!delRej} onClose={() => setDelRej(null)} title={`Reject the delete request for ${delRej?.name ?? ''}?`}><div className="space-y-3"><p className="text-sm text-muted">The playing area is <b className="text-ink">not deleted</b>. It opens for booking again, exactly as it was before the request, and the owner sees your reason.</p><Textarea label="Reason (the owner sees this)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />{err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDelRej(null)}>Cancel</Button><Button loading={decideDel.isPending} disabled={reason.trim().length < 3} onClick={() => decideDel.mutate({ id: delRej.id, decision: 'reject', note: reason.trim() })}>Reject request</Button></div></div></Modal>
      <Modal open={!!rej} onClose={() => setRej(null)} title={`Reject ${rej?.name ?? ''}`}><div className="space-y-3"><Textarea label="Reason (the owner sees this)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />{err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRej(null)}>Cancel</Button><Button variant="danger" loading={decide.isPending} disabled={reason.trim().length < 3} onClick={() => decide.mutate({ id: rej.id, decision: 'reject', note: reason.trim() })}>Reject area</Button></div></div></Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Business type changes */
const TYPE_LABEL: Record<string, string> = { individual: 'Individual', sole_proprietorship: 'Sole Proprietorship', partnership_pvt_ltd: 'Partnership / Private Limited Company', partnership: 'Partnership Firm', private_limited: 'Private Limited Company', opc: 'One Person Company', llp: 'LLP', trust_society: 'Trust / Society / Club' };
const typeName = (t?: string | null) => (t ? TYPE_LABEL[t] ?? t.replace(/_/g, ' ') : 'Not set');
const DETAIL_LABEL: [string, string][] = [['businessName', 'Business name'], ['representativeName', 'Representative'], ['designation', 'Designation'], ['pan', 'PAN'], ['gstin', 'GSTIN'], ['registrationNumber', 'Registration number'], ['udyamNumber', 'Udyam number'], ['dob', 'Date of birth'], ['phone', 'Phone'], ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['pincode', 'PIN code'], ['otherInfo', 'Other information']];
/** Approved owners asking to change their business type: check the new details and approve or reject. */
export function AdminBusinessChanges() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const q = useQuery({ queryKey: ['admin-business-changes', status], queryFn: () => get<{ changes: any[] }>('/admin/business-changes', status ? { status } : undefined), placeholderData: (p) => p });
  const [ok, setOk] = useState<any | null>(null); const [rej, setRej] = useState<any | null>(null); const [note, setNote] = useState(''); const [err, setErr] = useState('');
  const decide = useMutation({ mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string }) => post(`/admin/business-changes/${v.id}/decision`, { decision: v.decision, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => { setOk(null); setRej(null); setNote(''); setErr(''); qc.invalidateQueries({ queryKey: ['admin-business-changes'] }); }, onError: (e) => setErr(apiError(e)) });
  return (
    <div><PageHeader title="Business type changes" subtitle="Approved owners asking to change their business type. Their current details stay live until you approve." />
      <div className="mb-4 max-w-xs"><Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></Select></div>
      <QueryBoundary q={q} empty={(d) => d.changes.length === 0 && <Empty icon="🏢" title="Nothing to review" hint="Business type changes asked for by owners appear here." />}>{(d) => <div className="space-y-3">{d.changes.map((c) => (
        <Card key={c.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-lg">{c.ownerName}</b> <Badge status={c.status === 'pending' ? 'pending' : c.status === 'approved' ? 'approved' : 'rejected'}>{titleCase(c.status)}</Badge>
            <div className="text-xs text-muted">{c.ownerEmail}{c.ownerCode ? ` · ${c.ownerCode}` : ''}{c.currentBusinessName ? ` · ${c.currentBusinessName}` : ''}</div></div>
            {c.status === 'pending' && <div className="flex gap-2"><Button variant="ghost" onClick={() => { setRej(c); setNote(''); setErr(''); }}>Reject</Button><Button onClick={() => { setErr(''); setOk(c); }}>Approve</Button></div>}</div>
          <p className="text-sm"><span className="text-muted">{typeName(c.fromType)}</span> → <b>{typeName(c.toType)}</b></p>
          {c.reason && <p className="text-sm">Owner's reason: {c.reason}</p>}
          <dl className="grid gap-x-6 gap-y-1 rounded-xl border border-line p-3 text-sm sm:grid-cols-2">{DETAIL_LABEL.filter(([k]) => c.details?.[k]).map(([k, l]) => <div key={k} className="flex gap-2"><dt className="text-muted">{l}:</dt><dd className="font-medium">{String(c.details[k])}</dd></div>)}
            {(c.details?.partners ?? []).length > 0 && <div className="sm:col-span-2"><dt className="text-muted">Partners / directors:</dt><dd>{c.details.partners.map((p: any) => `${p.name} (PAN ${p.pan}, Aadhaar ••••${p.aadhaarLast4}, ${p.phone})`).join('; ')}</dd></div>}</dl>
          {c.reviewNote && <p className="text-sm text-muted">Reason given: {c.reviewNote}</p>}
        </Card>))}</div>}</QueryBoundary>
      <Modal open={!!ok} onClose={() => setOk(null)} title={ok ? `Change ${ok.ownerName} to ${typeName(ok.toType)}?` : ''}>{ok && <div className="space-y-4 text-sm">
        <ul className="space-y-1.5 rounded-2xl bg-brand/10 p-4"><li>The new business type and details replace the current ones.</li><li>They are marked as verified by PlaynX.</li></ul>
        {err && <p role="alert" className="text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOk(null)}>Cancel</Button><Button loading={decide.isPending} onClick={() => decide.mutate({ id: ok.id, decision: 'approve' })}>Approve change</Button></div></div>}</Modal>
      <Modal open={!!rej} onClose={() => setRej(null)} title={`Reject the change for ${rej?.ownerName ?? ''}?`}><div className="space-y-3"><p className="text-sm text-muted">Nothing changes: the owner keeps the current business type and sees your reason.</p><Textarea label="Reason (the owner sees this)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />{err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRej(null)}>Cancel</Button><Button variant="danger" loading={decide.isPending} disabled={note.trim().length < 3} onClick={() => decide.mutate({ id: rej.id, decision: 'reject', note: note.trim() })}>Reject change</Button></div></div></Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Revenue */
export function AdminRevenue() {
  const [f, setF] = useState({ from: todayISO(-180), to: todayISO(), groupBy: 'month' });
  const q = useQuery({ queryKey: ['admin-revenue-page', f], queryFn: () => get<{ rows: any[] }>('/admin/reports/revenue', f), placeholderData: (p) => p });
  return (
    <div><PageHeader title="Revenue" subtitle="Platform bookings value, commission and what owners earn." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Input label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Select label="Group by" value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })}><option value="day">Day</option><option value="month">Month</option></Select></div>
      <QueryBoundary q={q} empty={(d) => d.rows.length === 0 && <Empty icon="📈" title="No revenue in this period" />}>{(d) => {
        const sum = (k: string) => d.rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
        return (<div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4"><Stat label="Bookings value (GMV)" value={money(sum('gmv'))} accent /><Stat label="Commission earned" value={money(sum('commission'))} accent /><Stat label="Owner earnings" value={money(sum('owner_earnings'))} /><Stat label="Bookings" value={sum('bookings')} /></div>
          <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Commission by {f.groupBy}</h2><BarChart title="Commission earned" data={d.rows.map((r) => ({ period: r.period, revenue: Number(r.commission), bookings: r.bookings }))} valueKey="revenue" labelKey="period" /></Card>
          <Table rows={d.rows.map((r) => ({ ...r, id: r.period }))} columns={[{ key: 'period', header: 'Period' }, { key: 'bookings', header: 'Bookings' }, { key: 'gmv', header: 'GMV', render: (r: any) => money(r.gmv) }, { key: 'commission', header: 'Commission', render: (r: any) => money(r.commission) }, { key: 'owner_earnings', header: 'Owner earnings', render: (r: any) => money(r.owner_earnings) }]} />
        </div>);
      }}</QueryBoundary>
    </div>
  );
}

/* ------------------------------------------------------------- Customers */
import { Loading } from '../../components/ui';
import { downloadCsv } from '../owner/OwnerCustomers';

export function AdminCustomers() {
  const [sp] = useSearchParams();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [sel, setSel] = useState<string | null>(sp.get('open'));
  const q = useQuery({ queryKey: ['admin-customers', search, status], queryFn: () => get<{ customers: any[]; summary: any }>('/admin/customers', { ...(search.trim() ? { q: search.trim() } : {}), ...(status ? { status } : {}) }), placeholderData: (p) => p });
  const detail = useQuery({ queryKey: ['admin-customer', sel], enabled: !!sel, queryFn: () => get<any>(`/admin/customers/${sel}`) });
  const csv = () => q.data && downloadCsv('customers.csv', ['Name', 'Email', 'Mobile', 'City', 'Bookings', 'Cancelled', 'Total spent', 'Last booking', 'Joined', 'Status'],
    q.data.customers.map((c) => [c.full_name, c.email, c.phone, c.city, c.bookings, c.cancelled, c.spent, c.last_booking ? fmtDateTime(c.last_booking) : '', fmtDateTime(c.created_at), c.is_active ? 'Active' : 'Suspended']));
  return (
    <div><PageHeader title="Customers" subtitle="Everyone who signed up to book, with their activity. Open a row for the full profile." actions={<Button variant="ghost" onClick={csv} disabled={!q.data?.customers.length}>⬇ Download CSV</Button>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_12rem]"><Input label="Search" placeholder="Name, email, mobile or city" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></Select></div>
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4"><Stat label="Customers" value={d.summary.customers} /><Stat label="Active" value={d.summary.active} /><Stat label="New in 30 days" value={d.summary.new_30d} accent /><Stat label="Repeat customers" value={d.summary.repeat} /></div>
          {d.customers.length === 0 ? <Empty icon="👥" title="No customers match" /> : <Table rows={d.customers} onRow={(c: any) => setSel(c.id)} columns={[
            { key: 'full_name', header: 'Customer', render: (c: any) => <div><b>{c.full_name}</b><div className="text-xs text-muted">{c.email}{c.phone ? ` · ${c.phone}` : ''}</div></div> },
            { key: 'city', header: 'City', render: (c: any) => c.city ?? '—' }, { key: 'bookings', header: 'Bookings' }, { key: 'cancelled', header: 'Cancelled' }, { key: 'spent', header: 'Total spent', render: (c: any) => money(c.spent) },
            { key: 'last_booking', header: 'Last booking', render: (c: any) => (c.last_booking ? fmtDateTime(c.last_booking) : '—') },
            { key: 'is_active', header: 'Status', render: (c: any) => <Badge status={c.is_active ? 'approved' : 'suspended'}>{c.is_active ? 'Active' : 'Suspended'}</Badge> }]} />}
        </div>)}</QueryBoundary>
      <Modal open={!!sel} onClose={() => setSel(null)} title={detail.data ? detail.data.customer.full_name : 'Customer'}>
        {detail.isLoading || !detail.data ? <Loading /> : (() => { const d = detail.data; const c = d.customer; return (
          <div className="space-y-4 text-sm">
            <div><p>{c.email} {c.email_verified && '✉️'}</p><p>{c.phone ?? 'No mobile'} {c.phone_verified && '📱'}</p><p className="text-muted">{[c.city, `Joined ${fmtDateTime(c.created_at)}`].filter(Boolean).join(' · ')}</p>
              {(c.preferredSports ?? []).length > 0 && <p className="text-muted">Likes: {c.preferredSports.join(', ')}</p>}<Badge status={c.is_active ? 'approved' : 'suspended'}>{c.is_active ? 'Active' : 'Suspended'}</Badge></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Bookings" value={d.stats.bookings} /><Stat label="Cancelled" value={d.stats.cancelled} /><Stat label="Total spent" value={money(d.stats.spent)} accent /><Stat label="Wallet" value={money(d.stats.wallet)} /></div>
            <p className="text-muted">Refunded so far: {money(d.stats.refunded)} ({d.stats.refunds} refund{d.stats.refunds === 1 ? '' : 's'})</p>
            <section><h3 className="mb-1 text-lg font-bold">Bookings</h3>{d.bookings.length === 0 ? <p className="text-muted">No bookings.</p> : <ul className="max-h-60 divide-y divide-line overflow-y-auto">{d.bookings.map((b: any) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span><b>{b.venue} · {b.area}</b>{b.sport ? ` · ${b.sport}` : ''}<span className="block text-xs text-muted">{fmtDateTime(b.starts_at)} · {b.reference}</span></span><span className="text-right"><b>{money(b.total)}</b><span className="block"><Badge status={['cancelled', 'no_show'].includes(b.status) ? 'rejected' : 'approved'}>{titleCase(b.status)}</Badge></span></span></li>))}</ul>}</section>
            {d.tickets.length > 0 && <section><h3 className="mb-1 text-lg font-bold">Support tickets</h3><ul className="divide-y divide-line">{d.tickets.map((t: any) => <li key={t.id} className="flex justify-between gap-2 py-1.5"><span>{t.subject}</span><Badge status={t.status === 'resolved' || t.status === 'closed' ? 'approved' : 'pending'}>{titleCase(t.status)}</Badge></li>)}</ul></section>}
            {d.reviews.length > 0 && <section><h3 className="mb-1 text-lg font-bold">Reviews</h3><ul className="divide-y divide-line">{d.reviews.map((r: any, i: number) => <li key={i} className="py-1.5"><b>{r.venue}</b> · {'★'.repeat(r.rating)}{r.comment && <span className="block text-muted">{r.comment}</span>}</li>)}</ul></section>}
            {d.logins.length > 0 && <section><h3 className="mb-1 text-lg font-bold">Recent sign-ins</h3><ul className="text-muted">{d.logins.map((l: any, i: number) => <li key={i}>{fmtDateTime(l.created_at)} · {l.ip ?? 'Not recorded'}</li>)}</ul></section>}
          </div>); })()}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Customer reviews */
export function AdminReviews() {
  const qc = useQueryClient();
  const [search, setSearch] = useState(''); const [rating, setRating] = useState(''); const [hidden, setHidden] = useState('');
  const q = useQuery({ queryKey: ['admin-reviews', search, rating, hidden], queryFn: () => get<{ reviews: any[]; summary: any }>('/admin/reviews', { ...(search.trim() ? { q: search.trim() } : {}), ...(rating ? { rating } : {}), ...(hidden ? { hidden } : {}) }), placeholderData: (p) => p });
  const toggle = useMutation({ mutationFn: (r: any) => patch(`/admin/reviews/${r.id}`, { isHidden: !r.is_hidden }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-reviews'] }) });
  return (
    <div><PageHeader title="Reviews" subtitle="What customers wrote about venues. Hide one that breaks the rules; the venue rating updates." />
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_10rem_10rem]"><Input label="Search" placeholder="Comment, venue or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label="Rating" value={rating} onChange={(e) => setRating(e.target.value)}><option value="">All</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}</Select>
        <Select label="Shown" value={hidden} onChange={(e) => setHidden(e.target.value)}><option value="">All</option><option value="false">Visible</option><option value="true">Hidden</option></Select></div>
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3"><Stat label="Reviews" value={d.summary.total} /><Stat label="Average rating" value={d.summary.average ? `${d.summary.average} ★` : '—'} accent /><Stat label="Hidden" value={d.summary.hidden} /></div>
          {d.reviews.length === 0 ? <Empty icon="⭐" title="No reviews match" /> : <ul className="space-y-3">{d.reviews.map((r) => (
            <li key={r.id}><Card className={`p-4 ${r.is_hidden ? 'opacity-60' : ''}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{r.venue_name}</b> <span className="text-warn">{'★'.repeat(r.rating)}<span className="text-muted">{'★'.repeat(5 - r.rating)}</span></span>
              <div className="text-xs text-muted">{r.customer_name} · {r.customer_email} · {fmtDateTime(r.created_at)}</div></div>
              <Button variant="ghost" className="!py-1" loading={toggle.isPending && toggle.variables?.id === r.id} onClick={() => toggle.mutate(r)}>{r.is_hidden ? 'Show' : 'Hide'}</Button></div>
              {r.comment && <p className="mt-2 text-sm">{r.comment}</p>}{r.owner_reply && <p className="mt-2 rounded-lg bg-surface2 p-2 text-sm"><b>Owner replied:</b> {r.owner_reply}</p>}</Card></li>))}</ul>}
        </div>)}</QueryBoundary>
    </div>
  );
}

/* ------------------------------------------------------------- Customer wallets */
export function AdminWallets() {
  const q = useQuery({ queryKey: ['admin-wallets'], queryFn: () => get<{ wallets: any[]; summary: any }>('/admin/wallets') });
  return (
    <div><PageHeader title="Wallets" subtitle="Customers holding wallet credit (refunds and goodwill). Credit expires 12 months after it is added." />
      <QueryBoundary q={q}>{(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3"><Stat label="Customers with credit" value={d.summary.customers} /><Stat label="Total outstanding" value={money(d.summary.outstanding)} accent /><Stat label="Expiring in 30 days" value={money(d.summary.expiringSoon)} /></div>
          {d.wallets.length === 0 ? <Empty icon="👛" title="No wallet credit outstanding" /> : <Table rows={d.wallets} columns={[
            { key: 'full_name', header: 'Customer', render: (w: any) => <div><b>{w.full_name}</b><div className="text-xs text-muted">{w.email}{w.phone ? ` · ${w.phone}` : ''}</div></div> },
            { key: 'balance', header: 'Balance', render: (w: any) => <b>{money(w.balance)}</b> }, { key: 'next_expiry', header: 'Next expiry', render: (w: any) => fmtDateTime(w.next_expiry) }, { key: 'last_credit', header: 'Last credit', render: (w: any) => fmtDateTime(w.last_credit) },
            { key: 'a', header: '', render: (w: any) => <a className="underline" href={`/admin/customers?open=${w.id}`}>Open customer</a> }]} />}
        </div>)}</QueryBoundary>
    </div>
  );
}
