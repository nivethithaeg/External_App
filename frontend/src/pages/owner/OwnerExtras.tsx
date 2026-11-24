import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiError, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, PasswordInput, QueryBoundary, Select, Table, Textarea } from '../../components/ui';
import { fmtDateTime, money, titleCase } from '../../lib/utils';

/* ------------------------------------------------------------- Activity log */
const CAT_LABEL: Record<string, string> = { account: 'Sign-in & account', application: 'Application', venue: 'Venues', booking: 'Bookings', staff: 'Staff', payout: 'Payouts' };
export function OwnerActivityPage() {
  const [open, setOpen] = useState<any | null>(null); // the row whose details are on show
  const [category, setCategory] = useState(''); const [search, setSearch] = useState(''); const [by, setBy] = useState(''); const [resource, setResource] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const q = useQuery({ queryKey: ['owner-activity', category, search, by, resource, from, to], queryFn: () => get<{ activity: any[]; categories: string[]; resources: string[] }>('/owner/activity', { ...(category ? { category } : {}), ...(search ? { search } : {}), ...(by ? { by } : {}), ...(resource ? { resource } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Activity Log" subtitle="What you and your staff did on your account: who, what and when." />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Show activity" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All activities</option>{Object.entries(CAT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Select label="Done by" value={by} onChange={(e) => setBy(e.target.value)}><option value="">Everyone</option><option value="owner">You</option><option value="staff">All staff</option></Select>
        <Select label="Resource" value={resource} onChange={(e) => setResource(e.target.value)}><option value="">Any resource</option>{(q.data?.resources ?? []).map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select>
        <Input label="Search" placeholder="Name, venue, booking or what happened" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Input label="From (optional)" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /><Input label="To (optional)" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>
      <QueryBoundary q={q} empty={(d) => d.activity.length === 0 && <Empty icon="🧾" title="No activity yet" hint="Sign-ins, application steps, venue changes and staff actions appear here." />}>
        {(d) => <Table rows={d.activity.map((a) => ({ ...a, id: String(a.id) }))} onRow={(a: any) => setOpen(a)} columns={[
          { key: 'created_at', header: 'When', render: (a: any) => fmtDateTime(a.created_at) },
          { key: 'actor_name', header: 'Done by', render: (a: any) => <div><b>{a.actor_name ?? 'System'}</b>{a.actor_role && <div className="text-xs text-muted">{titleCase(a.actor_role)}</div>}</div> },
          { key: 'action', header: 'What', render: (a: any) => <Badge status="pending">{titleCase(String(a.action).replace(/[._]/g, ' '))}</Badge> },
          { key: 'ip', header: 'From', render: (a: any) => a.ip ?? 'Not recorded' }]} />}
      </QueryBoundary>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Activity details">{open && (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">What</dt><dd><b>{titleCase(String(open.action).replace(/[._]/g, ' '))}</b></dd>
          <dt className="text-muted">When</dt><dd>{fmtDateTime(open.created_at)}</dd>
          <dt className="text-muted">Done by</dt><dd>{open.actor_name ?? 'System'}{open.actor_role ? ` (${titleCase(open.actor_role)})` : ''}</dd>
          <dt className="text-muted">Resource</dt><dd>{open.entity ? titleCase(String(open.entity).replace(/_/g, ' ')) : 'Not recorded'}</dd>
          {open.entity_id && <><dt className="text-muted">Resource ID</dt><dd className="break-all font-mono text-xs">{open.entity_id}</dd></>}
          <dt className="text-muted">From</dt><dd>{open.ip ?? 'Not recorded'}</dd>
          {open.metadata && Object.keys(open.metadata).length > 0 && <><dt className="text-muted">Details</dt><dd><ul className="space-y-0.5">{Object.entries(open.metadata as Record<string, unknown>).filter(([k]) => !/password|token|secret|otp/i.test(k)).map(([k, v]) => <li key={k}><span className="text-muted">{titleCase(k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '))}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</li>)}</ul></dd></>}
        </dl>)}</Modal>
    </div>
  );
}

/* ------------------------------------------------------------- Close account */
export function OwnerCloseAccountPage() {
  const { logout } = useAuth(); const nav = useNavigate();
  const info = useQuery({ queryKey: ['owner-close-info'], queryFn: () => get<{ reasons: string[] }>('/owner/account/close-info') });
  const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [password, setPassword] = useState(''); const [confirmWord, setConfirmWord] = useState(''); const [error, setError] = useState('');
  const close = useMutation({ mutationFn: () => post('/owner/account/close', { confirm: 'DELETE', ...(reason.trim() ? { reason: reason.trim() } : {}) }), onSuccess: () => { logout(); nav('/', { replace: true }); }, onError: (e) => setError(apiError(e)) });
  const go = () => { setError(''); if (confirmWord.trim().toUpperCase() !== 'DELETE') return setError('Type DELETE to confirm'); close.mutate(); };
  return (
    <div>
      <PageHeader title="Delete account" subtitle="Permanently close your KickOff account and delete your personal information." />
      <Card className="max-w-2xl space-y-4 p-5">
        <div className="text-sm"><b>What happens</b>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            <li>Your account closes straight away and you can no longer sign in.</li>
            <li>Your venues are hidden from customers and your staff logins stop working.</li>
            <li>Booking and payment records that the law requires us to keep (for GST and income tax) are kept for the period the law sets, without your personal details.</li>
            <li>You cannot close your account while you have upcoming confirmed bookings.</li></ul></div>
        <Textarea label="Why are you leaving? (optional)" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}  placeholder="Optional. Helps us improve." />
        <Input label="Type DELETE to confirm" autoComplete="off" autoCapitalize="characters" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} />
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button variant="danger" onClick={go} loading={close.isPending} disabled={confirmWord.trim().toUpperCase() !== 'DELETE'}>Delete my account</Button>
      </Card>
    </div>
  );
}
