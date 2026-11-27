import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiError, get, patch, post } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Empty, ErrorBox, Loading, Modal, PageHeader, QueryBoundary, Select, Table, Textarea } from '../../components/ui';
import { FileLink } from '../../components/FileLink';
import { fmtDateTime, titleCase } from '../../lib/utils';

const STATUS: Record<string, string> = { incomplete: 'Registration incomplete', submitted: 'Submitted', under_review: 'Under review', info_required: 'Additional info required', resubmission_required: 'Resubmission required', approved: 'Approved', rejected: 'Rejected' };
const tone = (s: string) => (s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : 'pending');
const FIELDS: [string, string][] = [['businessType', 'Business type'], ['businessName', 'Business name'], ['pan', 'PAN'], ['address', 'Address'], ['representativeName', 'Authorized person'], ['registrationNumber', 'CIN / LLPIN'], ['identity', 'Identity type / consent']];
const EVENT: Record<string, string> = { submitted: 'Submitted', resubmitted: 'Resubmitted', review_started: 'Review started', info_requested: 'Information requested', resubmission_requested: 'Resubmission requested', approved: 'Approved', rejected: 'Rejected', document_reviewed: 'Document reviewed', document_replaced: 'Document replaced', section_verified: 'Section verified', section_unverified: 'Verification withdrawn' };

