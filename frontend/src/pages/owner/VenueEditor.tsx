import { PanoramaViewer } from '../../components/PanoramaViewer';
import { PhotoSlider } from '../../components/PhotoSlider';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, api, del, get, post, put } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, Input, Loading, Modal, PageHeader, QueryBoundary, Select, Tabs, Textarea, TimeInput } from '../../components/ui';
import { VenueCover } from '../../components/VenueCard';
import { FileLink } from '../../components/FileLink';
import { LocationPicker } from '../../lib/maps';
import { StateCityFields } from '../../components/StateCity';
import { CreateVenuePage, VenueForm } from './CreateVenue';
import { ScheduleModal } from './AreaSchedule';
import { LiveCamera, type LiveShot } from '../../components/LiveCamera';
import { buildPrices, unpricedCount, type Day, defaultRule } from '../../lib/schedule';
import { categoryOptions } from '../../lib/venueCategories';
import { DAYS, DURATIONS, durationLabel, fmtDateTime, fmtRange, money } from '../../lib/utils';

export function OwnerVenuesPage() {
  const q = useQuery({ queryKey: ['owner-venues'], queryFn: () => get<{ venues: any[] }>('/owner/venues') });
  const qc = useQueryClient(); const { toast } = useToast();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [sport, setSport] = useState('');
  const sportOptions = useMemo(() => [...new Map((q.data?.venues ?? []).flatMap((v) => v.sports ?? []).map((x: any) => [x.id, x.name])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [q.data]);
  const matches = (v: any) => (!status || (status === 'active' ? ['ready', 'approved'].includes(v.status) : !['ready', 'approved'].includes(v.status)))
    && (!sport || (v.sports ?? []).some((x: any) => String(x.id) === sport))
    && (!search.trim() || [v.name, v.city, v.pincode, v.locality, v.address].some((x) => x && String(x).toLowerCase().includes(search.trim().toLowerCase())));
  // publishing and deactivating act on the card itself; customers see the change straight away (only published venues are listed to them)
  const act = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'publish' | 'unpublish' | 'send-for-approval' }) => post(`/owner/venues/${id}/${what}`),
    onSuccess: (_r, { id, what }) => {
      qc.invalidateQueries({ queryKey: ['owner-venues'] }); qc.invalidateQueries({ queryKey: ['owner-venue', id] }); qc.invalidateQueries({ queryKey: ['venues'] });
      toast(what === 'publish' ? 'Published. Customers can find and book this venue now.' : what === 'unpublish' ? 'Deactivated. Customers can no longer see or book this venue. Existing bookings are not affected.' : 'Sent for approval. PlaynX will review it.', 'success');
    },
    onError: (e) => toast(apiError(e), 'error'),
  });
  const busyOn = (id: string, what: string) => act.isPending && act.variables?.id === id && act.variables?.what === what;
  return (
    <div><PageHeader title="Your venues" subtitle="Create venues, set pricing and publish after approval" actions={<Link to="/owner/venues/new" className="btn-primary">+ Add venue</Link>} />
      {(q.data?.venues.length ?? 0) > 0 && <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
        <Input label="Search venues" placeholder="Search by name, city or PIN code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
        <Select label="Sport" value={sport} onChange={(e) => setSport(e.target.value)}><option value="">All sports</option>{sportOptions.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}</Select></div>}
      <QueryBoundary q={q} empty={(d) => d.venues.length === 0 && <Empty title="No venues yet" hint="Add your first turf. You'll upload photos, set prices and operating hours, then submit it for review." action={<Link to="/owner/venues/new" className="btn-primary">Add your first venue</Link>} />}>
        {(d) => d.venues.filter(matches).length === 0 ? <Empty icon="🔎" title="No venues match" hint="Try a different search or clear the filters." /> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{d.venues.filter(matches).map((v) => {
          const live = ['ready', 'approved'].includes(v.status);
          return (
            <article key={v.id} aria-label={v.name} className="card animate-rise flex flex-col overflow-hidden transition hover:border-brand/50" data-greyed={live ? undefined : 'true'}>
              <Link to={`/owner/venues/${v.id}`} className={`block ${live ? '' : 'opacity-60 grayscale'}`}><div className="h-36"><PhotoSlider photos={(v.photos ?? []).map((u: string) => ({ url: u }))} alt={v.name} fallback={<VenueCover src={v.cover_image ?? null} name={v.name} />} /></div>
                <div className="space-y-1 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-2xl font-bold">{v.name}</h3><Badge status={v.status}>{STATUS_HELP[v.status]?.label ?? v.status}</Badge></div>
                  <p className="text-sm text-muted">{v.city} · {v.area_count} area{v.area_count === 1 ? '' : 's'}</p>
                  {v.status === 'rejected' && v.rejection_reason && <p className="text-xs text-danger">Rejected: {v.rejection_reason}</p>}
                  {v.status === 'pending' && <p className="text-xs text-muted">Waiting for approval. It cannot be edited until PlaynX reviews it. Customers can book it once it is approved.</p>}
                  {v.status === 'draft' && <p className="text-xs text-muted">Your owner account is approved, but each venue is approved separately. Press <b>Send for approval</b> when it is ready.</p>}</div></Link>
              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line p-3">
                {v.status === 'pending' && <><button type="button" disabled title="Locked while the venue is under approval" className="btn-ghost !py-1.5 cursor-not-allowed opacity-50">Edit</button><Link to={`/owner/venues/${v.id}`} className="btn-ghost !py-1.5">View</Link></>}
                {!['pending', 'suspended'].includes(v.status) && <Link to={`/owner/venues/${v.id}`} className="btn-ghost !py-1.5">Edit</Link>}
                {['draft', 'rejected'].includes(v.status) && <Button className="!py-1.5" loading={busyOn(v.id, 'send-for-approval')} onClick={() => act.mutate({ id: v.id, what: 'send-for-approval' })}>Send for approval</Button>}
                {v.status === 'ready' && <Button className="!py-1.5" loading={busyOn(v.id, 'publish')} onClick={() => act.mutate({ id: v.id, what: 'publish' })}>Publish</Button>}
                {v.status === 'approved' && <ConfirmButton variant="ghost" className="!py-1.5" message={`Deactivate ${v.name}? Customers will no longer see or book it. Existing bookings are not affected. You can publish it again any time.`} onConfirm={() => act.mutate({ id: v.id, what: 'unpublish' })}>{busyOn(v.id, 'unpublish') ? 'Deactivating…' : 'Deactivate'}</ConfirmButton>}
                {v.status === 'suspended' && <span className="text-xs text-muted">Suspended by PlaynX. Contact support.</span>}
              </div>
            </article>);
        })}</div>}
      </QueryBoundary></div>
  );
}

