import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiError, del, fieldErrors, get, post, put, setToken } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Input, PageHeader, PasswordInput, QueryBoundary } from '../../components/ui';
import { NotificationPreferences } from '../../components/NotificationPreferences';
import { fmtDateTime, titleCase } from '../../lib/utils';
import { DocumentsSection } from './OwnerOps';
import { BusinessStep, businessTypeLabel } from './OwnerOnboarding';
import { Modal, Textarea } from '../../components/ui';
import { isIndianMobile, MOBILE_MESSAGE } from '../../lib/phone';

interface Change { field: string; label: string; current: string | null; proposed: string | null }
interface ProfileData { profile: any; user: any; pendingChange: { id: string; requestedAt: string; changes: Change[] } | null; lastDecision: { status: 'approved' | 'rejected'; note: string | null; at: string; changes: Change[] } | null }
const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => get<ProfileData>('/me/profile') });
const SENT = 'Sent to PlaynX for approval. Your current details stay live until an admin approves the change.';

/** Edits to these details wait for an admin. This shows what is waiting, lets the owner withdraw it, and explains a rejection. */
function ChangeNotice({ pending, last, fields }: { pending: ProfileData['pendingChange']; last: ProfileData['lastDecision']; fields: string[] }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const withdraw = useMutation({ mutationFn: () => del('/owner/profile/change'), onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); toast('Request withdrawn'); }, onError: (e) => toast(apiError(e), 'error') });
  const mine = (c: Change[]) => c.filter((x) => fields.includes(x.field));
  const p = pending && mine(pending.changes).length ? pending : null;
  const l = !p && last?.status === 'rejected' && mine(last.changes).length ? last : null;
  if (!p && !l) return null;
  return p ? (
    <Card className="space-y-2 border-warn/40 bg-warn/10 p-4 text-sm"><p className="font-semibold">Waiting for PlaynX approval since {fmtDateTime(p.requestedAt)}</p>
      <p className="text-muted">Your current details below stay live. These changes show up only after an admin approves them.</p>
      <ul className="space-y-1">{mine(p.changes).map((c) => <li key={c.field}><b>{c.label}:</b> <span className="text-muted line-through">{c.current ?? 'not set'}</span> → <b>{c.proposed}</b></li>)}</ul>
      <Button variant="ghost" className="!py-1" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw request</Button></Card>
  ) : (
    <div role="status"><Card className="space-y-1 border-danger/40 bg-danger/10 p-4 text-sm"><p className="font-semibold">Your last change was not approved</p>
      <p>{l!.note}</p><p className="text-muted">Your existing details were not changed. You can send a corrected request below.</p></Card></div>
  );
}

export function BusinessPage() {
  const q = useProfile();
  return <QueryBoundary q={q}>{(d) => <BusinessForm profile={d.profile} user={d.user} pending={d.pendingChange} last={d.lastDecision} />}</QueryBoundary>;
}
/**
 * Business type after approval: the owner asks for a change with the details the new type needs. The approved details stay
 * live (venues, bookings, payouts) until a PlaynX admin approves it.
 */
