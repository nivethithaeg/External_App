import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, get, patch, post } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, ConfirmButton, Empty, Input, Modal, PageHeader, PasswordInput, QueryBoundary, Select } from '../../components/ui';
import { fmtDateTime } from '../../lib/utils';

interface Staff { id: string; full_name: string; email: string; is_active: boolean; last_login: string | null; check_ins: number; permissions: string[]; all_venues?: boolean; venue_ids?: string[] }
interface Perm { id: string; label: string; hint: string }
const DEFAULT_PERMS = ['CHECK_IN', 'BOOKING_VIEW'];

/** Choose exactly what this person can see and do. Nothing is added for you: they get exactly what you tick. */
function PermissionPicker({ all, value, onChange }: { all: Perm[]; value: string[]; onChange(v: string[]): void }) {
  const on = (id: string) => value.includes(id);
  return (<fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-semibold">Permissions</legend>
    <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={value.length === all.length} onChange={(e) => onChange(e.target.checked ? all.map((p) => p.id) : [])} /> Select all permissions</label>
    {all.map((p) => <label key={p.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={on(p.id)} onChange={() => onChange(on(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])} /><span><b>{p.label}</b><span className="block text-xs text-muted">{p.hint}</span></span></label>)}
    {value.length === 0 && <p className="text-xs text-muted">No permissions. This person can only sign in and see that they have no access.</p>}</fieldset>);
}

/** Logins for the people at your gate. They can only look up booking references and check players in; they never see money, settings or customer contact details. */
/** JusGo's "Venue access": every venue (including ones added later), or only the ticked ones. */
function VenueAccess({ venues, all, ids, onChange }: { venues: { id: string; name: string; city?: string }[]; all: boolean; ids: string[]; onChange(all: boolean, ids: string[]): void }) {
  return (
    <fieldset className="space-y-2"><legend className="mb-1 text-sm font-semibold">Venue access</legend>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" role="switch" aria-label="All venues" className="mt-0.5 h-4 w-4 accent-brand" checked={all} onChange={(e) => onChange(e.target.checked, ids)} /><span><b>All venues</b><span className="block text-xs text-muted">Includes venues you add later.</span></span></label>
      {!all && <div className="space-y-1 rounded-xl border border-line p-3" role="group" aria-label="Venues">{venues.length === 0 ? <p className="text-xs text-muted">You have no venues yet.</p> : venues.map((v) => <label key={v.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ids.includes(v.id)} onChange={(e) => onChange(all, e.target.checked ? [...ids, v.id] : ids.filter((x) => x !== v.id))} />{v.name}{v.city ? <span className="text-xs text-muted">· {v.city}</span> : null}</label>)}
        {ids.length === 0 && <p role="alert" className="text-xs text-danger">Choose at least one venue, or switch on All venues.</p>}</div>}
    </fieldset>);
}

export function StaffPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-staff'], queryFn: () => get<{ staff: Staff[]; max: number; permissions: Perm[] }>('/owner/staff') });
  const [perms, setPerms] = useState<string[]>(DEFAULT_PERMS); const [editPerms, setEditPerms] = useState<{ s: Staff; v: string[] } | null>(null);
  const [f, setF] = useState({ fullName: '', email: '', password: '', confirm: '', active: true, allVenues: true, venueIds: [] as string[] }); const [editAccess, setEditAccess] = useState<{ s: Staff; all: boolean; ids: string[] } | null>(null);
  const venuesQ = useQuery({ queryKey: ['owner-venues'], queryFn: () => get<{ venues: { id: string; name: string; city?: string }[] }>('/owner/venues') }); const [err, setErr] = useState(''); const [search, setSearch] = useState(''); const [statusF, setStatusF] = useState('');
  const [reset, setReset] = useState<Staff | null>(null); const [pw, setPw] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['owner-staff'] });
  const add = useMutation({ mutationFn: () => post('/owner/staff', { fullName: f.fullName, email: f.email, password: f.password, isActive: f.active, permissions: perms, allVenues: f.allVenues, venueIds: f.allVenues ? [] : f.venueIds }), onSuccess: () => { toast(`${f.fullName} can now sign in at the owner login with that email and password.`); setF({ fullName: '', email: '', password: '', confirm: '', active: true, allVenues: true, venueIds: [] }); setErr(''); refresh(); }, onError: (e) => setErr(apiError(e)) });
  const toggle = useMutation({ mutationFn: (s: Staff) => patch(`/owner/staff/${s.id}`, { isActive: !s.is_active }), onSuccess: (_r, s) => { toast(s.is_active ? `${s.full_name} is switched off and has been signed out` : `${s.full_name} can sign in again`); refresh(); }, onError: (e) => toast(apiError(e), 'error') });
  const remove = useMutation({ mutationFn: (s: Staff) => del(`/owner/staff/${s.id}`), onSuccess: () => { toast('Staff login removed'); refresh(); }, onError: (e) => toast(apiError(e), 'error') });
  const newPw = useMutation({ mutationFn: () => patch(`/owner/staff/${reset!.id}`, { password: pw }), onSuccess: () => { toast('Password changed. They have been signed out.'); setReset(null); setPw(''); }, onError: (e) => toast(apiError(e), 'error') });
  const savePerms = useMutation({ mutationFn: () => patch(`/owner/staff/${editPerms!.s.id}`, { permissions: editPerms!.v }), onSuccess: () => { toast('Permissions saved'); setEditPerms(null); refresh(); }, onError: (e) => toast(apiError(e), 'error') });
  const saveAccess = useMutation({ mutationFn: () => patch(`/owner/staff/${editAccess!.s.id}`, { allVenues: editAccess!.all, venueIds: editAccess!.all ? [] : editAccess!.ids }), onSuccess: () => { toast('Venue access saved'); setEditAccess(null); refresh(); }, onError: (e) => toast(apiError(e), 'error') });
  const okForm = f.fullName.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 10 && f.confirm === f.password && (f.allVenues || f.venueIds.length > 0);
  return (
    <div className="max-w-3xl space-y-5"><PageHeader title="Staff" subtitle="Manage your venue staff and control what they can access." />
      <Card className="space-y-4 p-5"><h2 className="text-2xl font-bold">Add Staff</h2>
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); setErr(''); add.mutate(); }}>
          <Input mandatory label="Staff Name" autoComplete="off" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} maxLength={100} />
          <Input mandatory label="Email" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} hint="Their sign-in" />
          <PasswordInput mandatory label="Password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} hint="At least 10 characters. Tell them in person." />
          <PasswordInput mandatory label="Confirm Password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} error={f.confirm && f.confirm !== f.password ? 'Passwords do not match' : undefined} />
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" role="switch" aria-label="Active" className="mt-0.5 h-4 w-4 accent-brand" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span><b>Active</b><span className="block text-xs text-muted">An inactive account cannot sign in. You can switch it on later.</span></span></label>
          <div className="sm:col-span-3"><VenueAccess venues={venuesQ.data?.venues ?? []} all={f.allVenues} ids={f.venueIds} onChange={(all, ids) => setF({ ...f, allVenues: all, venueIds: ids })} /></div>
          <div className="sm:col-span-3">{q.data && <PermissionPicker all={q.data.permissions} value={perms} onChange={setPerms} />}</div>
          <div className="sm:col-span-3 flex flex-wrap items-center gap-3"><Button type="submit" loading={add.isPending} disabled={!okForm}>Save</Button>{err && <p role="alert" className="text-sm text-danger">{err}</p>}
            <p className="text-xs text-muted">They sign in at the same owner login page and land on a check-in screen.</p></div></form></Card>
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Search staff (optional)" placeholder="Search by name or email" maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} /><Select label="Status" value={statusF} onChange={(e) => setStatusF(e.target.value)}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
      <QueryBoundary q={q} empty={(d) => d.staff.length === 0 && <Empty icon="🧑‍💼" title="No staff logins yet" hint="Add someone above and they can start checking players in." />}>{(d) => (
        <Card className="divide-y divide-line">{d.staff.filter((s) => (!search || `${s.full_name} ${s.email}`.toLowerCase().includes(search.toLowerCase())) && (!statusF || (statusF === 'active') === s.is_active)).map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0"><b>{s.full_name}</b> <Badge status={s.is_active ? 'approved' : 'suspended'}>{s.is_active ? 'Active' : 'Off'}</Badge>
              <p className="truncate text-sm text-muted">{s.email}</p><p className="text-xs text-muted">{s.all_venues === false ? `${(s.venue_ids ?? []).length} venue${(s.venue_ids ?? []).length === 1 ? '' : 's'}` : 'All venues'}</p><p className="text-xs text-muted">{s.last_login ? `Last signed in ${fmtDateTime(s.last_login)}` : 'Has not signed in yet'} · {s.check_ins} check-in{s.check_ins === 1 ? '' : 's'}</p></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="!py-1.5" onClick={() => setEditPerms({ s, v: s.permissions })}>Permissions</Button>
              <Button variant="ghost" className="!py-1.5" aria-label={`Venues of ${s.full_name}`} onClick={() => setEditAccess({ s, all: s.all_venues !== false, ids: s.venue_ids ?? [] })}>Venues</Button>
              <Button variant="ghost" className="!py-1.5" onClick={() => { setReset(s); setPw(''); }}>New password</Button>
              <Button variant="ghost" className="!py-1.5" loading={toggle.isPending && toggle.variables?.id === s.id} onClick={() => toggle.mutate(s)}>{s.is_active ? 'Switch off' : 'Switch on'}</Button>
              <ConfirmButton variant="danger" className="!py-1.5" message={`Remove ${s.full_name}? Their login is deleted.`} onConfirm={() => remove.mutate(s)}>Remove</ConfirmButton></div>
          </div>))}<p className="p-3 text-xs text-muted">{d.staff.length} of {d.max} staff logins used.</p></Card>)}</QueryBoundary>
      <Modal open={!!editAccess} onClose={() => setEditAccess(null)} title={`Venue access for ${editAccess?.s.full_name ?? ''}`}>{editAccess && (<div className="space-y-4">
        <VenueAccess venues={venuesQ.data?.venues ?? []} all={editAccess.all} ids={editAccess.ids} onChange={(all, ids) => setEditAccess({ ...editAccess, all, ids })} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditAccess(null)}>Cancel</Button><Button loading={saveAccess.isPending} disabled={!editAccess.all && editAccess.ids.length === 0} onClick={() => saveAccess.mutate()}>Save</Button></div></div>)}</Modal>
      <Modal open={!!editPerms} onClose={() => setEditPerms(null)} title={`Permissions for ${editPerms?.s.full_name ?? ''}`}>
        {editPerms && q.data && <><PermissionPicker all={q.data.permissions} value={editPerms.v} onChange={(v) => setEditPerms({ ...editPerms, v })} />
          <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditPerms(null)}>Cancel</Button>
            <Button loading={savePerms.isPending} onClick={() => savePerms.mutate()}>Save permissions</Button></div></>}
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={`New password for ${reset?.full_name ?? ''}`}>
        <PasswordInput label="New password" value={pw} onChange={(e) => setPw(e.target.value)} hint="At least 10 characters" />
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setReset(null)}>Cancel</Button><Button loading={newPw.isPending} disabled={pw.length < 10} onClick={() => newPw.mutate()}>Change password</Button></div></Modal>
    </div>
  );
}