/** What each venue status means, in plain words. */
export const STATUS_HELP: Record<string, { label: string; text: string }> = {
  draft: { label: 'Not published', text: 'Saved, but not live. Only you can see it; customers cannot find or book it. Fill in the details below and press Send for approval.' },
  pending: { label: 'Under approval', text: 'Sent to PlaynX and waiting for approval. Its details cannot be changed. It is hidden from customers and greyed out until approved. Set its prices and opening hours meanwhile. You will be notified of the decision.' },
  ready: { label: 'Approved · not published', text: 'PlaynX approved this venue. It is not shown to customers until you press Publish venue.' },
  approved: { label: 'Published', text: 'Live on PlaynX. Customers can find it and book it. Press Unpublish to hide it again.' },
  rejected: { label: 'Needs changes', text: 'PlaynX asked for changes. Fix the issues listed below and publish again.' },
  suspended: { label: 'Suspended', text: 'Temporarily hidden by PlaynX. Contact support to find out why.' },
};

/** The venue's quality score out of 100, how each part is worked out, and what would raise it. */
function ScoreCard({ venueId }: { venueId: string }) {
  const q = useQuery({ queryKey: ['owner-venue-score', venueId], queryFn: () => get<{ score: number; grade: string; parts: { key: string; label: string; points: number; max: number; detail: string }[]; tips: string[] }>(`/owner/venues/${venueId}/score`) });
  if (!q.data?.parts) return null;
  const d = q.data; const tone = d.score >= 70 ? 'text-ok' : d.score >= 50 ? 'text-warn' : 'text-danger';
  return (
    <section aria-label="Venue score" className="card space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-xl font-bold">Venue score</h3><p className="text-sm text-muted">A higher score builds trust with players. It is worked out from these four things, updated every time you open this page.</p></div>
        <p className={`font-display text-5xl font-extrabold leading-none ${tone}`}>{d.score}<span className="text-lg font-semibold text-muted">/100</span> <span className="ml-1 text-base font-bold">{d.grade}</span></p></div>
      <ul className="grid gap-3 sm:grid-cols-2">{d.parts.map((p) => (
        <li key={p.key}><div className="flex justify-between text-sm"><b>{p.label}</b><span className="tabular-nums">{p.points}/{p.max}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${(p.points / p.max) * 100}%` }} /></div><p className="mt-1 text-xs text-muted">{p.detail}</p></li>))}</ul>
      {d.tips.length > 0 && <div><p className="mb-1 text-sm font-semibold">How to raise it</p><ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">{d.tips.map((t) => <li key={t}>{t}</li>)}</ul></div>}
    </section>
  );
}

export function VenueEditorPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const isNew = !id || id === 'new';
  const q = useQuery({ queryKey: ['owner-venue', id], queryFn: () => get<{ venue: any }>(`/owner/venues/${id}`), enabled: !isNew });
  if (isNew) return <CreateVenuePage />;
  const tab = ['overview', 'areas', 'edit'].includes(sp.get('tab') ?? '') ? sp.get('tab')! : sp.get('edit') === '1' ? 'edit' : 'overview';
  return (
    <QueryBoundary q={q}>{({ venue }) => {
      const st = STATUS_HELP[venue.status] ?? { label: venue.status, text: '' };
      const pano = ((venue.images ?? []) as any[]).find((i) => i.kind === 'panorama' && !i.delete_requested);
      return (
        <div className="space-y-6">
          <PageHeader title={venue.name} subtitle={[venue.city, venue.state].filter(Boolean).join(', ')} actions={<Badge status={venue.status}>{st.label}</Badge>} />
          <div role="status" className="rounded-xl border border-line bg-surface p-3 text-sm"><b>{st.label}:</b> {st.text}</div>
          {venue.status === 'rejected' && venue.rejection_reason && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><b>Reason from PlaynX:</b> {venue.rejection_reason}</p>}
          <Tabs tabs={[{ id: 'overview', label: '360° View' }, { id: 'areas', label: 'Playing areas' }, { id: 'edit', label: 'Edit venue' }]} value={tab} onChange={(t) => setSp(t === 'overview' ? {} : { tab: t }, { replace: true })} />
          {tab === 'overview' && (<div className="space-y-4"><VenueSummary venue={venue} />
            <Card className="space-y-3 p-5"><h2 className="text-xl font-bold">360° Venue View</h2>
              {pano ? <PanoramaViewer src={pano.url} alt={`${venue.name} 360° view`} /> : <p className="text-sm text-muted">No 360° photo yet. Add one in the Edit venue tab.</p>}</Card></div>)}
          {tab === 'areas' && <AreasTab venue={venue} />}
          {tab === 'edit' && <VenueForm venue={venue} />}
        </div>);
    }}</QueryBoundary>
  );
}

export function DocumentsTab({ venue }: { venue: any }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [docType, setDocType] = useState('Electricity bill'); const [busy, setBusy] = useState(false); const ref = useRef<HTMLInputElement>(null);
  const upload = async (file?: File) => {
    if (!file) return; setBusy(true);
    try { const fd = new FormData(); fd.append('file', file); fd.append('docType', docType); await api.post(`/owner/venues/${venue.id}/documents`, fd, { timeout: 120000 }); toast('Document uploaded'); qc.invalidateQueries({ queryKey: ['owner-venue', venue.id] }); }
    catch (e) { toast(apiError(e), 'error'); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <Card className="space-y-4 p-5"><h2 className="text-2xl font-bold">Verification documents</h2><p className="text-sm text-muted">Upload proof of ownership or lease, trade licence, GST or ID. PDF, JPG or PNG up to 10 MB.</p>
      <div className="flex flex-wrap items-end gap-3"><div className="min-w-56 flex-1"><Select label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)}>{['Electricity bill', 'Ownership / lease deed', 'Trade licence', 'GST certificate', 'PAN card', 'Government ID', 'Other'].map((t) => <option key={t}>{t}</option>)}</Select></div>
        <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png" hidden onChange={(e) => upload(e.target.files?.[0])} /><Button loading={busy} onClick={() => ref.current?.click()}>Upload</Button></div>
      {venue.documents.length === 0 ? <p className="text-sm text-muted">No documents uploaded.</p> : (
        <ul className="divide-y divide-line">{venue.documents.map((d: any) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><FileLink path={`/owner/venue-documents/${d.id}/file`} url={d.url}>{d.doc_type}</FileLink><span className="flex items-center gap-2">{d.note && <span className="text-xs text-muted">{d.note}</span>}<Badge status={d.status} /></span></li>))}</ul>)}
    </Card>
  );
}

/** What the owner sees next to a venue until PlaynX approves it. */
const WAITING: Record<string, string> = { draft: 'Not sent for approval yet', pending: 'Waiting for approval', rejected: 'Needs changes', suspended: 'Suspended' };

/**
 * The venue an area belongs to, drawn as a card like the ones on the venues page. Until PlaynX approves the venue the card is greyed out
 * and says it is waiting for approval.
 */
export function VenueSummary({ venue, compact = false }: { venue: any; compact?: boolean }) {
  const photos = ((venue.images ?? []) as any[]).filter((i) => i.kind === 'image' && !i.is_pending && !i.area_id);
  const cover = photos.find((i) => i.is_cover) ?? photos[0];
  const live = ['ready', 'approved'].includes(venue.status);
  return (
    <div aria-label="Venue" data-greyed={live ? undefined : 'true'} className={`card flex items-stretch overflow-hidden transition ${live ? '' : 'opacity-60 grayscale'}`}>
      <div className={`${compact ? 'w-24' : 'w-36 sm:w-48'} shrink-0 bg-surface2`}>
        <PhotoSlider photos={[...(cover ? [cover] : []), ...photos.filter((x) => x !== cover)]} alt={venue.name} fallback={<div className="grid h-full min-h-20 place-items-center text-xs text-muted">No photo</div>} /></div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3 sm:p-4">
        <p className="text-xs uppercase tracking-wide text-muted">Venue</p>
        <div className="flex flex-wrap items-center gap-2"><p className={`truncate font-bold ${compact ? 'text-lg' : 'text-2xl'}`}>{venue.name}</p>
          {!live && <Badge status={venue.status === 'pending' ? 'pending' : venue.status === 'draft' ? 'pending' : 'rejected'}>{WAITING[venue.status] ?? 'Waiting for approval'}</Badge>}</div>
        <p className="truncate text-sm text-muted">{[venue.locality, venue.city, venue.state].filter(Boolean).join(', ')}</p>
        {!live && !compact && <p className="text-xs text-muted">{venue.status === 'pending' ? 'PlaynX is reviewing this venue. Customers can book it once it is approved.' : venue.status === 'draft' ? 'Finish the details and send it for approval. Customers can book it once it is approved.' : 'Customers cannot book this venue right now.'}</p>}
      </div>
    </div>
  );
}

export function AreasTab({ venue }: { venue: any }) {
  const approved = ['ready', 'approved'].includes(venue.status); // playing areas can be added only after PlaynX approves the venue
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [notApproved, setNotApproved] = useState(false); // the pop-up shown when Add area is pressed before the venue is approved
  const [manage, setManage] = useState<{ area: any; what: 'schedule' | 'blocks' } | null>(null);
  const qc = useQueryClient(); const { toast } = useToast();
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string }[] }>('/sports'), staleTime: Infinity });
  const refresh = () => qc.invalidateQueries({ queryKey: ['owner-venue', venue.id] });
  const remove = useMutation({ mutationFn: (v: { id: string; reason?: string }) => del(`/owner/areas/${v.id}`, v.reason ? { reason: v.reason } : undefined), onSuccess: () => { setConfirmDel(null); setDelReason(''); refresh(); qc.invalidateQueries({ queryKey: ['owner-areas'] }); toast('Sent to PlaynX for approval. The area is closed for booking straight away; its bookings are kept.', 'info'); }, onError: (e) => toast(apiError(e), 'error') });
  const undoDelete = useMutation({ mutationFn: (aid: string) => post(`/owner/areas/${aid}/cancel-deletion`, {}), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['owner-areas'] }); toast('Delete request cancelled. The area is back as it was.'); }, onError: (e) => toast(apiError(e), 'error') });
  const toggle = useMutation({
    mutationFn: (a: any) => put(`/owner/areas/${a.id}`, { isActive: !a.is_active, ...(a.is_active && a.__how ? { bookings: a.__how } : {}) }),
    onSuccess: (_r, a) => { refresh(); qc.invalidateQueries({ queryKey: ['owner-areas'] }); toast(a.is_active ? `${a.name} is deactivated. Customers can no longer see or book it. Existing bookings are not affected.` : `${a.name} is active again. Customers can book it.`, a.is_active ? 'info' : undefined); },
    onError: (e) => toast(apiError(e), 'error'),
  });
  /** Deactivating hides the area from customers, so it asks first in a pop-up. Activating is harmless and happens straight away. */
  const [confirmOff, setConfirmOff] = useState<any | null>(null);
  // deleting asks in a pop-up: what happens, the upcoming bookings, and an optional reason for PlaynX
  const [confirmDel, setConfirmDel] = useState<any | null>(null); const [delReason, setDelReason] = useState('');
  const delUpcomingQ = useQuery({ queryKey: ['area-upcoming', confirmDel?.id], enabled: !!confirmDel, queryFn: () => get<{ bookings: any[] }>(`/owner/areas/${confirmDel.id}/upcoming-bookings`) });
  const delUpcoming = delUpcomingQ.data?.bookings ?? [];
  const upcomingQ = useQuery({ queryKey: ['area-upcoming', confirmOff?.id], enabled: !!confirmOff, queryFn: () => get<{ bookings: any[] }>(`/owner/areas/${confirmOff.id}/upcoming-bookings`) });
  const upcoming = upcomingQ.data?.bookings ?? [];
  const flip = (a: any) => { if (a.is_active) setConfirmOff(a); else toggle.mutate(a); };
  return (
    <div className="space-y-4">

      <div className="flex justify-between"><p className="text-sm text-muted">Each playing area (e.g. "Turf A", "Court 1") is booked independently.</p><Button onClick={() => (approved ? setEdit('new') : setNotApproved(true))}>+ Add area</Button></div>
      <Modal open={notApproved} onClose={() => setNotApproved(false)} title="Venue not approved yet">
        <p className="text-sm">{venue.status === 'pending' ? 'PlaynX is still reviewing this venue.' : venue.status === 'draft' ? 'This venue has not been sent for approval yet. Finish its details and press Send for approval.' : 'This venue is not approved right now.'} You can add playing areas once PlaynX approves it.</p>
        <div className="mt-4 flex justify-end"><Button onClick={() => setNotApproved(false)}>OK</Button></div></Modal>
      {venue.areas.length === 0 ? <Empty title="No playing areas" hint="Add an area, choose its sports, then set pricing and hours." /> : <div className="grid gap-4 xl:grid-cols-2">{venue.areas.map((a: any) => {
        const photos = ((venue.images ?? []) as any[]).filter((i) => i.area_id === a.id && i.kind === 'image' && !i.delete_requested);
        const gone: 'pending' | 'deleted' | null = a.deletion_status ?? null; // a delete request (or an approved deletion): greyed out, closed for booking
        return (
        <Card key={a.id} aria-disabled={gone ? true : undefined} className={`overflow-hidden !p-0 ${a.is_active ? '' : 'border-dashed'} ${gone ? 'opacity-60 grayscale' : ''}`}>
          <div className={`relative h-36 bg-surface2 ${a.is_active ? '' : 'opacity-50 grayscale'}`} aria-label={`${a.name} photo`}>
            {photos.length ? <PhotoSlider photos={photos} alt={a.name} /> : <div className="pitch-stripes grid h-full place-items-center bg-gradient-to-br from-[#101B5C] via-[#1B2A80] to-[#101B5C] text-4xl" aria-hidden="true">⚽</div>}
            {photos.length > 1 && <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">{photos.length} photos</span>}
            {!a.is_active && <span className="absolute inset-0 grid place-items-center"><span className="rounded-full bg-black/75 px-3 py-1.5 text-xs font-bold text-white">{gone === 'deleted' ? 'Deleted · closed for booking' : gone === 'pending' ? 'Delete requested · closed for booking' : 'Inactive · hidden from customers'}</span></span>}
            {photos.length === 0 && !gone && <button type="button" onClick={() => setEdit(a)} className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white hover:bg-black/80">+ Add photos</button>}
          </div>
          <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><h3 className="text-2xl font-bold">{a.name}</h3>{gone === 'pending' && <Badge status="pending">Delete waiting for approval</Badge>}{gone === 'deleted' && <Badge status="rejected">Deleted</Badge>}{!a.is_active && !gone && <Badge status="suspended">Inactive</Badge>}{a.approval_status === 'pending' && <Badge status="pending">Waiting for approval</Badge>}{a.approval_status === 'rejected' && <Badge status="rejected">Rejected</Badge>}</div>
            <div className="flex flex-wrap gap-2"><Link to={`/owner/areas/${a.id}`} className="btn-ghost !py-1.5">Details</Link>{gone === 'pending' ? <Button variant="ghost" className="!py-1.5" loading={undoDelete.isPending && undoDelete.variables === a.id} onClick={() => undoDelete.mutate(a.id)}>Cancel delete request</Button> : gone ? null : <><Button variant="ghost" className="!py-1.5" onClick={() => setEdit(a)}>Edit</Button><Button variant="ghost" className="!py-1.5" loading={toggle.isPending && toggle.variables?.id === a.id} onClick={() => flip(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</Button><Button variant="danger" className="!py-1.5" onClick={() => { setDelReason(''); remove.reset(); setConfirmDel(a); }}>Delete</Button></>}</div></div>
          {gone === 'pending' && <p className="text-sm text-muted">You asked to delete this area. It is closed for booking while PlaynX reviews the request. Existing bookings are kept.</p>}
          {gone === 'deleted' && <p className="text-sm text-muted">Deleted{a.deleted_at ? ` on ${new Date(a.deleted_at).toLocaleDateString('en-IN')}` : ''}. It can't be booked; its booking history is kept.</p>}
          {!gone && a.deletion_note && <p role="alert" className="text-sm text-warn">PlaynX rejected your delete request: {a.deletion_note}</p>}
          {a.approval_status === 'pending' && !gone && <p className="text-sm text-muted">PlaynX is reviewing this area. Customers can book it once it is approved.</p>}
          {a.approval_status === 'rejected' && <p role="alert" className="text-sm text-danger">Rejected: {a.approval_note ?? 'no reason given'}. Edit the area and save it to send it for review again.</p>}
          <div className="flex flex-wrap gap-1.5">{a.sport_ids.map((sid: number) => <span key={sid} className="chip">{sports.data?.sports.find((s) => s.id === sid)?.name ?? sid}</span>)}<span className="chip">{a.slot_minutes}-min slots</span><span className="chip">{a.min_duration_minutes}–{a.max_duration_minutes} min bookings</span></div>
          {!gone && <div className="grid gap-2 sm:grid-cols-2">
            {(() => { const st = scheduleStatus(a); return ([['schedule', st.label, st.warn], ['blocks', 'Block slots', false]] as const).map(([what, label, warn]) => (
              <button key={what} onClick={() => setManage({ area: a, what })} className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition hover:border-brand ${warn ? 'border-warn/60 text-warn' : 'border-line'}`}>{label}{warn && ' · setup needed'}</button>)); })()}</div>}
          </div>
        </Card>); })}</div>}
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title={confirmDel ? `Delete ${confirmDel.name}?` : ''}>
        {confirmDel && (<div className="space-y-4 text-sm">
          <div className="flex items-start gap-3 rounded-2xl bg-danger/10 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger/15 text-lg text-danger" aria-hidden="true">🗑</span>
            <ul className="space-y-1.5">
              <li><b>Closed for booking straight away.</b> Customers can't see or book it, and no walk-in bookings can be added.</li>
              <li><b>PlaynX approves the deletion.</b> Until then you can cancel the request and it comes back as it was.</li>
              <li><b>Its bookings are kept.</b> The booking history stays in your records.</li>
            </ul>
          </div>
          {delUpcomingQ.isLoading ? <p className="text-muted">Checking upcoming bookings…</p> : delUpcoming.length === 0 ? <p className="text-muted">There are no upcoming bookings in this playing area.</p> : (
            <div className="space-y-2"><p className="font-semibold text-warn">{delUpcoming.length === 1 ? 'There is 1 upcoming booking. It is not cancelled: please honour it or cancel it yourself.' : `There are ${delUpcoming.length} upcoming bookings. They are not cancelled: please honour them or cancel them yourself.`}</p>
              <ul className="max-h-40 divide-y divide-line overflow-auto rounded-xl border border-line">{delUpcoming.map((x) => <li key={x.id} className="flex justify-between gap-2 px-3 py-2"><span><b>{x.customer_name ?? 'Customer'}</b> · {x.reference}</span><span className="text-muted">{fmtRange(x.starts_at, x.ends_at)}</span></li>)}</ul></div>)}
          <Textarea label="Reason (optional, PlaynX sees this)" rows={2} maxLength={300} value={delReason} onChange={(e) => setDelReason(e.target.value)} placeholder="e.g. Turning this court into parking" />
          {remove.isError && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-danger">{apiError(remove.error)}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ id: confirmDel.id, reason: delReason.trim() || undefined })}>Send delete request</Button></div>
        </div>)}
      </Modal>
      <Modal open={!!confirmOff} onClose={() => setConfirmOff(null)} title={confirmOff ? `Deactivate ${confirmOff.name}?` : ''}>
        {confirmOff && (<div className="space-y-4 text-sm">
          <p>Customers will <b>no longer see or book</b> {confirmOff.name}. It stays in your list and you can activate it again at any time.</p>
          {upcomingQ.isLoading ? <p className="text-muted">Checking upcoming bookings…</p> : upcoming.length === 0 ? <p className="text-muted">There are no upcoming bookings in this playing area.</p> : (
            <div className="space-y-2"><p className="font-semibold text-warn">{upcoming.length === 1 ? `${confirmOff.name} has an upcoming booking` : `${confirmOff.name} has ${upcoming.length} upcoming bookings`}</p>
              <ul className="max-h-48 divide-y divide-line overflow-auto rounded-xl border border-line">{upcoming.map((x) => <li key={x.id} className="flex justify-between gap-2 px-3 py-2"><span><b>{x.customer_name ?? 'Customer'}</b> · {x.reference}</span><span className="text-muted">{fmtRange(x.starts_at, x.ends_at)}</span></li>)}</ul>
              <p className="text-muted">Choose what happens to the bookings already made. Cancelling refunds the customers in full.</p></div>)}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setConfirmOff(null)}>Cancel</Button>
            {upcoming.length > 0 ? (<>
              <Button type="button" variant="ghost" loading={toggle.isPending} onClick={() => toggle.mutate({ ...confirmOff, __how: 'keep' }, { onSettled: () => setConfirmOff(null) })}>Leave the bookings, close it</Button>
              <Button type="button" variant="danger" loading={toggle.isPending} onClick={() => toggle.mutate({ ...confirmOff, __how: 'cancel' }, { onSettled: () => setConfirmOff(null) })}>Cancel the bookings and close it</Button></>)
              : <Button type="button" variant="danger" disabled={upcomingQ.isLoading} loading={toggle.isPending} onClick={() => toggle.mutate(confirmOff, { onSettled: () => setConfirmOff(null) })}>Deactivate</Button>}</div>
        </div>)}
      </Modal>
      {edit && <AreaModal venue={venue} area={edit === 'new' ? null : edit} sports={sports.data?.sports ?? []} onClose={() => setEdit(null)} onSaved={refresh} />}
      {manage?.what === 'schedule' && <ScheduleModal area={manage.area} sports={sports.data?.sports ?? []} onClose={() => setManage(null)} onSaved={refresh} />}
      {manage?.what === 'blocks' && <BlocksModal area={manage.area} onClose={() => setManage(null)} />}
    </div>
  );
}