function BusinessTypeCard({ current }: { current: string | null }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const req = useQuery({ queryKey: ['business-change'], queryFn: () => get<{ request: any | null }>('/owner/application/business-change') });
  const [open, setOpen] = useState(false); const [reason, setReason] = useState('');
  const app = useQuery({ queryKey: ['owner-application'], queryFn: () => get<any>('/owner/application'), enabled: open });
  const cancel = useMutation({ mutationFn: () => del('/owner/application/business-change'), onSuccess: () => { qc.invalidateQueries({ queryKey: ['business-change'] }); toast('Request cancelled. Your business type stays as it is.'); }, onError: (e) => toast(apiError(e), 'error') });
  const r = req.data?.request; const pending = r?.status === 'pending';
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-xs uppercase text-muted">Business type</div><b className="text-lg">{businessTypeLabel(current)}</b></div>
        {pending ? <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel request</Button>
          : <Button variant="ghost" onClick={() => { setReason(''); setOpen(true); }}>Change business type</Button>}
      </div>
      {pending && <p role="status" className="rounded-xl bg-warn/10 px-3 py-2 text-sm">Change to <b>{businessTypeLabel(r.toType)}</b> is waiting for PlaynX approval. Until then your current business details stay in use.</p>}
      {r?.status === 'rejected' && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">Your request to change to {businessTypeLabel(r.toType)} was rejected: {r.reviewNote}</p>}
      {r?.status === 'approved' && <p className="text-sm text-ok">Changed from {businessTypeLabel(r.fromType)} on {fmtDateTime(r.reviewedAt)}.</p>}
      <Modal open={open} onClose={() => setOpen(false)} title="Change business type" wide>
        <div className="space-y-4">
          <p className="rounded-xl bg-brand/10 px-3 py-2 text-sm">Choose the new type and fill in its details. PlaynX checks them before the change goes live; until then nothing changes for your venues, bookings or payouts.</p>
          <Textarea label="Why are you changing it? (optional)" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We registered a partnership firm" />
          {app.isLoading || !app.data ? <p className="text-sm text-muted">Loading your details…</p> : (
            <BusinessStep d={app.data} title="" nextLabel="Send for approval" refresh={() => {}} toPersonal={() => {}}
              submit={(body) => post('/owner/application/business-change', { ...body, ...(reason.trim() ? { reason: reason.trim() } : {}) })}
              next={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['business-change'] }); toast('Sent to PlaynX for approval. Your current details stay in use until then.'); }} />)}
        </div>
      </Modal>
    </Card>);
}

function BusinessForm({ profile, user, pending, last }: { profile: any; user: any; pending: ProfileData['pendingChange']; last: ProfileData['lastDecision'] }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ businessName: profile.business_name ?? '', gstin: profile.gstin ?? '', pan: profile.pan ?? '', address: profile.address ?? '' });
  const save = useMutation({ mutationFn: () => put('/owner/profile', Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))), onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['profile'] }); qc.invalidateQueries({ queryKey: ['owner-dashboard'] }); toast(r?.pending ? SENT : 'No changes to save', r?.pending ? 'info' : undefined); }, onError: (e) => toast(apiError(e), 'error') });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="max-w-2xl space-y-5"><PageHeader title="Business information" actions={<Badge status={profile.verification_status}>Account {profile.verification_status}</Badge>} />
      {profile.verification_note && <p className="rounded-xl border border-line p-3 text-sm"><b>Note from PlaynX:</b> {profile.verification_note}</p>}
      <Card className="grid gap-3 p-5 text-sm sm:grid-cols-2"><div><div className="text-xs uppercase text-muted">Authorized representative</div><b>{user.fullName}</b></div><div><div className="text-xs uppercase text-muted">Business email</div><b>{user.email}</b><div className="text-xs text-muted">Change it in My profile</div></div></Card>
      <BusinessTypeCard current={profile.business_type} />
      <ContactNumbers profile={profile} user={user} />
      <ChangeNotice pending={pending} last={last} fields={['business_name', 'gstin', 'pan', 'address']} />
      <Card className="p-5"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Input label="Business legal name" value={f.businessName} onChange={set('businessName')} required minLength={2} />
        <div className="grid gap-3 sm:grid-cols-2"><Input label="GSTIN" value={f.gstin} onChange={set('gstin')} /><Input label="PAN" value={f.pan} onChange={set('pan')} /></div>
        <Input label="Registered address" value={f.address} onChange={set('address')} />
        <p className="text-xs text-muted">Changes to these details are reviewed by PlaynX. They take effect only after an admin approves them.</p><Button type="submit" loading={save.isPending}>Send for approval</Button></form></Card>
      <section aria-label="Venue documents" className="space-y-3 pt-2"><h2 className="text-3xl font-bold">Venue documents</h2><p className="text-sm text-muted">Ownership and licence documents reviewed by PlaynX.</p><DocumentsSection /></section></div>
  );
}