export function AdminApplications() {
  const [sp] = useSearchParams();
  const [status, setStatus] = useState('all'); const [sel, setSel] = useState<string | null>(sp.get('owner'));
  const q = useQuery({ queryKey: ['admin-applications', status], queryFn: () => get<{ applications: any[] }>('/admin/applications', { status }) });
  return (
    <div><PageHeader title="Owner applications" subtitle="Review business details, identity documents and first venues" actions={
      <div className="w-56"><Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All</option><option value="active_review">Needs attention</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>} />
      <QueryBoundary q={q} empty={(d) => d.applications.length === 0 && <Empty icon="🗂️" title="No applications here" hint="New owner applications appear when owners submit their registration." />}>
        {(d) => <Table rows={d.applications.map((a) => ({ ...a, id: a.owner_id }))} onRow={(a: any) => setSel(a.owner_id)} columns={[
          { key: 'application_ref', header: 'Reference', render: (a: any) => <b>{a.application_ref ?? '—'}</b> },
          { key: 'full_name', header: 'Owner', render: (a: any) => <div><b>{a.full_name}</b><div className="text-xs text-muted">{a.email}{a.phone ? ` · ${a.phone}` : ''}</div></div> },
          { key: 'business_name', header: 'Business', render: (a: any) => <div>{a.business_name}<div className="text-xs text-muted">{a.business_type ? titleCase(a.business_type) : 'Type not set'}</div></div> },
          { key: 'venues', header: 'Venues' }, { key: 'pending_documents', header: 'Docs to review' },
          { key: 'submitted_at', header: 'Submitted', render: (a: any) => (a.submitted_at ? fmtDateTime(a.submitted_at) : '—') },
          { key: 'application_status', header: 'Status', render: (a: any) => <Badge status={tone(a.application_status)}>{STATUS[a.application_status]}</Badge> }]} />}
      </QueryBoundary>
      {sel && <ReviewModal ownerId={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function ReviewModal({ ownerId, onClose }: { ownerId: string; onClose(): void }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-application', ownerId], queryFn: () => get<any>(`/admin/applications/${ownerId}`) });
  const [note, setNote] = useState(''); const [flag, setFlag] = useState<Record<string, string>>({}); const [docNote, setDocNote] = useState<Record<string, string>>({}); const [docNeed, setDocNeed] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-application', ownerId] }); qc.invalidateQueries({ queryKey: ['admin-applications'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  const decide = useMutation({
    mutationFn: (action: string) => post(`/admin/applications/${ownerId}/decision`, { action, note: note || undefined, items: Object.entries(flag).map(([k, reason]) => ({ type: k.startsWith('doc:') ? 'document' : 'field', key: k.replace(/^(doc|field):/, ''), reason: reason || undefined })) }),
    onSuccess: (_r, action) => { refresh(); setNote(''); setFlag({}); toast(`Application ${action.replace(/_/g, ' ')} recorded`); }, onError: (e) => toast(apiError(e), 'error'),
  });
  const review = useMutation({ mutationFn: ({ id, status, note }: { id: string; status: string; note?: string }) => patch(`/admin/owner-documents/${id}`, { status, note }), onSuccess: refresh, onError: (e) => toast(apiError(e), 'error') });
  const section = useMutation({
    mutationFn: ({ section, verified }: { section: string; verified: boolean }) => post(`/admin/applications/${ownerId}/sections`, { section, verified }),
    onSuccess: (_r, v) => { refresh(); toast(`${v.section === 'identity' ? 'Identity' : 'Business'} ${v.verified ? 'verified' : 'verification withdrawn'}`); }, onError: (e) => toast(apiError(e), 'error'),
  });
  const toggle = (k: string) => setFlag((f) => { const n = { ...f }; if (k in n) delete n[k]; else n[k] = ''; return n; });

  return (
    <Modal open onClose={onClose} title={q.data ? `${q.data.owner.business_name} · ${q.data.owner.application_ref ?? 'draft'}` : 'Application'} wide>
      {q.isLoading ? <Loading /> : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : (() => {
        const { owner: o, documents, venues, events } = q.data;
        const live = documents.filter((x: any) => x.status !== 'replaced');
        const canDecide = ['submitted', 'under_review'].includes(o.application_status);
        const canSendBack = ['submitted', 'under_review', 'info_required', 'resubmission_required', 'rejected'].includes(o.application_status);
        return (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge status={tone(o.application_status)}>{STATUS[o.application_status]}</Badge><span className="text-muted">{o.full_name} · {o.email} {o.email_verified ? '✓' : '(unverified)'} · {o.phone ?? 'no mobile'} {o.phone_verified ? '✓' : ''}</span></div>
            <section><h3 className="mb-1 text-xl font-bold">Business</h3>
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">{([['Type', o.business_type ? titleCase(o.business_type) : '—'], ['Name', o.business_name], ['PAN', o.pan], ['CIN / LLPIN', o.registration_number], ['GSTIN', o.gstin], ['Authorized person', `${o.representative_name ?? '—'}${o.designation ? `, ${o.designation}` : ''}`], ['Address', o.address], ['Identity type', o.identity_type ? titleCase(o.identity_type) : '—'], ['Identity consent', o.identity_consent_at ? fmtDateTime(o.identity_consent_at) : 'Not given'], ['Terms accepted', o.terms_accepted_at ? `${fmtDateTime(o.terms_accepted_at)} (v${o.terms_version})` : '—']] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line/50 py-1"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v || '—'}</dd></div>)}</dl></section>
            <section><h3 className="mb-1 text-xl font-bold">Documents</h3>
              {live.length === 0 ? <p className="text-muted">None uploaded.</p> : <ul className="divide-y divide-line">{live.map((x: any) => (
                <li key={x.id} className="space-y-2 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><FileLink path={`/admin/owner-documents/${x.id}/file`}>{x.label}</FileLink>
                  <span className="flex items-center gap-2"><Badge status={x.status === 'approved' ? 'approved' : x.status === 'rejected' ? 'rejected' : 'pending'}>{titleCase(x.status)}</Badge>
                    {x.status !== 'approved' && <Button className="!py-1" loading={review.isPending && review.variables?.id === x.id && review.variables?.status === 'approved'} onClick={() => review.mutate({ id: x.id, status: 'approved' })}>Approve</Button>}</span></div>
                  {x.status !== 'rejected' && <div className="flex gap-2"><input className="field !py-1.5" aria-label={`Rejection reason for ${x.label}`} placeholder="Reason to reject (shown to owner)" value={docNote[x.id] ?? ''} aria-invalid={docNeed === x.id ? true : undefined} onChange={(e) => { setDocNote({ ...docNote, [x.id]: e.target.value }); if (docNeed === x.id) setDocNeed(null); }} />
                    <Button variant="danger" className="!py-1" loading={review.isPending && review.variables?.id === x.id && review.variables?.status === 'rejected'} onClick={() => { const n = (docNote[x.id] ?? '').trim(); if (!n) return setDocNeed(x.id); setDocNeed(null); review.mutate({ id: x.id, status: 'rejected', note: n }); }}>Reject</Button></div>}
                  {docNeed === x.id && <p role="alert" className="text-xs text-danger">Enter a reason so the owner knows what to fix.</p>}
                  {x.note && <p className="text-xs text-danger">Reason: {x.note}</p>}</li>))}</ul>}</section>
            {['submitted', 'under_review', 'info_required', 'resubmission_required', 'approved'].includes(o.application_status) && (
              <section className="rounded-xl border border-line p-3" aria-label="Verification status">
                <h3 className="mb-1 text-xl font-bold">Verification status</h3>
                <p className="mb-2 text-xs text-muted">Approve the documents above, then mark each section verified. The owner's status cards change as soon as you do. Approving the whole application is a separate last step.</p>
                {live.length > 0 && live.every((x: any) => x.status === 'approved') && !(o.business_verified_at && o.identity_verified_at) && <p role="status" className="mb-2 rounded-lg bg-brand/15 p-2 text-xs">All documents are approved. Mark the sections verified below, then approve the application.</p>}
                <div className="grid gap-2 sm:grid-cols-2">{([['business', 'Business details & documents', o.business_verified_at], ['identity', 'Identity & address documents', o.identity_verified_at]] as [string, string, string | null][]).map(([k, label, at]) => (
                  <div key={k} className="flex items-center justify-between gap-2 rounded-lg bg-surface2 p-3"><div><div className="font-semibold">{label}</div><div className="text-xs text-muted">{at ? `Verified ${fmtDateTime(at)}` : 'Not verified yet'}</div></div>
                    <Button variant={at ? 'ghost' : 'primary'} className="!py-1.5" loading={section.isPending && section.variables?.section === k} onClick={() => section.mutate({ section: k, verified: !at })} aria-label={`${at ? 'Withdraw' : 'Mark'} ${k} verification`}>{at ? 'Withdraw' : 'Mark verified'}</Button></div>))}</div>
              </section>)}
            <section><h3 className="mb-1 text-xl font-bold">Venues</h3>{venues.length === 0 ? <p className="text-muted">None.</p> : <ul className="divide-y divide-line">{venues.map((v: any) => <li key={v.id} className="flex justify-between py-1.5"><span>{v.name} <span className="text-muted">· {v.city} · {v.media} media, {v.documents} docs</span></span><Badge status={v.status} /></li>)}</ul>}<p className="mt-1 text-xs text-muted">Venues are approved separately under Venue approvals.</p></section>
            {canSendBack && (
              <section className="rounded-xl border border-line p-3"><h3 className="mb-1 text-xl font-bold">Decision</h3>
                <p className="mb-2 text-xs text-muted">Tick anything the owner must fix and say why. They get a notification and email with these exact reasons.</p>
                <div className="mb-2 grid gap-1 sm:grid-cols-2">{[...FIELDS.map(([k, l]) => [`field:${k}`, l] as [string, string]), ...live.map((x: any) => [`doc:${x.doc_type}`, x.label] as [string, string])].map(([k, l]) => (
                  <div key={k}><label className="flex items-center gap-2"><input type="checkbox" checked={k in flag} onChange={() => toggle(k)} />{l}</label>{k in flag && <input className="field mt-1 !py-1" aria-label={`Reason for ${l}`} placeholder="What is wrong?" value={flag[k]} onChange={(e) => setFlag({ ...flag, [k]: e.target.value })} />}</div>))}</div>
                <Textarea label="Message to the owner" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {o.application_status === 'submitted' && <Button variant="ghost" loading={decide.isPending && decide.variables === 'start_review'} onClick={() => decide.mutate('start_review')}>Start review</Button>}
                  <Button variant="ghost" loading={decide.isPending && decide.variables === 'request_info'} onClick={() => decide.mutate('request_info')}>Request information</Button>
                  <Button variant="ghost" loading={decide.isPending && decide.variables === 'request_resubmission'} onClick={() => decide.mutate('request_resubmission')}>Request resubmission</Button>
                  {canDecide && <Button variant="danger" disabled={!note.trim()} loading={decide.isPending && decide.variables === 'reject'} onClick={() => decide.mutate('reject')}>Reject</Button>}
                  {canDecide && <Button loading={decide.isPending && decide.variables === 'approve'} onClick={() => decide.mutate('approve')}>Approve application</Button>}</div></section>)}
            <section><h3 className="mb-1 text-xl font-bold">Review history</h3><ol className="space-y-2 border-l border-line pl-4">{events.length === 0 ? <li className="text-muted">No activity.</li> : events.map((e: any, i: number) => (
              <li key={i}><b>{EVENT[e.kind] ?? e.kind}</b>{e.actor && <span className="text-muted"> · {e.actor}</span>}{e.note && <div className="text-muted">{e.note}</div>}<div className="text-xs text-muted">{fmtDateTime(e.created_at)}</div></li>))}</ol></section>
          </div>);
      })()}
    </Modal>
  );
}