/** "See the price a booking would get, using the saved pricing." */
function PriceCheck({ area, sports }: { area: any; sports: { id: number; name: string }[] }) {
  const [c, setC] = useState({ sport: String(sports[0]?.id ?? ''), date: '', time: '10:00', duration: String(area.min_duration_minutes ?? 60) });
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async () => {
    setErr(''); setRes(null);
    if (!c.date) return setErr('Pick a date'); const sport = c.sport || String(sports[0]?.id ?? ''); if (!sport) return setErr('Choose a sport for this area first');
    setBusy(true);
    try { setRes(await post(`/owner/areas/${area.id}/price-check`, { sportId: +sport, startsAt: `${c.date}T${c.time}:00+05:30`, durationMinutes: +c.duration })); } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-semibold">Check a price</legend>
      <p className="mb-2 text-xs text-muted">See the price a booking would get, using the saved pricing.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Select label="Sport" value={c.sport} onChange={(e) => setC({ ...c, sport: e.target.value })}>{sports.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        <Input label="Date" type="date" value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} />
        <Input label="From" type="time" value={c.time} onChange={(e) => setC({ ...c, time: e.target.value })} />
        <Select label="Duration" value={c.duration} onChange={(e) => setC({ ...c, duration: e.target.value })}>{DURATIONS.filter((d) => d >= area.min_duration_minutes && d <= area.max_duration_minutes && d % area.slot_minutes === 0).map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}</Select></div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" variant="ghost" loading={busy} onClick={run}>Check price</Button>
        {res && <p role="status" className="text-sm"><b className="text-lg">{money(res.price)}</b> for {durationLabel(res.durationMinutes)} ({money(res.perHour)} per hour)</p>}
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}</div>
    </fieldset>
  );
}