/** The owner's business contact numbers: the main mobile and an optional second number. Changes are live at once, with no approval. */
function ContactNumbers({ profile, user }: { profile: any; user: any }) {
  const { toast } = useToast(); const qc = useQueryClient(); const { setUser } = useAuth();
  const [phone, setPhone] = useState<string>(user.phone ?? ''); const [alt, setAlt] = useState<string>(profile.alternate_phone ?? '');
  const [showAlt, setShowAlt] = useState(!!profile.alternate_phone); const [errs, setErrs] = useState<Record<string, string>>({});
  const clean = (v: string) => v.replace(/[\s-]/g, '');
  const canon = (v: string) => { const d = clean(v); return /^\d{10}$/.test(d) ? '+91' + d : d; };
  const phoneChanged = canon(phone) !== (user.phone ?? ''); const altNow = showAlt ? canon(alt) : ''; const altChanged = altNow !== (profile.alternate_phone ?? '');
  const save = useMutation({
    mutationFn: () => put('/me/profile', { ...(phoneChanged && phone ? { phone: clean(phone) } : {}), ...(altChanged ? { alternatePhone: altNow } : {}) }),
    onSuccess: (r: any) => { setUser(r.user); qc.invalidateQueries({ queryKey: ['profile'] }); setErrs({}); toast(phoneChanged ? 'Contact numbers saved. They are live now. Verify your new mobile number from My profile to receive codes on it.' : 'Contact numbers saved. They are live now.'); },
    onError: (e) => { setErrs(fieldErrors(e)); toast(apiError(e), 'error'); },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); const v: Record<string, string> = {};
    if (phone && !isIndianMobile(clean(phone))) v.phone = MOBILE_MESSAGE;
    if (showAlt && alt && !isIndianMobile(clean(alt))) v.alternatePhone = MOBILE_MESSAGE;
    if (showAlt && alt && phone && canon(alt) === canon(phone)) v.alternatePhone = 'Use a different number from your main mobile number';
    setErrs(v); if (Object.keys(v).length) return;
    if (!phoneChanged && !altChanged) return toast('No changes to save', 'info');
    save.mutate();
  };
  return (
    <Card className="p-5"><form className="space-y-3" onSubmit={submit} aria-label="Contact numbers">
      <div><h2 className="text-2xl font-bold">Contact numbers</h2><p className="text-xs text-muted">Change these any time. They update straight away, without approval.</p></div>
      <div className="max-w-sm"><Input label="Mobile number" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errs.phone} placeholder="+919876543210" hint={phoneChanged ? 'A new main number needs to be verified again before it receives codes.' : user.phone && !user.phoneVerified ? 'Not verified yet. Verify it from My profile.' : undefined} /></div>
      {showAlt ? (
        <div className="flex items-start gap-2"><div className="max-w-sm flex-1"><Input label="Second phone number" type="tel" value={alt} onChange={(e) => setAlt(e.target.value)} error={errs.alternatePhone} placeholder="+919876543211" /></div>
          <button type="button" onClick={() => { setShowAlt(false); setAlt(''); setErrs({}); }} className="mt-6 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-muted hover:text-danger">Remove</button></div>
      ) : <button type="button" onClick={() => setShowAlt(true)} className="btn-ghost !py-1.5 text-sm">+ Add another phone number</button>}
      <div><Button type="submit" loading={save.isPending}>Save contact numbers</Button></div>
    </form></Card>
  );
}

export function BankPage() {
  const q = useProfile();
  return <QueryBoundary q={q}>{(d) => <div className="max-w-2xl space-y-5"><BankForm profile={d.profile} pending={d.pendingChange} last={d.lastDecision} /></div>}</QueryBoundary>;
}