/** Changes an approved owner made to business or bank details. The old details stay live until an admin approves here. */
export function AdminProfileChanges() {
  const { toast } = useToast(); const qc = useQueryClient();
  const [show, setShow] = useState<'pending' | 'all'>('all');
  const [reason, setReason] = useState<Record<string, string>>({}); const [need, setNeed] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-profile-changes', show], queryFn: () => get<{ changes: any[] }>('/admin/profile-changes', { status: show }) });
  const done = () => { qc.invalidateQueries({ queryKey: ['admin-profile-changes'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); };
  const approve = useMutation({ mutationFn: (id: string) => post(`/admin/profile-changes/${id}/approve`), onSuccess: () => { done(); toast('Approved. The owner\'s details are updated.'); }, onError: (e) => toast(apiError(e), 'error') });
  const reject = useMutation({ mutationFn: (id: string) => post(`/admin/profile-changes/${id}/reject`, { note: reason[id] }), onSuccess: () => { done(); setNeed(null); toast('Rejected. The owner was told why.'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div><PageHeader title="Profile changes" subtitle="Business and bank detail edits from approved owners. The old details stay live until you approve." actions={
      <div className="w-48"><Select label="Show" value={show} onChange={(e) => setShow(e.target.value as 'pending' | 'all')}><option value="all">All</option><option value="pending">Waiting for approval</option></Select></div>} />
      <QueryBoundary q={q} empty={(d) => d.changes.length === 0 && <Empty icon="✏️" title="No profile changes waiting" hint="When an approved owner edits their business or bank details, the request shows up here." />}>
        {(d) => <div className="space-y-4">{d.changes.map((c) => (
          <section key={c.id} className="card space-y-3 p-5" aria-label={`Profile change from ${c.full_name}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-2xl font-bold">{c.businessName ?? c.full_name}</h2><p className="text-xs text-muted">{c.full_name} · {c.email}{c.phone ? ` · ${c.phone}` : ''} · requested {fmtDateTime(c.requested_at)}</p></div>
              <Badge status={c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending'}>{titleCase(c.status)}</Badge></div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-1 pr-3">Detail</th><th className="py-1 pr-3">Current (live)</th><th className="py-1">Requested</th></tr></thead>
              <tbody>{c.changes.map((x: any) => <tr key={x.field} className="border-t border-line"><td className="py-1.5 pr-3 font-semibold">{x.label}</td><td className="py-1.5 pr-3 text-muted">{x.current ?? 'Not set'}</td><td className="py-1.5 font-semibold">{x.proposed ?? 'Cleared'}</td></tr>)}</tbody></table></div>
            {c.changes.some((x: any) => x.field.startsWith('bank_') || x.field === 'upi_id') && <p className="rounded-lg bg-warn/10 p-2 text-xs text-warn">Payout details. Approving puts them on the account, and finance must still verify them before the next payout.</p>}
            {c.status === 'pending' ? (<div className="space-y-2">
              <input className="field" aria-label={`Reason for rejecting ${c.full_name}'s changes`} aria-invalid={need === c.id ? true : undefined} placeholder="Reason to reject (shown to the owner)" value={reason[c.id] ?? ''} onChange={(e) => { setReason({ ...reason, [c.id]: e.target.value }); if (need === c.id) setNeed(null); }} />
              {need === c.id && <p role="alert" className="text-xs text-danger">Enter a reason so the owner knows what to fix.</p>}
              <div className="flex flex-wrap gap-2"><Button loading={approve.isPending && approve.variables === c.id} onClick={() => approve.mutate(c.id)}>Approve changes</Button>
                <Button variant="danger" loading={reject.isPending && reject.variables === c.id} onClick={() => { if ((reason[c.id] ?? '').trim().length < 3) return setNeed(c.id); reject.mutate(c.id); }}>Reject</Button></div></div>
            ) : c.status === 'rejected' && c.note ? <p className="text-xs text-danger">Reason: {c.note}{c.reviewed_at ? ` · ${fmtDateTime(c.reviewed_at)}` : ''}</p> : c.reviewed_at ? <p className="text-xs text-muted">Decided {fmtDateTime(c.reviewed_at)}</p> : null}
          </section>))}</div>}
      </QueryBoundary>
    </div>
  );
}