export function AreaModal({ venue, area, sports: allSports, onClose, onSaved }: { venue: any; area: any | null; sports: { id: number; name: string }[]; onClose(): void; onSaved(): void }) {
  // an area can only offer the sports its venue offers (older venues that never chose any can pick from all)
  const sports = venue.sportIds?.length ? allSports.filter((x) => venue.sportIds.includes(x.id)) : allSports;
  const { toast } = useToast();
  const [defaultPrice, setDefaultPrice] = useState(''); // asked only when the area is created
  const [f, setF] = useState({ name: area?.name ?? '', surface: area?.surface ?? '', capacity: area?.capacity ?? '', slotMinutes: area?.slot_minutes ?? 60, min: area?.min_duration_minutes ?? 60, max: area?.max_duration_minutes ?? 180, environment: area?.environment ?? '', roofType: area?.roof_type === 'closed' || area?.roof_type === 'covered' || area?.roof_type === 'retractable' ? 'closed' : area?.roof_type ?? '', turfShape: area?.turf_shape ?? '', advanceDays: area?.advance_booking_days ?? '', instant: area?.instant_booking !== false });
  const [sel, setSel] = useState<number[]>(area?.sport_ids ?? []); const [err, setErr] = useState('');
  // Live photos only: each one is taken with the in-app camera together with the phone's live location. There is no file picker.
  const [shots, setShots] = useState<LiveShot[]>([]); const [camOpen, setCamOpen] = useState(false); const [photoErr, setPhotoErr] = useState('');
  const [files, setFiles] = useState<File[]>([]); // photos chosen from the device (no live location needed)
  const filePreviews = useMemo(() => files.map((file) => ({ file, url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '' })), [files]);
  useEffect(() => () => filePreviews.forEach((x) => x.url && URL.revokeObjectURL?.(x.url)), [filePreviews]);
  const savedPhotos = ((venue.images ?? []) as any[]).filter((i) => area && i.area_id === area.id && i.kind === 'image' && !i.delete_requested);
  const hasLocated = savedPhotos.some((i) => i.geo_lat != null); // the area already has a live photo with a location
  useEffect(() => () => shots.forEach((x) => { if (x.previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(x.previewUrl); }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: f.name, surface: f.surface || undefined, capacity: f.capacity ? +f.capacity : undefined, slotMinutes: +f.slotMinutes, minDurationMinutes: +f.min, maxDurationMinutes: +f.max, sportIds: sel, ...(f.environment ? { environment: f.environment } : {}), ...(f.environment === 'indoor' && f.roofType ? { roofType: f.roofType } : {}), ...(f.turfShape ? { turfShape: f.turfShape } : {}), ...(f.advanceDays ? { advanceBookingDays: +f.advanceDays } : {}), instantBooking: f.instant };
      const r: any = area ? await put(`/owner/areas/${area.id}`, body) : await post(`/owner/venues/${venue.id}/areas`, { ...body, defaultPrice: Number(defaultPrice) });
      const areaId: string = area?.id ?? r.area.id;
      const failed: string[] = []; // the area itself is saved first; a photo that fails is reported, not lost silently
      for (const x of shots) { // the server checks each proof against the exact photo, so nothing but these live photos can be stored
        try { const fd = new FormData(); fd.append('areaId', areaId); fd.append('proof', x.proof); fd.append('file', x.file); await api.post(`/owner/venues/${venue.id}/media`, fd, { timeout: 120000 }); }
        catch (e) { failed.push(`${x.file.name} (${apiError(e)})`); }
      }
      for (const file of files) { // an uploaded photo: just the file, no live location
        try { const fd = new FormData(); fd.append('areaId', areaId); fd.append('file', file); await api.post(`/owner/venues/${venue.id}/media`, fd, { timeout: 120000 }); }
        catch (e) { failed.push(`${file.name} (${apiError(e)})`); }
      }
      return failed;
    },
    onSuccess: (failed: string[]) => { onSaved(); onClose(); toast(failed.length ? `Area saved, but ${failed.length} photo${failed.length === 1 ? '' : 's'} could not be added: ${failed.join('; ')}. You can add them by editing the area.` : shots.length ? `Area saved with ${shots.length} live photo${shots.length === 1 ? '' : 's'}` : 'Area saved', failed.length ? 'error' : undefined); },
    onError: (e) => setErr(apiError(e)),
  });
  const removeSaved = useMutation({ mutationFn: (id: string) => del(`/owner/media/${id}`), onSuccess: () => { onSaved(); toast('Photo removed'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <Modal open onClose={onClose} title={area ? `Edit ${area.name}` : 'Add playing area'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErr(''); if (!f.name.trim()) return setErr('Enter the playing area name.'); if (!sel.length) return setErr('Choose at least one sport.'); if (!area && !(Number(defaultPrice) > 0 && Number(defaultPrice) <= 100000)) return setErr('Enter the default price (₹ per hour, more than 0).'); if (f.capacity !== '' && !(Number.isInteger(+f.capacity) && +f.capacity >= 1 && +f.capacity <= 100)) return setErr('Enter a number of players between 1 and 100.'); if (!f.environment) return setErr('Please choose Indoor or Outdoor.'); if (f.environment === 'indoor' && !f.roofType) return setErr('Please select a roof type.'); if (!f.turfShape) return setErr(f.environment === 'outdoor' ? 'Please select a ground shape.' : 'Please select a shape.'); if (!area && shots.length === 0) return setErr('Take a live photo of the playing area at the turf. It is required: it records where the photo was taken.'); if (savedPhotos.length + shots.length + files.length === 0) return setErr('Add at least one photo of this playing area: take a live photo or upload one. It is required.'); save.mutate(); }}>
        <VenueSummary venue={venue} compact /><p className="-mt-2 text-xs text-muted">{area ? 'This area belongs to the venue above.' : 'The new playing area will be created under the venue above.'}</p>
        <Input mandatory label="Playing area name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Enter area name (e.g., Turf 1, Court 2)" />
        {!area && <Input mandatory label="Default price (₹ per hour)" type="number" min={1} inputMode="decimal" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} placeholder="For example 1000" hint="Every slot costs this unless you set a different price for a particular slot later in Pricing." />}
        <fieldset><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted after:ml-1 after:font-bold after:text-danger after:content-['*']">Sports played here</legend>
          <div className="flex flex-wrap gap-2">{sports.map((s) => { const on = sel.includes(s.id); return <button type="button" key={s.id} aria-pressed={on} onClick={() => setSel(on ? sel.filter((i) => i !== s.id) : [...sel, s.id])} className={`chip !px-3 !py-1.5 text-sm ${on ? '!border-brand bg-brand/15 text-ink' : ''}`}>{on ? '✓ ' : ''}{s.name}</button>; })}</div></fieldset>
        <p className="rounded-xl border border-sky-400/40 bg-sky-500/10 p-3 text-xs">The selected sports apply only to this playing area. Other playing areas at the same venue can have different sports from the venue's available sports.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Input label="Surface (optional)" value={f.surface} onChange={(e) => setF({ ...f, surface: e.target.value })} placeholder="Enter surface (e.g., Artificial grass)" hint="Letters, numbers and & . , - ( ) / are allowed." /><Input label="Capacity (players) (optional)" type="number" min={1} max={100} inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} placeholder="Enter maximum players (1-100)" /></div>
        <Select mandatory label="Indoor or Outdoor" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value, roofType: e.target.value === 'outdoor' ? '' : f.roofType })}><option value="" disabled>Select Indoor or Outdoor</option><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option></Select>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f.environment !== 'outdoor' && <Select mandatory label="Roof Type" value={f.roofType} onChange={(e) => setF({ ...f, roofType: e.target.value })}><option value="" disabled>Select roof type</option><option value="open">Open</option><option value="closed">Closed</option></Select>}
          <Select mandatory label={f.environment === 'outdoor' ? 'Ground Shape' : 'Shape'} value={f.turfShape} onChange={(e) => setF({ ...f, turfShape: e.target.value })}><option value="" disabled>{f.environment === 'outdoor' ? 'Select ground shape' : 'Select shape'}</option><option value="round">Round</option><option value="rectangle">Rectangle</option></Select></div>
        <h3 className="pt-1 text-lg font-bold">Slot settings</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Slot duration" value={f.slotMinutes} onChange={(e) => { const slot = +e.target.value; const fit = (v: number) => (v % slot === 0 && v >= slot ? v : Math.max(slot, Math.ceil(v / slot) * slot)); setF({ ...f, slotMinutes: slot, min: Math.min(300, fit(+f.min)), max: Math.min(300, Math.max(fit(+f.max), fit(+f.min))) }); }} hint="Bookings are made in blocks of this length, starting from opening time.">{[30, 60, ...(+f.slotMinutes > 60 ? [+f.slotMinutes] : [])].map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}</Select>
          <Select label="Minimum booking" value={f.min} onChange={(e) => setF({ ...f, min: +e.target.value, max: Math.max(+f.max, +e.target.value) })}>{DURATIONS.filter((d) => d >= +f.slotMinutes && d % +f.slotMinutes === 0).map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}</Select>
          <Select label="Maximum booking" value={f.max} onChange={(e) => setF({ ...f, max: +e.target.value })}>{DURATIONS.filter((d) => d >= +f.min && d % +f.slotMinutes === 0).map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}</Select>
          <Input label="Advance booking limit (days) (optional)" type="number" min={1} max={365} inputMode="numeric" value={f.advanceDays} onChange={(e) => setF({ ...f, advanceDays: e.target.value })} placeholder="Enter days (1-365), default 60" hint="How far ahead people can book. Leave empty for 60 days." /></div>
        <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand" checked={f.instant} onChange={(e) => setF({ ...f, instant: e.target.checked })} />
          <span><b>Instant booking</b><span className="block text-xs text-muted">{f.instant ? 'Customers book and pay online straight away.' : 'Customers cannot pay online for this area. They are asked to contact the venue, and you book the slot for them under Add offline booking.'}</span></span></label>
        {area && <PriceCheck area={area} sports={sports.filter((x) => sel.includes(x.id))} />}
        <fieldset className="space-y-2" aria-describedby="live-help"><legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted after:ml-1 after:font-bold after:text-danger after:content-['*']">Photos</legend>
          <p id="live-help" className="text-xs text-muted">Take a <b>live photo at the turf</b> with the camera in this app (it records your phone's location): it is required for a new playing area. You can add more photos from your device. Up to 10. JPG, PNG or WebP, up to 8 MB each.</p>
          {(savedPhotos.length > 0 || shots.length > 0 || files.length > 0) && (
            <ul className="space-y-2" aria-label="Area photos">
              {savedPhotos.map((i) => (
                <li key={i.id} className="relative flex gap-3 rounded-xl border border-line p-2"><img src={i.url} alt="Saved area photo" className="h-16 w-24 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1 pr-5 text-xs">
                    {i.geo_lat != null ? (<>
                      <p><span className="font-semibold text-ok">📍 {i.geo_distance_m} m</span> <span className="text-muted">from your venue</span>{i.is_pending && <span className="ml-2 rounded bg-warn/90 px-1 text-[10px] font-bold text-black">Pending approval</span>}</p>
                      <p className="font-mono">{Number(i.geo_lat).toFixed(6)}, {Number(i.geo_lng).toFixed(6)}</p>
                      <p className="text-muted">{i.geo_address ?? 'Address not available'}</p></>) : <p className="text-muted">No location recorded for this older photo.</p>}</div>
                  <button type="button" aria-label="Remove saved photo" disabled={removeSaved.isPending} onClick={() => removeSaved.mutate(i.id)} className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-danger text-xs font-bold text-white">×</button></li>))}
              {shots.map((x, n) => (
                <li key={x.file.name} className="relative flex gap-3 rounded-xl border border-line p-2">{x.previewUrl ? <img src={x.previewUrl} alt={`New live photo ${n + 1}`} className="h-16 w-24 shrink-0 rounded-lg object-cover" /> : <span className="grid h-16 w-24 shrink-0 place-items-center rounded-lg bg-surface2 text-xs">Photo {n + 1}</span>}
                  <div className="min-w-0 flex-1 pr-5 text-xs">
                    <p><span className="font-semibold text-ok">📍 {x.distanceM} m</span> <span className="text-muted">from your venue</span></p>
                    <p className="font-mono">{x.lat.toFixed(6)}, {x.lng.toFixed(6)}</p>
                    <p className="text-muted">{x.address ?? 'Address not available'}</p></div>
                  <button type="button" aria-label={`Remove new live photo ${n + 1}`} onClick={() => setShots(shots.filter((_, j) => j !== n))} className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-danger text-xs font-bold text-white">×</button></li>))}
              {filePreviews.map((x, n) => (
                <li key={`${x.file.name}-${n}`} className="relative flex items-center gap-3 rounded-xl border border-line p-2">{x.url ? <img src={x.url} alt={`New photo ${n + 1}`} className="h-16 w-24 shrink-0 rounded-lg object-cover" /> : <span className="grid h-16 w-24 shrink-0 place-items-center rounded-lg bg-surface2 text-xs">Photo</span>}
                  <p className="min-w-0 flex-1 truncate pr-5 text-xs">{x.file.name}<span className="block text-muted">Uploaded from your device</span></p>
                  <button type="button" aria-label={`Remove photo ${n + 1}`} onClick={() => setFiles(files.filter((_, j) => j !== n))} className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-danger text-xs font-bold text-white">×</button></li>))}
            </ul>)}
          {(hasLocated || shots.length > 0) && <p className="text-xs text-ok">✓ {shots.length + savedPhotos.length} live photo{shots.length + savedPhotos.length === 1 ? '' : 's'} with a verified location. {venue.status === 'approved' || venue.status === 'ready' ? 'New photos on a live venue are shown to customers after PlaynX approves them.' : ''}</p>}
          <Button type="button" variant="ghost" className="!py-1.5 text-sm" disabled={savedPhotos.length + shots.length + files.length >= 10} onClick={() => { setPhotoErr(''); setCamOpen(true); }}>📷 Take live photo</Button>
          <label className={`btn-ghost cursor-pointer !py-1.5 text-sm ${savedPhotos.length + shots.length + files.length >= 10 ? 'pointer-events-none opacity-50' : ''}`}>⬆ Upload photos<input type="file" hidden multiple accept="image/jpeg,image/png,image/webp" aria-label="Upload area photos" onChange={(e) => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; setPhotoErr(''); const bad = picked.find((x) => !['image/jpeg', 'image/png', 'image/webp'].includes(x.type) || x.size > 8 * 1024 * 1024); if (bad) return setPhotoErr(`${bad.name}: use a JPG, PNG or WebP up to 8 MB.`); setFiles((all) => [...all, ...picked].slice(0, Math.max(0, 10 - savedPhotos.length - shots.length))); }} /></label>
          {photoErr && <p role="alert" className="text-xs text-danger">{photoErr}</p>}
        </fieldset>
        {camOpen && <LiveCamera venueId={venue.id} onClose={() => setCamOpen(false)} onShot={(x) => { setShots((all) => [...all, x]); setCamOpen(false); }} />}
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

/** What the "Hours & pricing" button says: how many days are open and whether any open slot still has no price. */
export function scheduleStatus(a: any): { label: string; warn: boolean } {
  const step = a.slot_minutes ?? 60;
  const days: Day[] = (a.availability ?? []).map((d: any) => ({ dayOfWeek: d.dayOfWeek, openTime: d.openTime, closeTime: d.closeTime, isClosed: d.isClosed }));
  const open = days.filter((d) => !d.isClosed).length;
  if (!days.length) return { label: 'Hours & pricing (not set)', warn: true };
  const un = unpricedCount(buildPrices(a.pricing ?? [], days, ['all'], step), days, step, !!defaultRule(a.pricing ?? []));
  return { label: `Hours & pricing (${open} day${open === 1 ? '' : 's'} open${un ? `, ${un} slot${un === 1 ? '' : 's'} unpriced` : ''})`, warn: un > 0 };
}

function BlocksModal({ area, onClose }: { area: any; onClose(): void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const q = useQuery({ queryKey: ['blocks', area.id], queryFn: () => get<{ blocks: any[] }>(`/owner/areas/${area.id}/blocks`) });
  const [f, setF] = useState({ start: '', end: '', reason: '' });
  const add = useMutation({ mutationFn: () => post(`/owner/areas/${area.id}/blocks`, { startsAt: new Date(f.start).toISOString(), endsAt: new Date(f.end).toISOString(), reason: f.reason || undefined }),
    onSuccess: () => { setF({ start: '', end: '', reason: '' }); qc.invalidateQueries({ queryKey: ['blocks', area.id] }); toast('Slot blocked'); },
    onError: (e: any) => toast(e?.response?.data?.error?.code === 'slot_unavailable' ? 'That time overlaps an existing booking or block' : apiError(e), 'error') });
  const rm = useMutation({ mutationFn: (id: string) => del(`/owner/blocks/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks', area.id] }); toast('Block removed'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <Modal open onClose={onClose} title={`Block slots · ${area.name}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (new Date(f.end) <= new Date(f.start)) return toast('End must be after start', 'error'); add.mutate(); }}>
        <p className="text-xs text-muted">Times are in your device's timezone. Blocked time can't be booked by customers.</p>
        <div className="grid grid-cols-2 gap-3"><Input label="From" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /><Input label="To" type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></div>
        <Input label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Maintenance, private event…" /><Button type="submit" loading={add.isPending}>Block this time</Button></form>
      <h3 className="mb-2 mt-5 text-xl font-bold">Upcoming blocks</h3>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorBox error={q.error} /> : q.data!.blocks.length === 0 ? <p className="text-sm text-muted">None.</p> : (
        <ul className="divide-y divide-line">{q.data!.blocks.map((b) => <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span>{fmtDateTime(b.starts_at)} → {fmtDateTime(b.ends_at)}{b.reason && <span className="text-muted"> · {b.reason}</span>}</span><Button variant="danger" className="!py-1" onClick={() => rm.mutate(b.id)}>Unblock</Button></li>)}</ul>)}
    </Modal>
  );
}

export { money };