/** Account → Payment settings: full amount or advance when customers book, and the advance percentage. */
export function PaymentSettingsPage() {
  const q = useQuery({ queryKey: ['payment-collection'], queryFn: () => get<{ mode: 'full' | 'advance'; advancePercent: number | null }>('/owner/payment-collection') });
  const adv = q.data?.mode === 'advance' && q.data.advancePercent != null;
  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="Payment settings" subtitle="Choose how much customers pay online when they book your playing areas." />
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5" aria-label="Current setting">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Right now</p>
          <p className="mt-1 font-display text-2xl font-bold">{q.isLoading ? '…' : adv ? `Advance ${q.data!.advancePercent}%` : 'Full amount'}</p>
          <p className="text-sm text-muted">{q.isLoading ? '' : adv ? `Customers pay ${q.data!.advancePercent}% online when they book (₹${Math.round(10 * q.data!.advancePercent!)} for a ₹1,000 slot) and the rest at the venue. You record the balance in Bookings.` : 'Customers pay the whole amount online when they book.'}</p></div>
        <Badge status={adv ? 'pending' : 'approved'}>{adv ? 'Advance' : 'Full payment'}</Badge>
      </Card>
      <PaymentCollection />
      <p className="text-sm text-muted">A change applies to <b className="text-ink">new bookings only</b>. Bookings already made keep the amount the customer paid when they booked.</p>
    </div>);
}

/** When a customer books: the full amount, or only an advance (a percentage) with the rest paid at the venue after the game. */
export function PaymentCollection() {
  const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payment-collection'], queryFn: () => get<{ mode: 'full' | 'advance'; advancePercent: number | null }>('/owner/payment-collection') });
  const [f, setF] = useState<{ mode: 'full' | 'advance'; pct: string } | null>(null);
  const v = f ?? { mode: q.data?.mode ?? 'full', pct: q.data?.advancePercent != null ? String(q.data.advancePercent) : '' };
  const [err, setErr] = useState('');
  const save = useMutation({ mutationFn: () => put('/owner/payment-collection', v.mode === 'advance' ? { mode: 'advance', advancePercent: Number(v.pct) } : { mode: 'full' }),
    onSuccess: () => { setF(null); qc.invalidateQueries({ queryKey: ['payment-collection'] }); toast('Saved how customers pay when they book'); }, onError: (e) => setErr(apiError(e)) });
  const pct = Number(v.pct); const pctOk = /^\d{1,2}$/.test(v.pct) && pct >= 1 && pct <= 99;
  return (
    <Card className="p-5"><form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setErr(''); if (v.mode === 'advance' && !pctOk) return setErr('Enter the advance percentage, from 1 to 99.'); save.mutate(); }}>
      <div><h2 className="text-2xl font-bold">Change it</h2><p className="text-sm text-muted">Do you take the full amount when a customer books, or only an advance?</p></div>
      <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="sr-only">Amount taken when booking</legend>
        {([['full', 'Full amount', 'Customers pay the whole amount when they book.'], ['advance', 'Advance amount only', 'Customers pay a part when they book and the rest after playing.']] as const).map(([k, l, h]) => (
          <label key={k} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${v.mode === k ? 'border-brand bg-brand/10' : 'border-line'}`}>
            <input type="radio" name="payment-collection" value={k} checked={v.mode === k} onChange={() => setF({ ...v, mode: k })} className="mt-1" /><span><b className="block">{l}</b><span className="text-muted">{h}</span></span></label>))}
      </fieldset>
      {v.mode === 'advance' && (<>
        <Input mandatory label="Advance percentage (%)" type="number" inputMode="numeric" min={1} max={99} value={v.pct} onChange={(e) => setF({ ...v, pct: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="For example 30" error={v.pct && !pctOk ? 'Enter a percentage from 1 to 99' : undefined} />
        <p role="alert" className="rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm text-warn">
          <b>You have chosen advance payment.</b> When customers book, they pay only {pctOk ? `${pct}%` : 'the percentage you enter'} of the amount you set for the slot{pctOk ? ` (for a ₹1,000 slot, ₹${Math.round(10 * pct)} when booking)` : ''}. They pay the rest after they finish playing.</p></>)}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" loading={save.isPending} disabled={q.isLoading}>Save</Button></form></Card>);
}

function BankForm({ profile, pending, last }: { profile: any; pending: ProfileData['pendingChange']; last: ProfileData['lastDecision'] }) {
  const { toast } = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ bankAccountName: profile.bank_account_name ?? '', bankAccountNumber: '', bankIfsc: profile.bank_ifsc ?? '', upiId: profile.upi_id ?? '' });
  const has = !!(profile.bank_account_number || profile.upi_id);
  const save = useMutation({ mutationFn: () => put('/owner/profile', Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))), onSuccess: (r: any) => { setF({ ...f, bankAccountNumber: '' }); qc.invalidateQueries({ queryKey: ['profile'] }); if (!has) { qc.invalidateQueries({ queryKey: ['owner-bank'] }); qc.invalidateQueries({ queryKey: ['owner-checklist'] }); return toast('Bank details saved. The rest of the portal is open now. PlaynX verifies them before your first payout.', 'success'); } toast(r?.pending ? SENT : 'No changes to save', r?.pending ? 'info' : undefined); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div className="space-y-5"><PageHeader title="Bank account details" subtitle="Where your settlements are paid" actions={has ? <Badge status={profile.bank_verified ? 'verified' : 'pending'}>{profile.bank_verified ? 'Verified' : 'Verification pending'}</Badge> : undefined} />
      {has && <Card className="p-5 text-sm"><div className="grid gap-3 sm:grid-cols-2"><div><div className="text-xs uppercase text-muted">Account holder</div><b>{profile.bank_account_name ?? '—'}</b></div><div><div className="text-xs uppercase text-muted">Account number</div><b>{profile.bank_account_number ?? '—'}</b></div><div><div className="text-xs uppercase text-muted">IFSC</div><b>{profile.bank_ifsc ?? '—'}</b></div><div><div className="text-xs uppercase text-muted">UPI</div><b>{profile.upi_id ?? '—'}</b></div></div>
        {!profile.bank_verified && <p className="mt-3 rounded-lg bg-warn/10 p-2 text-warn">Settlements are paid only to a verified account. PlaynX finance verifies new or changed details.</p>}</Card>}
      <ChangeNotice pending={pending} last={last} fields={['bank_account_name', 'bank_account_number', 'bank_ifsc', 'upi_id']} />
      <Card className="p-5"><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!Object.values(f).some(Boolean)) return toast('Enter the details to save', 'error');
          if (!has) { // the first account needs all three before anything else in the portal opens
            if (f.bankAccountName.trim().length < 2) return toast("Enter the account holder's name", 'error'); if (!/^\d{6,20}$/.test(f.bankAccountNumber)) return toast('Enter the account number (6 to 20 digits)', 'error'); if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bankIfsc)) return toast('Enter a valid IFSC code, e.g. HDFC0001234', 'error');
          }
          save.mutate(); }}>
        <h2 className="text-2xl font-bold">{has ? 'Update details' : 'Add bank details'}</h2>
        <Input mandatory={!has} label="Account holder name" value={f.bankAccountName} onChange={(e) => setF({ ...f, bankAccountName: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2"><Input mandatory={!has} label="Account number" inputMode="numeric" value={f.bankAccountNumber} onChange={(e) => setF({ ...f, bankAccountNumber: e.target.value.replace(/\D/g, '') })} placeholder={profile.bank_account_number ?? ''} hint={has ? 'Leave blank to keep the current number' : undefined} />
          <Input mandatory={!has} label="IFSC" value={f.bankIfsc} onChange={(e) => setF({ ...f, bankIfsc: e.target.value.toUpperCase() })} pattern="[A-Z]{4}0[A-Z0-9]{6}" placeholder="HDFC0001234" /></div>
        <Input label="UPI ID (optional)" value={f.upiId} onChange={(e) => setF({ ...f, upiId: e.target.value })} />
        {!has ? <p className="text-xs text-muted">Add your bank account to open the rest of the portal. It is saved straight away and PlaynX verifies it before your first payout.</p> : <p className="text-xs text-muted">Changed bank details are reviewed by PlaynX. Your current account is used for payouts until an admin approves the change, and the new one is then verified before it is paid.</p>}
        <Button type="submit" loading={save.isPending}>{has ? 'Send for approval' : 'Save bank details'}</Button></form></Card></div>
  );
}

const EVENT: Record<string, string> = { 'user.login': 'Signed in', 'user.login_google': 'Signed in with Google', 'user.password_change': 'Password changed', 'user.password_reset': 'Password reset', 'user.logout_all': 'Signed out other devices' };
export function SecurityPage() {
  const { toast } = useToast(); const qc = useQueryClient();
  const hist = useQuery({ queryKey: ['login-history'], queryFn: () => get<{ events: any[] }>('/owner/security/login-history') });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' }); const [confirm, setConfirm] = useState(''); const [pwErr, setPwErr] = useState('');
  const change = useMutation({ mutationFn: () => post('/auth/change-password', pw), onSuccess: (r: any) => { if (r.token) setToken(r.token); setPw({ currentPassword: '', newPassword: '' }); setConfirm(''); qc.invalidateQueries({ queryKey: ['login-history'] }); toast('Your password has been changed. Other devices were signed out.'); }, onError: (e) => toast(apiError(e), 'error') });
  const out = useMutation({ mutationFn: () => post('/auth/logout-all'), onSuccess: (r: any) => { if (r.token) setToken(r.token); qc.invalidateQueries({ queryKey: ['login-history'] }); toast('All other devices have been signed out'); }, onError: (e) => toast(apiError(e), 'error') });
  return (
    <div className="max-w-2xl space-y-5"><PageHeader title="Settings" subtitle="Notifications, password, sign-out, and everything done on your account." />
      <NotificationPreferences owner />
      <Card className="p-5"><form className="max-w-md space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); setPwErr(''); if (!pw.currentPassword) return setPwErr('Enter your current password.'); if (!(pw.newPassword.length >= 8 && /[A-Za-z]/.test(pw.newPassword) && /\d/.test(pw.newPassword))) return setPwErr('Use at least 8 characters with a letter and a digit.'); if (confirm !== pw.newPassword) return setPwErr('The passwords do not match.'); change.mutate(); }}><h2 className="text-2xl font-bold">Security</h2>
        <PasswordInput mandatory label="Current password" autoComplete="current-password" placeholder="Enter your password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        <PasswordInput mandatory label="New password" autoComplete="new-password" placeholder="Create a strong password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint="At least 8 characters with a letter and a digit" />
        <PasswordInput mandatory label="Confirm new password" autoComplete="new-password" placeholder="Re-enter your password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {pwErr && <p role="alert" className="text-sm text-danger">{pwErr}</p>}
        <Button type="submit" loading={change.isPending}>Change password</Button></form></Card>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="text-2xl font-bold">Session</h2><p className="text-sm text-muted">This device stays signed in. Every other browser or device is signed out immediately.</p></div>
        <Button variant="danger" loading={out.isPending} onClick={() => window.confirm('Sign out of all other devices?') && out.mutate()}>Sign out other devices</Button></Card>
      <Card className="p-5"><h2 className="mb-3 text-2xl font-bold">Login & security history</h2>
        <QueryBoundary q={hist} empty={(d) => d.events.length === 0 && <p className="text-sm text-muted">No activity recorded.</p>}>{(d) => <ul className="divide-y divide-line text-sm">{d.events.map((e, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span>{EVENT[e.action] ?? titleCase(e.action)}</span><span className="text-muted">{e.ip ? `${e.ip} · ` : ''}{fmtDateTime(e.created_at)}</span></li>)}</ul>}</QueryBoundary></Card>
      <p className="text-xs text-muted">Two-factor authentication is not available yet. Device names are not recorded; history shows time and IP address.</p></div>
  );
}

/** JusGo's Profile: your account and the details you gave during onboarding, read only. Changes are made on Business information, Bank and Settings. */
const TYPE_LABEL: Record<string, string> = { individual: 'Individual', sole_proprietorship: 'Sole Proprietorship', partnership_pvt_ltd: 'Partnership / Private Limited Company', partnership: 'Partnership Firm', private_limited: 'Private Limited Company', opc: 'One Person Company (OPC)', llp: 'Limited Liability Partnership (LLP)', trust_society: 'Trust / Society / Club' };
const STATUS_WORD: Record<string, string> = { approved: 'Approved', verified: 'Verified', under_review: 'Under review', submitted: 'Submitted', incomplete: 'Incomplete', rejected: 'Rejected', pending: 'Pending', changes_requested: 'Changes requested' };
export function OwnerProfilePage() {
  const q = useQuery({ queryKey: ['owner-application'], queryFn: () => get<any>('/owner/application') });
  const Row = ({ k, v }: { k: string; v?: React.ReactNode }) => <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-muted">{k}</span><span className="text-right font-medium">{v || '—'}</span></div>;
  return (
    <div className="max-w-3xl space-y-5"><PageHeader title="Profile" subtitle="Your account and the details you gave during onboarding." />
      <QueryBoundary q={q}>{(d) => { const b = d.business ?? {}; const a = d.application ?? {}; const addr = [b.address, b.addressLine2, b.city, b.state, b.pincode, b.country].filter(Boolean).join(', ');
        return (<>
          <Card className="space-y-1 p-5"><h2 className="mb-1 text-2xl font-bold">Contact details</h2><div className="divide-y divide-line">
            <Row k="Name" v={d.owner?.fullName} /><Row k="Email" v={<>{d.contact?.email} {d.contact?.emailVerified && <Badge status="verified" />}</>} /><Row k="Mobile" v={<>{d.contact?.phone} {d.contact?.phoneVerified && <Badge status="verified" />}</>} /><Row k="Address" v={addr} /></div>
            <p className="pt-2 text-xs text-muted">To change your contact numbers or business details, go to <Link className="underline" to="/owner/account/business">Business information</Link>. Your password is under <Link className="underline" to="/owner/account/security">Settings</Link>.</p></Card>
          <Card className="space-y-1 p-5"><h2 className="mb-1 text-2xl font-bold">Verification</h2><div className="divide-y divide-line">
            <Row k="Application" v={<Badge status={a.status === 'approved' ? 'approved' : a.status === 'rejected' ? 'rejected' : 'pending'}>{STATUS_WORD[a.status] ?? a.status}</Badge>} /><Row k="Reference" v={a.reference} />
            <Row k="Business" v={STATUS_WORD[d.sections?.business] ?? d.sections?.business} /><Row k="Identity" v={STATUS_WORD[d.sections?.identity] ?? d.sections?.identity} /><Row k="Bank account" v={<Link className="underline" to="/owner/account/bank">View bank details</Link>} /></div></Card>
          <Card className="space-y-2 p-5"><h2 className="text-2xl font-bold">Account type</h2>
            {b.type ? <><p className="inline-block rounded-full bg-brand/15 px-3 py-1 text-sm font-semibold">{TYPE_LABEL[b.type] ?? titleCase(b.type)}</p><div className="divide-y divide-line">
              {b.type !== 'individual' && <Row k="Business or trade name" v={b.name} />}<Row k="Full legal name" v={b.representativeName} /><Row k="Date of birth" v={b.dob} /><Row k="PAN" v={b.panMasked} /><Row k="Aadhaar" v={d.identity?.aadhaarMasked} />
              <Row k="Phone" v={b.phone} /><Row k="GST" v={b.gstin} /><Row k="Udyam / MSME" v={b.udyamNumber} />{b.registrationNumber && <Row k="Registration number" v={b.registrationNumber} />}{b.designation && <Row k="Designation" v={b.designation} />}</div>
              {(b.partners ?? []).length > 0 && <div><h3 className="mb-1 mt-3 text-sm font-bold">Partners / directors</h3><ul className="space-y-1 text-sm">{b.partners.map((p: any, i: number) => <li key={i} className="rounded-lg border border-line p-2"><b>{p.name}</b> · {p.pan} · {p.phone}</li>)}</ul></div>}</>
              : <p className="text-sm text-muted">No account type chosen yet.</p>}</Card></>); }}</QueryBoundary>
    </div>
  );
}
