import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLogoutConfirm } from '../../components/LogoutConfirm';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, fieldErrors, get, post, put, setNotApprovedHandler } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, ErrorBox, Input, Loading, Modal, PasswordInput, Select, Textarea } from '../../components/ui';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/Layouts';
import { FileLink } from '../../components/FileLink';
import { JusgoSignup } from '../../components/JusgoSignup';
import { GoogleSignIn } from '../../components/GoogleSignIn';
import { FaceCamera } from '../../components/FaceCamera';
import { TermsCheckbox } from '../../components/TermsCheckbox';
import { FILTERS } from '../../lib/inputFilters';
import { StateCityFields } from '../../components/StateCity';
import { ChangeType, Shell } from '../auth/AuthPages';
import { cx, fmtDateTime } from '../../lib/utils';
import { isIndianMobile, PHONE_CHECK, MOBILE_MESSAGE } from '../../lib/phone';

const STAR = "after:ml-1 after:font-bold after:text-danger after:content-['*']"; // red * drawn by CSS, so the visible label text is unchanged

/* ------------------------------------------------------------------ constants */
const STEPS = ['Verify contact', 'Personal details', 'Account type', 'Documents', 'Self verification', 'Review'];
// Business types as on jusgo.in. Older types stay readable (and editable) for applications already created with them.
const BUSINESS_TYPES = [
  { id: 'individual', label: 'Individual', desc: 'For individuals operating a turf or sports venue in their own name.' },
  { id: 'sole_proprietorship', label: 'Sole Proprietorship', desc: 'A business owned and run by one person under a business or trade name.' },
  { id: 'partnership_pvt_ltd', label: 'Partnership / Private Limited Company', desc: 'A partnership firm, or a private limited company incorporated under the Companies Act.' },
] as const;
const LEGACY_TYPES = [
  { id: 'partnership', label: 'Partnership Firm', desc: 'Registered partnership with a partnership deed' },
  { id: 'private_limited', label: 'Private Limited Company', desc: 'Registered company with a CIN' },
  { id: 'opc', label: 'One Person Company (OPC)', desc: 'A company with a single director, registered with a CIN' },
  { id: 'llp', label: 'Limited Liability Partnership (LLP)', desc: 'Registered LLP with an LLPIN' },
  { id: 'trust_society', label: 'Trust / Society / Club', desc: 'Sports club, academy, school or trust with a registration number' },
] as const;
export const ALL_TYPES: readonly { id: string; label: string; desc: string }[] = [...BUSINESS_TYPES, ...LEGACY_TYPES];
export const businessTypeLabel = (id?: string | null) => ALL_TYPES.find((t) => t.id === id)?.label ?? (id ? id.replace(/_/g, ' ') : 'Not set');
const JUSGO_TYPES = ['individual', 'sole_proprietorship', 'partnership_pvt_ltd'];
const UDYAM_RE = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
const GST_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PHONE_RE10 = PHONE_CHECK;
const LABELS: Record<string, Record<string, string>> = {
  partnership: { name: 'Partnership firm name', rep: 'Authorized partner name', pan: 'Firm PAN', addr: 'Business address' },
  private_limited: { name: 'Company legal name', rep: 'Authorized representative name', pan: 'Company PAN', addr: 'Registered business address' },
  opc: { name: 'Company legal name', rep: 'Director name', pan: 'Company PAN', addr: 'Registered business address' },
  llp: { name: 'LLP legal name', rep: 'Designated partner name', pan: 'LLP PAN', addr: 'Registered business address' },
  trust_society: { name: 'Name of the trust / society / club', rep: 'Authorized signatory name', pan: 'PAN of the trust / society', addr: 'Registered office address' },
};
const IDENTITY_TYPES: [string, string][] = [['aadhaar_masked', 'Masked Aadhaar'], ['passport', 'Passport'], ['voter_id', 'Voter ID'], ['driving_licence', 'Driving licence']];
/** The proofs shown in the dropdown, each with a hint about what to upload. */
const IDENTITY_HELP: Record<string, string> = { aadhaar_masked: 'Aadhaar card with the first 8 digits masked', passport: 'Passport photo page', voter_id: 'Voter ID (EPIC) card, front and back', driving_licence: 'Driving licence, front and back' };
const APP_STATUS: Record<string, string> = { incomplete: 'Registration incomplete', submitted: 'Submitted', under_review: 'Under review', info_required: 'Additional information required', resubmission_required: 'Resubmission required', approved: 'Approved', rejected: 'Rejected' };
const SECTION: Record<string, [string, string]> = {
  verified: ['Verified', 'approved'], pending: ['Pending', 'pending'], incomplete: ['Incomplete', 'pending'], complete: ['Complete', 'approved'], under_review: ['Under review', 'pending'],
  changes_requested: ['Changes requested', 'rejected'], approved: ['Approved', 'approved'], draft: ['Draft', 'pending'], rejected: ['Rejected', 'rejected'], suspended: ['Suspended', 'rejected'],
};
const SectionBadge = ({ s }: { s: string }) => <Badge status={SECTION[s]?.[1] ?? 'pending'}>{SECTION[s]?.[0] ?? s}</Badge>;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/, CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/, LLPIN_RE = /^[A-Z]{3}-[0-9]{4}$/, TRUST_RE = /^[A-Z0-9][A-Z0-9/.\- ]{3,39}$/;
const NAME_RE = /^[\p{L}][\p{L} .'-]*$/u;

export type AppData = any;

/** The wizard step where a missing item has to be fixed. */
const stepOf = (m: { type: string; key: string }) => (m.type === 'contact' ? 0 : m.key === 'personal' ? 1 : m.key === 'self_verification' ? 4 : m.type === 'document' || m.key === 'identity' ? 3 : 2);

/** After jumping from the review list: scroll to the field, focus it, and flash a ring so it is obvious. */
function useFocusField(key: string | null | undefined) {
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${key}"]`);
      if (!el) return;
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); // optional: not every environment implements it
      (el.matches('input,textarea,select,button') ? el : el.querySelector<HTMLElement>('button,input:not([hidden]),textarea,select'))?.focus({ preventScroll: true });
      el.classList.add('ring-2', 'ring-brand'); setTimeout(() => el.classList.remove('ring-2', 'ring-brand'), 2500);
    }, 80);
    return () => clearTimeout(t);
  }, [key]);
}
// While the application is still being reviewed, re-check every few seconds (and when the tab regains focus)
// so each document or section the admin approves shows up here without a manual reload.
const useApplication = () => useQuery({
  queryKey: ['owner-application'], queryFn: () => get<AppData>('/owner/application'), staleTime: 5_000, refetchOnWindowFocus: true,
  refetchInterval: (q) => (q.state.data && (q.state.data as any).accountStatus === 'active' ? false : 8_000),
});

/* ------------------------------------------------------------------ gate */
/** Sends owners whose account isn't active to their application page; dashboard routes render only for active owners. */
/** True while the owner's documents are submitted and the admin has not decided yet: they may look around, but nothing opens. */
/** null = approved (everything opens). Otherwise where the application stands: waiting for the admin, sent back for changes, or rejected. */
type Pending = null | 'waiting' | 'changes' | 'rejected';
const PendingCtx = createContext<Pending>(null);
export const usePendingApproval = () => useContext(PendingCtx) !== null;

/** Where an unapproved application stands (null once it is approved, suspended, or still being filled in). */
function pendingOf(accountStatus: string, status: string | undefined): Pending {
  if (accountStatus === 'suspended' || accountStatus === 'active') return null;
  return status === 'rejected' ? 'rejected' : status === 'info_required' || status === 'resubmission_required' ? 'changes' : status === 'submitted' || status === 'under_review' ? 'waiting' : null;
}

export function OwnerGate({ children }: { children: ReactNode }) {
  const q = useApplication();
  if (q.isLoading) return <Loading />;
  if (q.isError) return <div className="mx-auto max-w-lg p-6"><ErrorBox error={q.error} retry={() => q.refetch()} /></div>;
  // Once the documents are submitted the owner sees the whole portal beside the application status. Nothing opens until the admin approves.
  const pending = pendingOf(q.data.accountStatus, q.data.application?.status);
  if (q.data.accountStatus !== 'active' && !pending) return <Navigate to="/owner/application" replace />;
  if (pending) return <PendingCtx.Provider value={pending}><PendingFrame>{children}</PendingFrame></PendingCtx.Provider>;
  return <BankFrame>{children}</BankFrame>;
}

/**
 * The portal while waiting for approval. Every link or button that would open something shows "Waiting for admin approval" instead.
 * Only sign-out, the theme switch and the application status page stay usable.
 */
const POPUP: Record<Exclude<Pending, null>, { title: string; icon: string; text: string }> = {
  waiting: { title: 'Waiting for admin approval', icon: '⏳', text: 'Your documents are with the PlaynX team. You can look at every page, but adding or changing anything opens once your application is approved. We will email you as soon as there is a decision.' },
  changes: { title: 'Update your application first', icon: '✏️', text: 'The PlaynX team asked for changes to your application. Update it from the application status page; adding or changing anything in the portal opens once it is approved.' },
  rejected: { title: 'Application not approved', icon: '⛔', text: 'Your application was not approved, so adding or changing anything in the portal is closed. Open the application status page to see why and what you can do.' },
};
const CREATE_PAGES = ['/owner/venues/new', '/owner/bookings/new'];
function PendingFrame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false); const nav = useNavigate(); const state = useContext(PendingCtx) ?? 'waiting'; const pop = POPUP[state];
  // Every page can be opened and looked at. Anything that would add or change something is refused by the server, and that opens the pop-up.
  useEffect(() => { setNotApprovedHandler((code) => { if (code === 'owner_not_approved') setOpen(true); }); return () => setNotApprovedHandler(null); }, []);
  // The pages that exist only to add something (a new venue, a new offline booking) do not open at all until the application is approved: the pop-up opens instead.
  const loc = useLocation();
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null; if (!a) return;
      const path = new URL(a.href, window.location.origin).pathname.replace(/\/$/, '');
      if (CREATE_PAGES.includes(path)) { e.preventDefault(); e.stopPropagation(); setOpen(true); }
    };
    document.addEventListener('click', click, true); return () => document.removeEventListener('click', click, true);
  }, []);
  useEffect(() => { if (CREATE_PAGES.includes(loc.pathname.replace(/\/$/, ''))) { setOpen(true); nav(loc.pathname.startsWith('/owner/bookings') ? '/owner/bookings' : '/owner/venues', { replace: true }); } }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {children}
      <Modal open={open} onClose={() => setOpen(false)} title={pop.title}>
        <div className="space-y-4 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-warn/15 text-3xl" aria-hidden="true">{pop.icon}</div>
          <p className="text-sm">{pop.text}</p>
          <div className="flex flex-wrap justify-center gap-2"><Button variant="ghost" onClick={() => { setOpen(false); nav('/owner'); }}>View application status</Button><Button onClick={() => setOpen(false)}>OK</Button></div>
        </div>
      </Modal>
    </>
  );
}

/**
 * An approved owner without a payout bank account: a pop-up that cannot be skipped asks for it right after approval. The portal behind it
 * opens only once the account is saved. (The server refuses every add or change until then, so it holds even without this screen.)
 */
function BankFrame({ children }: { children: ReactNode }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const bankQ = useQuery({ queryKey: ['owner-bank'], queryFn: () => get<{ accountNumber: string | null }>('/owner/bank') });
  const needs = bankQ.isSuccess && !bankQ.data.accountNumber;
  const [f, setF] = useState({ bankAccountName: '', bankAccountNumber: '', bankIfsc: '', upiId: '' });
  const [pc, setPc] = useState<{ mode: '' | 'full' | 'advance'; pct: string }>({ mode: '', pct: '' }); // how customers pay when they book
  const [errs, setErrs] = useState<Record<string, string>>({}); const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () => {
      // the bank account first: it is what opens the portal; then how customers pay
      const r = await put('/owner/profile', { bankAccountName: f.bankAccountName.trim(), bankAccountNumber: f.bankAccountNumber, bankIfsc: f.bankIfsc, ...(f.upiId.trim() ? { upiId: f.upiId.trim() } : {}) });
      await put('/owner/payment-collection', pc.mode === 'advance' ? { mode: 'advance', advancePercent: Number(pc.pct) } : { mode: 'full' });
      return r;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['owner-bank'] }); qc.invalidateQueries({ queryKey: ['owner-checklist'] }); qc.invalidateQueries({ queryKey: ['profile'] }); toast('Bank details saved. The portal is open now. PlaynX verifies them before your first payout.', 'success'); },
    onError: (e) => { const fe = fieldErrors(e); if (Object.keys(fe).length) setErrs(fe); else setError(apiError(e)); },
  });
  const go = () => {
    setError(''); const v: Record<string, string> = {};
    if (f.bankAccountName.trim().length < 2) v.bankAccountName = "Enter the account holder's name";
    if (!/^\d{6,20}$/.test(f.bankAccountNumber)) v.bankAccountNumber = 'Enter the account number (6 to 20 digits)';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.bankIfsc)) v.bankIfsc = 'Enter a valid IFSC code, e.g. HDFC0001234';
    if (!pc.mode) v.pc = 'Choose how customers pay when they book.';
    else if (pc.mode === 'advance' && !(/^\d{1,2}$/.test(pc.pct) && +pc.pct >= 1 && +pc.pct <= 99)) v.pct = 'Enter the advance percentage, from 1 to 99.';
    setErrs(v); if (Object.keys(v).length === 0) save.mutate();
  };
  return (
    <>
      <PriceGate off={needs || !bankQ.isSuccess}>{children}</PriceGate>
      <Modal open={needs} locked onClose={() => undefined} title="Add your bank account details">
        <div className="space-y-4">
          <div role="alert" className="rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm text-warn">
            <b className="block">You cannot skip this step.</b>
            Fill in your bank details to open the portal. PlaynX pays your bookings into this account only after the admin has checked and approved these details.</div>
          <Input mandatory label="Account holder name" value={f.bankAccountName} onChange={set('bankAccountName')} error={errs.bankAccountName} autoComplete="off" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input mandatory label="Account number" inputMode="numeric" value={f.bankAccountNumber} onChange={set('bankAccountNumber')} error={errs.bankAccountNumber} autoComplete="off" />
            <Input mandatory label="IFSC code" value={f.bankIfsc} onChange={set('bankIfsc')} error={errs.bankIfsc} maxLength={11} autoComplete="off" /></div>
          <Input label="UPI ID (optional)" value={f.upiId} onChange={set('upiId')} autoComplete="off" />
          <fieldset className="space-y-2"><legend className="mb-1 text-sm font-bold">How customers pay when they book <span className="text-danger">*</span></legend>
            <div className="grid gap-2 sm:grid-cols-2">{([['full', 'Full amount', 'Customers pay the whole amount when they book.'], ['advance', 'Advance amount only', 'Customers pay a part when they book and the rest after playing.']] as const).map(([k, l, h]) => (
              <label key={k} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${pc.mode === k ? 'border-brand bg-brand/10' : 'border-line'}`}>
                <input type="radio" name="bank-payment-collection" checked={pc.mode === k} onChange={() => setPc({ ...pc, mode: k })} className="mt-1" /><span><b className="block">{l}</b><span className="text-muted">{h}</span></span></label>))}</div>
            {errs.pc && <p role="alert" className="text-xs text-danger">{errs.pc}</p>}
            {pc.mode === 'advance' && (<>
              <Input mandatory label="Advance percentage (%)" type="number" inputMode="numeric" min={1} max={99} value={pc.pct} onChange={(e) => setPc({ ...pc, pct: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="For example 30" error={errs.pct} />
              <p role="status" className="rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm text-warn"><b>You have chosen advance payment.</b> When customers book, they pay only {+pc.pct >= 1 && +pc.pct <= 99 ? `${+pc.pct}%` : 'the percentage you enter'} of the amount you set for the slot{+pc.pct >= 1 && +pc.pct <= 99 ? ` (for a ₹1,000 slot, ₹${10 * +pc.pct} when booking)` : ''}. They pay the rest after they finish playing.</p></>)}
          </fieldset>
          {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button className="w-full" loading={save.isPending} onClick={go}>Save bank details and continue</Button>
        </div>
      </Modal>
    </>
  );
}

/** What an owner sees on the portal home while waiting: where the application stands. */
export function PendingOverview() {
  const q = useApplication(); const nav = useNavigate(); const state = useContext(PendingCtx) ?? 'waiting';
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data as AppData;
  return (
    <div className="mx-auto max-w-2xl space-y-5"><div><h1 className="text-4xl font-extrabold">Welcome, {d.owner?.fullName?.split(' ')[0] ?? 'there'}</h1><p className="mt-1 text-sm text-muted">{{waiting: 'Your venue owner application is waiting for admin approval.', changes: 'The PlaynX team asked for changes to your application.', rejected: 'Your venue owner application was not approved.'}[state]} The menu shows everything you will be able to use once you are approved.</p></div>
      <Tracking d={d} onEdit={() => nav('/owner/application?edit=1')} />
      <p className="text-sm text-muted">Open any page in the menu to look around. Adding or changing anything needs admin approval first.</p></div>
  );
}

/* ------------------------------------------------------------------ welcome + registration */
export function OwnerWelcomePage() {
  return (
    <Shell portal="owner">
      <h1 className="text-5xl font-extrabold">Venue owners</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Put your turf or court on PlaynX. Manage slots, pricing and bookings from one dashboard.</p>
      <div className="space-y-3">
        <Link to="/owner/register" className="card block p-5 transition hover:border-brand"><div className="text-xs font-bold uppercase tracking-widest text-[rgb(var(--brand-text))]">New here</div><div className="text-2xl font-bold">Register as Venue Owner</div><p className="text-sm text-muted">Create your account, verify your business and add your first venue.</p></Link>
        <Link to="/owner/login" className="card block p-5 transition hover:border-brand"><div className="text-xs font-bold uppercase tracking-widest text-muted">Already registered</div><div className="text-2xl font-bold">Venue Owner Login</div><p className="text-sm text-muted">Go to your dashboard or track your application.</p></Link>
      </div>
      <p className="mt-6 text-center text-sm text-muted">Looking to book a turf? <Link className="underline" to="/">Go to PlaynX</Link></p>
    </Shell>
  );
}

function Progress({ step, furthest, issues, onGo }: { step: number; furthest: number; issues: Set<number>; onGo(i: number): void }) {
  return (
    <ol className="mb-6 flex items-center gap-1 overflow-x-auto" aria-label="Registration progress">
      {STEPS.map((s, i) => {
        const done = i < step, cur = i === step, can = i <= furthest;
        return (
          <li key={s} className="flex flex-1 items-center gap-1" aria-current={cur ? 'step' : undefined}>
            <button type="button" aria-disabled={!can || undefined} onClick={() => onGo(i)} className={cx('flex min-w-0 flex-1 flex-col items-center gap-1', !can && 'opacity-60')}>
              <span className={cx('relative grid h-8 w-8 place-items-center rounded-full border-2 text-sm font-bold transition', cur ? 'border-brand bg-brand text-brand-ink' : done ? 'border-brand bg-brand/20 text-ink' : 'border-line text-muted')}>{done ? '✓' : i + 1}{issues.has(i) && !cur && <span aria-label="has missing items" className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-danger text-[10px] font-bold text-white">!</span>}</span>
              <span className={cx('truncate text-[11px] font-semibold', cur ? 'text-ink' : 'text-muted')}>{s}</span></button>
            {i < STEPS.length - 1 && <span className={cx('mb-4 h-0.5 w-full min-w-3 flex-1', done ? 'bg-brand' : 'bg-line')} aria-hidden="true" />}
          </li>);
      })}
    </ol>
  );
}

/** A venue owner who signed up with Google: the email came from Google; first name, last name, mobile and password are filled in here. */
export function OwnerCompleteSignupPage() {
  const { user, loading, setUser } = useAuth(); const nav = useNavigate();
  const parts = (user?.fullName ?? '').trim().split(/\s+/);
  const [f, setF] = useState({ firstName: parts[0] ?? '', lastName: parts.slice(1).join(' '), phone: '', password: '', confirm: '' });
  const [terms, setTerms] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/owner/login" replace />;
  if (user.role !== 'owner') return <Navigate to="/" replace />;
  if (user.credentialSet !== false) return <Navigate to="/owner" replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    const v: Record<string, string> = {};
    if (!f.firstName.trim() || !NAME_RE.test(f.firstName.trim())) v.firstName = 'Enter your first name using letters only';
    if (!f.lastName.trim() || !NAME_RE.test(f.lastName.trim())) v.lastName = 'Enter your last name using letters only';
    if (!isIndianMobile(f.phone.replace(/[\s-]/g, ''))) v.phone = MOBILE_MESSAGE;
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/[0-9]/.test(f.password)) v.password = 'At least 8 characters with a letter and a digit';
    if (f.confirm !== f.password) v.confirm = 'Passwords do not match';
    if (!terms) v.terms = 'Please accept the Terms and Conditions';
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const r = await post<{ user: any }>('/auth/complete-signup', { firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: f.phone.replace(/[\s-]/g, ''), newPassword: f.password, confirmPassword: f.confirm, acceptTerms: true });
      setUser(r.user); nav('/owner', { replace: true });
    } catch (err) { const fe = fieldErrors(err); if (Object.keys(fe).length) setErrs(fe); else setError(apiError(err)); } finally { setBusy(false); }
  };
  return (
    <Shell portal="owner" back={false}>
      <h1 className="text-4xl font-extrabold">Complete your account</h1>
      <p className="mb-5 mt-1 text-sm text-muted">You signed up with Google. Add these details to finish creating your venue owner account.</p>
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        <div className="grid gap-3 sm:grid-cols-2"><Input mandatory label="First Name" filter={FILTERS.personName} autoComplete="given-name" value={f.firstName} onChange={set('firstName')} error={errs.firstName} />
          <Input mandatory label="Last Name" filter={FILTERS.personName} autoComplete="family-name" value={f.lastName} onChange={set('lastName')} error={errs.lastName} /></div>
        <Input label="Email" value={user.email} readOnly hint="From your Google account" />
        <Input mandatory label="Mobile Number" filter={FILTERS.mobile} type="tel" autoComplete="tel" placeholder="+919876543210" value={f.phone} onChange={set('phone')} error={errs.phone} />
        <PasswordInput mandatory label="Password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errs.password ?? errs.newPassword} />
        <PasswordInput mandatory label="Confirm Password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errs.confirm ?? errs.confirmPassword} />
        <TermsCheckbox checked={terms} onChange={setTerms} error={errs.terms ?? errs.acceptTerms} />
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Create account & continue</Button>
      </form>
    </Shell>
  );
}

export function OwnerRegisterPage() {
  const { register, user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '', email: '', password: '', confirm: '' });
  const [terms, setTerms] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [show, setShow] = useState(false);
  // "I'm already registered in JusGo": carries on after a refresh while a JusGo sign-up is open
  const [jusgo, setJusgo] = useState(() => { try { return !!sessionStorage.getItem('playnx_jusgo_link'); } catch { return false; } });
  if (user) return <Navigate to={user.role === 'owner' ? '/owner' : '/'} replace />;
  if (jusgo) return <Shell portal="owner"><JusgoSignup onCancel={() => setJusgo(false)} /></Shell>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    const v: Record<string, string> = {};
    if (!f.firstName.trim() || !NAME_RE.test(f.firstName.trim())) v.firstName = 'Enter your first name using letters only';
    if (!f.lastName.trim() || !NAME_RE.test(f.lastName.trim())) v.lastName = 'Enter your last name using letters only';
    if (!isIndianMobile(f.phone.replace(/[\s-]/g, ''))) v.phone = MOBILE_MESSAGE;
    if (!/^\S+@\S+\.\S+$/.test(f.email)) v.email = 'Enter a valid email address';
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/[0-9]/.test(f.password)) v.password = 'At least 8 characters with a letter and a digit';
    if (f.confirm !== f.password) v.confirm = 'Passwords do not match';
    if (!terms) v.terms = 'Please accept the Terms and Conditions';
    setErrs(v); if (Object.keys(v).length) return;
    setBusy(true);
    try { await register({ fullName: `${f.firstName.trim()} ${f.lastName.trim()}`, email: f.email.trim(), phone: f.phone.replace(/[\s-]/g, ''), password: f.password, role: 'owner' }); nav('/owner/application', { replace: true }); }
    catch (err) { const fe = fieldErrors(err); if (Object.keys(fe).length) setErrs(fe); else setError(apiError(err)); } finally { setBusy(false); }
  };
  return (
    <Shell portal="owner">
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[rgb(var(--brand-text))]">Step 1 of 4 · Your details</p>
      <ChangeType />
      <h1 className="text-5xl font-extrabold">Register as Venue Owner</h1>
      <p className="mb-5 mt-1 text-sm text-muted">Next you'll verify your contact details and add your business and identity information. You can add your venues once your account is approved.</p>
      <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-brand/30 bg-brand/5 p-4 transition hover:border-brand/60">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]" checked={false} onChange={() => setJusgo(true)} />
        <span><b className="block">I'm already registered in JusGo</b><span className="text-sm text-muted">Bring your JusGo profile and onboarding details across. You'll need your email and JusGo Owner ID.</span></span>
      </label>
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        <div className="grid gap-3 sm:grid-cols-2"><Input mandatory label="First Name" filter={FILTERS.personName} autoComplete="given-name" value={f.firstName} onChange={set('firstName')} error={errs.firstName} />
          <Input mandatory label="Last Name" filter={FILTERS.personName} autoComplete="family-name" value={f.lastName} onChange={set('lastName')} error={errs.lastName} /></div>
        <Input mandatory label="Mobile Number" filter={FILTERS.mobile} type="tel" autoComplete="tel" placeholder="+919876543210" value={f.phone} onChange={set('phone')} error={errs.phone} />
        <Input mandatory label="Email" filter={FILTERS.email} type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errs.email} />
        <div className="relative"><Input mandatory label="Password" filter={FILTERS.password} type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={set('password')} error={errs.password} className="!pr-16" />
          <button type="button" aria-pressed={show} onClick={() => setShow((s) => !s)} className="absolute right-3 top-8 text-xs font-semibold text-muted hover:text-ink">{show ? 'Hide' : 'Show'}<span className="sr-only"> password</span></button></div>
        <Input mandatory label="Confirm Password" filter={FILTERS.password} type={show ? 'text' : 'password'} autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errs.confirm} />
        <TermsCheckbox checked={terms} onChange={setTerms} error={errs.terms} />
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Create account & continue</Button>
      </form>
      <GoogleSignIn text="signup_with" role="owner" />
      <p className="mt-4 text-center text-sm text-muted">Already registered? <Link className="font-semibold text-[rgb(var(--brand-text))]" to="/owner/login">Venue owner login</Link></p>
    </Shell>
  );
}

/* ------------------------------------------------------------------ small building blocks */
type Existing = { id: string; status: string; note?: string | null } | undefined;
/** Upload slot with image preview, progress bar, type/size validation, and "view" for what is already stored. */
function DocSlot({ label, hint, existing, uploadUrl, fields, viewPath, accept = 'image/jpeg,image/png,application/pdf', disabled, onDone, optional, fieldKey, capture, camera, maxMB = 10 }: {
  fieldKey?: string; capture?: 'user' | 'environment'; camera?: boolean; maxMB?: number;
  label: string; hint?: string; existing?: Existing; uploadUrl: string; fields: Record<string, string>; viewPath?(id: string): string; accept?: string; disabled?: boolean; onDone(): void; optional?: boolean;
}) {
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; image: boolean } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState(''); const [camOpen, setCamOpen] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const choose = async (file?: File) => {
    if (!file) return; setErr('');
    const image = file.type.startsWith('image/');
    const kinds = accept.split(',').map((t) => (t === 'application/pdf' ? 'PDF' : t.replace('image/', '').toUpperCase())).filter((k, i, a) => a.indexOf(k) === i).join(', ').replace('JPEG', 'JPG');
    if (!accept.split(',').includes(file.type)) return setErr(`Unsupported file type. Use ${kinds}.`);
    if (file.size > maxMB * 1024 * 1024) return setErr(`File too large (max ${maxMB} MB)`);
    setPreview({ url: URL.createObjectURL(file), name: file.name, image }); setProgress(0);
    try {
      const fd = new FormData(); Object.entries(fields).forEach(([k, v]) => fd.append(k, v)); fd.append('file', file);
      await api.post(uploadUrl, fd, { timeout: 120000, onUploadProgress: (e) => setProgress(Math.round((e.loaded / (e.total || file.size)) * 100)) });
      toast(`${label} uploaded`); onDone();
    } catch (e) { setErr(apiError(e)); setPreview(null); } finally { setProgress(null); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div data-field={fieldKey} className={cx('rounded-xl border p-3', existing?.status === 'rejected' ? 'border-danger/50' : 'border-line')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className={cx('text-sm font-semibold', !optional && STAR)}>{label}{optional && <span className="ml-1 text-xs font-normal text-muted">(optional)</span>}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
        <div className="flex items-center gap-2">
          {existing && <Badge status={existing.status === 'rejected' ? 'rejected' : existing.status === 'approved' ? 'approved' : 'pending'}>{existing.status === 'approved' ? 'Verified' : existing.status === 'rejected' ? 'Rejected' : 'Uploaded'}</Badge>}
          {existing && viewPath && <FileLink path={viewPath(existing.id)}>View</FileLink>}
          <input ref={ref} type="file" hidden accept={accept} {...(capture ? { capture } : {})} onChange={(e) => choose(e.target.files?.[0])} aria-label={`Upload ${label}`} />
          {camera && <Button type="button" className="!py-1.5" disabled={disabled || progress !== null} onClick={() => setCamOpen(true)}>{existing ? 'Retake photo' : 'Take photo'}</Button>}
          {!camera && <Button type="button" variant="ghost" className="!py-1.5" disabled={disabled || progress !== null} onClick={() => ref.current?.click()}>{existing ? 'Replace' : 'Upload'}</Button>}
        </div>
      </div>
      {camera && <FaceCamera open={camOpen} onClose={() => setCamOpen(false)} onCapture={(f) => void choose(f)} />}
      {existing?.status === 'rejected' && existing.note && <p role="alert" className="mt-2 text-xs text-danger">Reviewer: {existing.note}</p>}
      {preview && <div className="mt-2 flex items-center gap-3">{preview.image ? <img src={preview.url} alt="Preview of selected file" className="h-14 w-14 rounded-lg object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-lg bg-surface2 text-2xl" aria-hidden="true">📄</span>}
        <div className="min-w-0 flex-1 text-xs"><div className="truncate font-medium">{preview.name}</div>{progress !== null && <div className="mt-1 h-1.5 rounded-full bg-surface2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-1.5 rounded-full bg-brand transition-all" style={{ width: `${progress}%` }} /></div>}</div></div>}
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}

function StepNav({ onBack, onNext, nextLabel = 'Save & continue', busy, disabled, hint }: { onBack?(): void; onNext(): void; nextLabel?: string; busy?: boolean; disabled?: boolean; hint?: string }) {
  return <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">{onBack ? <Button type="button" variant="ghost" onClick={onBack}>← Previous</Button> : <span />}
    <div className="flex items-center gap-3">{hint && <span className="text-xs text-warn">{hint}</span>}<Button type="button" onClick={onNext} loading={busy} disabled={disabled}>{nextLabel}</Button></div></div>;
}

/* ------------------------------------------------------------------ step 1: verify contact */
function VerifyStep({ d, refresh, next, focus }: { d: AppData; refresh(): void; next(): void; focus?: string | null }) {
  useFocusField(focus);
  const { toast } = useToast(); const { refresh: refreshUser } = useAuth();
  const [otpErr, setOtpErr] = useState<Record<string, string>>({}); const [info, setInfo] = useState('');
  const [sent, setSent] = useState<Record<string, boolean>>({}); const [code, setCode] = useState<Record<string, string>>({ email: '', phone: '' }); const [busy, setBusy] = useState('');
  const photo = d.documents.find((x: any) => x.docType === 'profile_photo');
  const send = async (channel: 'email' | 'phone') => { setBusy(`s${channel}`); setOtpErr({}); setInfo(''); try { await post('/auth/otp/send', { channel }); setSent({ ...sent, [channel]: true }); toast(`Code sent to your ${channel === 'email' ? 'email' : 'mobile'}`); } catch (e) { const m = apiError(e); if (/wait 30 seconds/i.test(m)) { setSent((x) => ({ ...x, [channel]: true })); setInfo(`A code was already sent to your ${channel === 'email' ? 'email' : 'mobile'}. Enter it in the box (check spam too). You can ask for a new one in 30 seconds.`); } else setOtpErr((x) => ({ ...x, [channel]: m })); } finally { setBusy(''); } };
  const verify = async (channel: 'email' | 'phone') => { setBusy(`v${channel}`); setOtpErr({}); try { await post('/auth/otp/verify', { channel, code: code[channel] }); await refreshUser(); refresh(); toast('Verified'); } catch (e) { setOtpErr((x) => ({ ...x, [channel]: apiError(e) })); } finally { setBusy(''); } };
  const rows: { ch: 'email' | 'phone'; label: string; value: string | null; ok: boolean; available: boolean; required: boolean }[] = [
    { ch: 'email', label: 'Email', value: d.contact.email, ok: d.contact.emailVerified, available: true, required: true },
    { ch: 'phone', label: 'Mobile', value: d.contact.phone, ok: d.contact.phoneVerified, available: d.contact.phoneOtpAvailable && !!d.contact.phone, required: d.contact.phoneRequired }];
  const ready = d.contact.emailVerified && (!d.contact.phoneRequired || d.contact.phoneVerified);
  return (
    <div><h2 className="text-3xl font-bold">Verify your contact details</h2><p className="mb-4 text-sm text-muted">We confirm it's really you with a 6-digit code. Press <b>Send email OTP</b>, type the code in the box and press <b>Verify</b>.  You can't continue until your email is verified.</p>
      <div className="space-y-3">{rows.filter((r) => r.required || r.value).map((r) => ( // an optional mobile that was never added has nothing to verify, so no box is shown for it
        <div key={r.ch} data-field={r.ch} className="rounded-xl border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className={cx('text-xs uppercase text-muted', r.required && STAR)}>{r.label}{!r.required && ' (optional)'}</div><div className="font-semibold">{r.value ?? 'Not added'}</div></div>
          {r.ok ? <Badge status="verified" /> : !r.available ? <span className="text-xs text-muted">{r.value ? 'SMS verification is not available yet' : ''}</span> : (
            <div className="flex flex-wrap items-center gap-2">{<input className="field !w-32 !py-1.5 text-center tracking-widest" inputMode="numeric" maxLength={6} placeholder="000000" aria-label={`${r.label} code`} value={code[r.ch]} onChange={(e) => setCode({ ...code, [r.ch]: e.target.value.replace(/\D/g, '') })} />}
              {<Button type="button" className="!py-1.5" disabled={code[r.ch].length !== 6} loading={busy === `v${r.ch}`} onClick={() => verify(r.ch)}>Verify</Button>}
              <Button type="button" variant="ghost" className="!py-1.5" loading={busy === `s${r.ch}`} onClick={() => send(r.ch)}>{sent[r.ch] ? 'Resend code' : `Send ${r.ch === 'email' ? 'email' : 'mobile'} OTP`}</Button></div>)}</div></div>))}
        {info && <p role="status" className="rounded-xl bg-brand/10 px-3 py-2 text-sm">{info}</p>}
        {Object.entries(otpErr).map(([ch, m]) => <p key={ch} role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{ch === 'email' ? 'Email' : 'Mobile'}: {m}</p>)}
      </div>
      <StepNav onNext={next} nextLabel="Continue" disabled={!ready} hint={!ready ? 'Verify your email to continue' : undefined} />
    </div>
  );
}

/* ------------------------------------------------------------------ step 2: personal details */
const COUNTRIES = ['India', 'Nepal', 'Bhutan', 'Sri Lanka', 'Bangladesh', 'United Arab Emirates', 'Other'];
/** Who the owner is and where the turf is. The business and identity steps start from these answers, so nothing is typed twice. */
function PersonalStep({ d, refresh, back, next, focus }: { d: AppData; refresh(): void; back(): void; next(): void; focus?: string | null }) {
  useFocusField(focus);
  const { user, refresh: refreshUser } = useAuth();
  // an account made with Google has no password of its own yet: it is chosen here, so email + password works too
  const needPassword = d.personal?.passwordSet === false || user?.credentialSet === false;
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const b = d.business;
  const [f, setF] = useState({ legalName: b.representativeName ?? user?.fullName ?? '', dob: b.dob ?? '', phone: b.phone ?? d.contact.phone ?? '', addressLine1: b.address ?? '', addressLine2: b.addressLine2 ?? '', state: b.state ?? '', city: b.city ?? '', pincode: b.pincode ?? '', country: b.country ?? 'India' });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [error, setError] = useState('');
  const photo = d.documents.find((x: any) => x.docType === 'profile_photo');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () => {
      if (needPassword) { await post('/auth/set-password', { newPassword: pw.password, confirmPassword: pw.confirm }); await refreshUser(); }
      return put('/owner/application/personal', { legalName: f.legalName.trim(), dob: f.dob, phone: f.phone.replace(/[\s-]/g, ''), addressLine1: f.addressLine1.trim(), ...(f.addressLine2.trim() ? { addressLine2: f.addressLine2.trim() } : {}), state: f.state, city: f.city.trim(), pincode: f.pincode.trim(), country: f.country });
    },
    onSuccess: () => { refresh(); next(); }, onError: (e) => { const fe = fieldErrors(e); if (Object.keys(fe).length) setErrs(fe); else setError(apiError(e)); },
  });
  const go = () => {
    setError(''); const v: Record<string, string> = {};
    if (needPassword) {
      if (pw.password.length < 8 || !/[A-Za-z]/.test(pw.password) || !/\d/.test(pw.password)) v.password = 'Use at least 8 characters with a letter and a digit.';
      if (!pw.confirm) v.confirm = 'Confirm your password'; else if (pw.confirm !== pw.password) v.confirm = 'Passwords do not match';
    }
    if (f.legalName.trim().length < 2 || !NAME_RE.test(f.legalName.trim())) v.legalName = 'Use letters only, exactly as on your ID';
    const born = f.dob ? new Date(`${f.dob}T00:00:00Z`) : null; const lim = new Date(); lim.setUTCFullYear(lim.getUTCFullYear() - 18);
    if (!born || Number.isNaN(+born)) v.dob = 'Enter your date of birth'; else if (born > lim) v.dob = 'You must be at least 18 years old';
    if (!PHONE_RE10.test(f.phone.replace(/[\s-]/g, ''))) v.phone = MOBILE_MESSAGE;
    if (f.addressLine1.trim().length < 5) v.addressLine1 = 'Enter the address';
    if (!f.state) v.state = 'Select the state'; if (f.state && f.city.trim().length < 2) v.city = 'Select the city';
    if (!/^[1-9][0-9]{5}$/.test(f.pincode.trim())) v.pincode = 'Enter a valid 6-digit PIN code';
    setErrs(v); if (Object.keys(v).length === 0) save.mutate();
  };
  return (
    <div><h2 className="text-3xl font-bold">Personal details</h2><p className="mb-4 text-sm text-muted">Tell us about yourself and where your turf is located. The next steps start from these answers, so you will not type them again.</p>
      <div className="space-y-3.5">
        <DocSlot label="Profile Photo" hint="Optional. JPG or PNG, up to 5 MB." optional maxMB={5} accept="image/jpeg,image/png" existing={photo} uploadUrl="/owner/application/documents" fields={{ docType: 'profile_photo' }} viewPath={(id) => `/owner/application/documents/${id}/file`} onDone={refresh} />
        <Input mandatory data-field="legalName" filter={FILTERS.personName} label="Legal Full Name" autoComplete="name" value={f.legalName} onChange={set('legalName')} error={errs.legalName} hint="Exactly as it appears on your government ID" />
        <div className="grid gap-3 sm:grid-cols-2"><Input mandatory data-field="dob" label="Date of Birth" type="date" value={f.dob} onChange={set('dob')} error={errs.dob} />
          <Input mandatory data-field="phone" filter={FILTERS.mobile} label="Phone Number" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} error={errs.phone} placeholder="9876543210" /></div>
        <h3 className="pt-1 text-lg font-bold">Turf / venue address</h3>
        <Textarea mandatory data-field="addressLine1" label="Address Line 1" value={f.addressLine1} onChange={set('addressLine1')} error={errs.addressLine1} rows={2} placeholder="Building, street and area" />
        <Input label="Address Line 2" value={f.addressLine2} onChange={set('addressLine2')} placeholder="Apartment, landmark, area (optional)" />
        <StateCityFields state={f.state} city={f.city} errors={{ state: errs.state, city: errs.city }} onChange={(v) => setF({ ...f, ...v })} />
        <div className="grid gap-3 sm:grid-cols-2"><Input mandatory data-field="pincode" filter={FILTERS.pincode} label="PIN / Postal Code" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set('pincode')} error={errs.pincode} placeholder="560038" />
          <Select mandatory label="Country" value={f.country} onChange={set('country')}>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>
        {needPassword && <fieldset className="space-y-3 rounded-xl border border-line p-3"><legend className="px-1 text-sm font-bold">Create your password</legend>
          <p className="text-xs text-muted">You signed up with Google. Choose a password too, so you can also sign in with your email and password.</p>
          <div className="grid gap-3 sm:grid-cols-2"><PasswordInput mandatory data-field="password" label="Password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} error={errs.password} />
            <PasswordInput mandatory label="Confirm password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={errs.confirm} /></div></fieldset>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <StepNav onBack={back} onNext={go} busy={save.isPending} />
    </div>
  );
}

/** Details given on the Personal details page are filled in on later pages but cannot be changed there: edit them where they were first entered. */
function usePersonalLocks(d: AppData) {
  const own = d.personal?.done === true; const b = d.business;
  return {
    name: own && !!b.representativeName, dob: own && !!b.dob, phone: own && !!b.phone, line2: own && !!b.addressLine2, country: own && !!b.country,
    place: own && !!b.address && !!b.state && !!b.city && !!b.pincode,
  };
}
const ro = (on: boolean) => (on ? { readOnly: true, 'aria-readonly': true as const } : {});
function LockedNotice({ show, onEdit }: { show: boolean; onEdit(): void }) {
  if (!show) return null;
  return <div role="note" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface2/60 px-3 py-2 text-sm"><span>🔒 Details you already gave in <b>Personal details</b> are filled in here and can't be changed on this page.</span>
    <button type="button" onClick={onEdit} className="font-semibold underline">Edit them in Personal details</button></div>;
}

/* ------------------------------------------------------------------ step 2: business */
type Partner = { name: string; pan: string; aadhaar: string; phone: string };
/**
 * The business section of the application. Also used after approval to ask for a business type change:
 * then `submit` sends the details for review instead of saving them, and `title` / `nextLabel` change the wording.
 */
export function BusinessStep({ d, refresh, back, next, focus, toPersonal, submit, title, nextLabel }: { d: AppData; refresh(): void; back?(): void; next(): void; focus?: string | null; toPersonal(): void; submit?(body: Record<string, unknown>): Promise<unknown>; title?: string; nextLabel?: string }) {
  useFocusField(focus);
  const b = d.business; const lk = usePersonalLocks(d);
  const [type, setType] = useState<string>(b.type ?? '');
  const [f, setF] = useState({ businessName: b.name && b.name !== d.owner.fullName ? b.name : '', pan: '', address: b.address ?? '', state: b.state ?? '', city: b.city ?? '', pincode: b.pincode ?? '', representativeName: b.representativeName ?? d.owner.fullName ?? '', designation: b.designation ?? '', registrationNumber: b.registrationNumber ?? '', gstin: b.gstin ?? '',
    dob: b.dob ?? '', phone: b.phone ?? '', udyamNumber: b.udyamNumber ?? '', otherInfo: b.otherInfo ?? '' });
  const [partners, setPartners] = useState<Partner[]>(() => (b.partners?.length ? b.partners.map((p: any) => ({ name: p.name, pan: p.pan, aadhaar: '', phone: p.phone })) : [{ name: '', pan: '', aadhaar: '', phone: '' }]));
  const [errs, setErrs] = useState<Record<string, string>>({}); const [error, setError] = useState('');
  const jus = JUSGO_TYPES.includes(type);
  const lab = LABELS[type] ?? LABELS.partnership;
  const choices = [...BUSINESS_TYPES, ...LEGACY_TYPES.filter((t) => t.id === b.type)];
  // Reasons our reviewers gave for specific fields, shown right at the field until it is fixed and resubmitted.
  const flags: Record<string, string> = Object.fromEntries((d.correction?.items ?? []).filter((i: any) => i.type === 'field').map((i: any) => [i.key, i.reason || 'Our reviewer flagged this field']));
  const why = (k: string) => errs[k] ?? (flags[k] ? `Reviewer: ${flags[k]}` : undefined);
  const send = (body: Record<string, unknown>) => (submit ? submit(body) : put('/owner/application/business', body));
  const save = useMutation({
    mutationFn: () => {
      const common = { businessType: type, ...(f.pan ? { pan: f.pan.trim().toUpperCase() } : {}), address: f.address.trim(), state: f.state, city: f.city.trim(), pincode: f.pincode.trim(), representativeName: f.representativeName.trim(), ...(f.gstin ? { gstin: f.gstin.trim().toUpperCase() } : {}) };
      if (type === 'individual') return send({ ...common, dob: f.dob, phone: f.phone.replace(/[\s-]/g, '') });
      if (type === 'sole_proprietorship') return send({ ...common, businessName: f.businessName.trim(), phone: f.phone.replace(/[\s-]/g, ''), ...(f.udyamNumber ? { udyamNumber: f.udyamNumber.trim().toUpperCase() } : {}), ...(f.otherInfo.trim() ? { otherInfo: f.otherInfo.trim() } : {}) });
      if (type === 'partnership_pvt_ltd') return send({ ...common, businessName: f.businessName.trim(), phone: f.phone.replace(/[\s-]/g, ''), ...(f.registrationNumber ? { registrationNumber: f.registrationNumber.trim().toUpperCase() } : {}),
        partners: partners.map((p) => ({ name: p.name.trim(), pan: p.pan.trim().toUpperCase(), aadhaar: p.aadhaar.replace(/\s/g, ''), phone: p.phone.replace(/[\s-]/g, '') })) });
      return send({ ...common, businessName: f.businessName.trim(),
        ...(['partnership', 'opc', 'llp', 'trust_society', 'private_limited'].includes(type) && f.designation ? { designation: f.designation.trim() } : {}), ...(['private_limited', 'opc', 'llp', 'trust_society'].includes(type) ? { registrationNumber: f.registrationNumber.trim().toUpperCase() } : {}) });
    },
    onSuccess: () => { refresh(); next(); }, onError: (e) => { const fe = fieldErrors(e); if (Object.keys(fe).length) setErrs(fe); else setError(apiError(e)); }, // the server's reason goes next to the field it is about
  });
  const go = () => {
    setError(''); const v: Record<string, string> = {};
    if (!type) v.type = 'Choose your business type';
    if (type !== 'individual' && f.businessName.trim().length < 2) v.businessName = type === 'sole_proprietorship' ? 'Enter the business or trade name' : jus ? 'Enter the registered business name' : `Enter the ${lab.name.toLowerCase()}`;
    if (!(f.pan ? PAN_RE.test(f.pan.trim().toUpperCase()) : b.hasPan)) v.pan = 'Enter a valid PAN, e.g. ABCDE1234F';
    if (f.address.trim().length < 5) v.address = 'Enter the address';
    if (!f.state) v.state = 'Select the state';
    if (f.state && f.city.trim().length < 2) v.city = 'Select the city';
    if (!/^[1-9][0-9]{5}$/.test(f.pincode.trim())) v.pincode = 'Enter a valid 6-digit PIN code';
    if (f.representativeName.trim().length < 2 || !NAME_RE.test(f.representativeName.trim())) v.representativeName = 'Use letters only';
    if (jus) {
      if (!PHONE_RE10.test(f.phone.replace(/[\s-]/g, ''))) v.phone = MOBILE_MESSAGE;
      if (f.gstin && !GST_RE.test(f.gstin.trim().toUpperCase())) v.gstin = 'Enter a valid 15-character GST number';
      if (type === 'individual') { const t = f.dob ? new Date(`${f.dob}T00:00:00Z`) : null; const lim = new Date(); lim.setUTCFullYear(lim.getUTCFullYear() - 18); if (!t || Number.isNaN(+t)) v.dob = 'Enter your date of birth'; else if (t > lim) v.dob = 'You must be at least 18 years old'; }
      if (type === 'sole_proprietorship' && f.udyamNumber && !UDYAM_RE.test(f.udyamNumber.trim().toUpperCase())) v.udyamNumber = 'Enter a valid Udyam number, e.g. UDYAM-TN-00-0000000';
      if (type === 'partnership_pvt_ltd') {
        if (f.registrationNumber && !CIN_RE.test(f.registrationNumber.trim().toUpperCase())) v.registrationNumber = 'Enter a valid 21-character CIN, e.g. U74999TN2018PTC123456';
        partners.forEach((p, i) => {
          if (p.name.trim().length < 2 || !NAME_RE.test(p.name.trim())) v[`partner${i}.name`] = 'Enter the name (letters only)';
          if (!PAN_RE.test(p.pan.trim().toUpperCase())) v[`partner${i}.pan`] = 'Enter a valid PAN';
          if (!/^[0-9]{12}$/.test(p.aadhaar.replace(/\s/g, ''))) v[`partner${i}.aadhaar`] = 'Enter the 12-digit Aadhaar number';
          if (!PHONE_RE10.test(p.phone.replace(/[\s-]/g, ''))) v[`partner${i}.phone`] = 'Enter a valid contact number';
        });
      }
    } else {
      if (['partnership', 'private_limited', 'trust_society'].includes(type) && f.designation.trim().length < 2) v.designation = 'Enter the designation';
      if (['private_limited', 'opc'].includes(type) && !CIN_RE.test(f.registrationNumber.trim().toUpperCase())) v.registrationNumber = 'Enter a valid 21-character CIN, e.g. U74999TN2018PTC123456';
      if (type === 'trust_society' && !TRUST_RE.test(f.registrationNumber.trim().toUpperCase())) v.registrationNumber = 'Enter the registration number exactly as on the certificate, e.g. 123/2018';
      if (type === 'llp' && !LLPIN_RE.test(f.registrationNumber.trim().toUpperCase())) v.registrationNumber = 'Enter a valid LLPIN, e.g. AAB-1234';
    }
    setErrs(v); if (Object.keys(v).length === 0) save.mutate();
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const setPartner = (i: number, k: keyof Partner, val: string) => setPartners((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: val } : p)));
  const panField = (label: string) => <Input mandatory data-field="pan" filter={FILTERS.pan} label={label} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} error={why('pan')} maxLength={10} placeholder="e.g. ABCDE1234F" hint={b.hasPan ? `Saved as ${b.panMasked}. Type a new PAN only if you want to change it.` : 'Shown masked after saving'} />;
  const place = (addrLabel: string) => (<>
    <Textarea {...ro(lk.place)} mandatory data-field="address" label={addrLabel} value={f.address} onChange={set('address')} error={why('address')} rows={2} placeholder="Building, street and area" />
    <StateCityFields locked={lk.place} state={f.state} city={f.city} errors={{ state: why('state'), city: why('city') }} onChange={(v) => setF({ ...f, ...v })} />
    <div className="max-w-[12rem]"><Input {...ro(lk.place)} mandatory data-field="pincode" label="PIN code" filter={FILTERS.pincode} inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value.replace(/\D/g, '') })} error={why('pincode')} placeholder="560038" /></div></>);
  const gst = <Input data-field="gstin" filter={FILTERS.gst} label="GST Number (optional)" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} error={why('gstin')} placeholder="22AAAAA0000A1Z5" />;
  const phoneField = (label: string) => <Input {...ro(lk.phone)} mandatory data-field="phone" filter={FILTERS.mobile} label={label} type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} error={why('phone')} placeholder="9876543210" />;
  return (
    <div>{title !== '' && <h2 className="text-3xl font-bold">{title ?? 'Business information'}</h2>}<p className="mb-4 text-sm text-muted">Choose how your business is registered, then fill in the details for it.</p>
      <LockedNotice show={lk.name || lk.dob || lk.phone || lk.place} onEdit={toPersonal} />
      <fieldset><legend className={cx('mb-2 text-xs font-semibold uppercase tracking-wide text-muted', STAR)}>Select your account type</legend>
        <div data-field="businessType" role="radiogroup" aria-label="Business type" className="grid gap-2 md:grid-cols-3">{choices.map((t) => (
          <button type="button" key={t.id} role="radio" aria-checked={type === t.id} onClick={() => setType(t.id)} className={cx('rounded-xl border-2 p-3 text-left transition', type === t.id ? 'border-brand bg-brand/10' : 'border-line hover:border-brand/50')}><div className="font-bold">{t.label}</div><div className="text-xs text-muted">{t.desc}</div></button>))}</div>
        {(errs.type || why('businessType')) && <p role="alert" className="mt-1 text-xs text-danger">{errs.type ?? why('businessType')}</p>}</fieldset>
      {type === 'individual' && (<div className="mt-5 space-y-3.5">
        <Input {...ro(lk.name)} mandatory data-field="representativeName" label="Full Legal Name" filter={FILTERS.personName} value={f.representativeName} onChange={set('representativeName')} error={why('representativeName')} hint="Exactly as on your government ID" />
        {panField('PAN Number')}
        <Input {...ro(lk.dob)} mandatory data-field="dob" label="Date of Birth" type="date" value={f.dob} onChange={set('dob')} error={why('dob')} />
        {place('Residential Address')}
        {phoneField('Phone Number')}
        <p className="text-xs text-muted">Your PAN card, identity proof and address proof are uploaded in the next step.</p></div>)}
      {type === 'sole_proprietorship' && (<div className="mt-5 space-y-3.5">
        <Input {...ro(lk.name)} mandatory data-field="representativeName" label="Proprietor's Full Legal Name" filter={FILTERS.personName} value={f.representativeName} onChange={set('representativeName')} error={why('representativeName')} />
        <Input mandatory data-field="businessName" label="Business or Trade Name" filter={FILTERS.businessName} value={f.businessName} onChange={set('businessName')} error={why('businessName')} />
        {panField('PAN Number')}
        {place('Residential or Registered Business Address')}
        {phoneField('Phone Number')}
        {gst}
        <Input data-field="udyamNumber" filter={FILTERS.udyam} label="Udyam / MSME Number (optional)" value={f.udyamNumber} onChange={(e) => setF({ ...f, udyamNumber: e.target.value.toUpperCase() })} error={why('udyamNumber')} placeholder="UDYAM-XX-00-0000000" />
        <Textarea data-field="otherInfo" label="Other Business Information (optional)" value={f.otherInfo} onChange={set('otherInfo')} rows={2} />
        <p className="text-xs text-muted">Your PAN card, identity proof and address proof are uploaded in the next step.</p></div>)}
      {type === 'partnership_pvt_ltd' && (<div className="mt-5 space-y-3.5">
        <Input mandatory data-field="businessName" label="Registered Business Name" filter={FILTERS.businessName} value={f.businessName} onChange={set('businessName')} error={why('businessName')} />
        {panField('Business PAN Number')}
        {place('Registered Business Address')}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input {...ro(lk.name)} mandatory data-field="representativeName" label="Authorized Person's Full Name" filter={FILTERS.personName} value={f.representativeName} onChange={set('representativeName')} error={why('representativeName')} />
          {phoneField("Authorized Person's Phone Number")}</div>
        <Input data-field="registrationNumber" filter={FILTERS.cin} label="CIN (optional, Private Limited Company only)" value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value.toUpperCase() })} error={why('registrationNumber')} placeholder="U74999TN2018PTC123456" />
        {gst}
        <fieldset data-field="partners" className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-bold">Partner / Director Details *</legend>
          {why('partners') && <p role="alert" className="text-xs text-danger">{why('partners')}</p>}
          {partners.map((p, i) => (<div key={i} className="mb-3 rounded-lg bg-surface/50 p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">Partner / Director {i + 1}</span>
              {partners.length > 1 && <button type="button" className="text-xs font-semibold text-danger" onClick={() => setPartners((ps) => ps.filter((_, j) => j !== i))}>Remove</button>}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input mandatory label="Name" filter={FILTERS.personName} value={p.name} onChange={(e) => setPartner(i, 'name', e.target.value)} error={errs[`partner${i}.name`]} placeholder="Enter partner / director's full name" />
              <Input mandatory label="PAN" filter={FILTERS.pan} value={p.pan} maxLength={10} onChange={(e) => setPartner(i, 'pan', e.target.value.toUpperCase())} error={errs[`partner${i}.pan`]} placeholder="ABCDE1234F" />
              <Input mandatory label="Aadhaar" filter={FILTERS.aadhaar} inputMode="numeric" maxLength={12} value={p.aadhaar} onChange={(e) => setPartner(i, 'aadhaar', e.target.value.replace(/\D/g, ''))} error={errs[`partner${i}.aadhaar`]} placeholder="e.g. 123456789012" hint={b.partners?.[i]?.aadhaarLast4 ? `Saved as •••• •••• ${b.partners[i].aadhaarLast4}. Re-enter the number to save changes. Only the last 4 digits are kept.` : 'Only the last 4 digits are kept'} />
              <Input mandatory label="Contact Number" filter={FILTERS.mobile} type="tel" inputMode="tel" value={p.phone} onChange={(e) => setPartner(i, 'phone', e.target.value)} error={errs[`partner${i}.phone`]} placeholder="9876543210" /></div></div>))}
          {partners.length < 20 && <button type="button" className="text-sm font-semibold underline" onClick={() => setPartners((ps) => [...ps, { name: '', pan: '', aadhaar: '', phone: '' }])}>+ Add Partner / Director</button>}</fieldset>
        <p className="text-xs text-muted">Your PAN card, identity proof, address proof and the authorization letter are uploaded in the next step.</p></div>)}
      {type && !jus && (<div className="mt-5 space-y-3.5">
        <Input mandatory data-field="businessName" label={lab.name} value={f.businessName} onChange={set('businessName')} error={why('businessName')} />
        {['private_limited', 'opc', 'llp', 'trust_society'].includes(type) && <Input mandatory data-field="registrationNumber" label={type === 'llp' ? 'LLPIN' : type === 'trust_society' ? 'Registration number' : 'CIN'} value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value.toUpperCase() })} error={why('registrationNumber')} placeholder={type === 'llp' ? 'AAB-1234' : type === 'trust_society' ? 'Society registration no., e.g. 123/2018' : type === 'opc' ? 'U74999TN2018OPC123456' : 'U12345KA2020PTC123456'} />}
        {panField(lab.pan)}
        <div className="grid gap-3 sm:grid-cols-2"><Input {...ro(lk.name)} mandatory data-field="representativeName" label={lab.rep} value={f.representativeName} onChange={set('representativeName')} error={why('representativeName')} />
          <Input mandatory={type !== 'opc' && type !== 'llp'} data-field="designation" label="Designation" value={f.designation} onChange={set('designation')} error={why('designation')} /></div>
        {place(lab.addr)}{gst}</div>)}
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <StepNav onBack={back} onNext={go} busy={save.isPending} nextLabel={nextLabel} />
    </div>
  );
}

/* ------------------------------------------------------------------ step 3: identity */
/** JusGo's Documents step: the Aadhaar card number and a copy of the Aadhaar card / government ID. (The PAN is typed once, on the account type page.) */
function IdentityStep({ d, refresh, back, next, focus }: { d: AppData; refresh(): void; back(): void; next(): void; focus?: string | null }) {
  useFocusField(focus);
  const type: string = d.business.type ?? '';
  const holder = type === 'sole_proprietorship' ? "Proprietor's" : type && type !== 'individual' ? "Authorized person's" : '';
  const numberLabel = holder ? `${holder} Aadhaar` : 'Aadhaar Card Number'; // "Proprietor's Aadhaar" / "Authorized person's Aadhaar"
  const saved: string | null = d.identity.aadhaarMasked ?? null;
  const [aadhaar, setAadhaar] = useState(''); const [error, setError] = useState(''); const [numErr, setNumErr] = useState('');
  const flagged = (d.correction?.items ?? []).find((i: any) => i.type === 'field' && i.key === 'identity');
  const proof = (d.documents as any[]).find((x) => x.docType === 'identity_proof');
  const save = useMutation({
    mutationFn: () => put('/owner/application/identity', aadhaar ? { aadhaarNumber: aadhaar.replace(/\s/g, '') } : {}),
    onSuccess: () => { refresh(); next(); }, onError: (e) => { const fe = fieldErrors(e); if (fe.aadhaarNumber) setNumErr(fe.aadhaarNumber); else setError(apiError(e)); },
  });
  const go = () => {
    setError(''); setNumErr('');
    if (!aadhaar && !saved) return setNumErr('Enter the 12-digit Aadhaar number');
    if (aadhaar && !/^[0-9]{12}$/.test(aadhaar.replace(/\s/g, ''))) return setNumErr('Enter the 12-digit Aadhaar number');
    if (!proof || proof.status === 'rejected') return setError('Aadhaar / Government ID Copy is required');
    save.mutate();
  };
  return (
    <div><h2 className="text-3xl font-bold">Documents</h2><p className="mb-4 text-sm text-muted">Upload clear copies of your documents. PDF, JPG, JPEG or PNG, up to 10 MB each.</p>
      <div className="space-y-3.5 rounded-2xl border border-line p-4"><h3 className="text-xl font-bold">Identity documents</h3>
        <Input mandatory data-field="identity" label={numberLabel} filter={FILTERS.aadhaar} inputMode="numeric" maxLength={12} value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ''))} error={numErr || (flagged && !aadhaar ? `Reviewer: ${flagged.reason || 'Please check the Aadhaar number'}` : undefined)} placeholder="123456789012"
          hint={saved ? `Saved as ${saved}. Type it again only if you want to change it.` : 'The 12-digit number on the Aadhaar card. Only the last 4 digits are kept.'} />
        <DocSlot fieldKey="identity_proof" label="Aadhaar / Government ID Copy" hint="PDF, JPG, JPEG or PNG, up to 10 MB" existing={proof} uploadUrl="/owner/application/documents" fields={{ docType: 'identity_proof' }} viewPath={(id) => `/owner/application/documents/${id}/file`} onDone={refresh} /></div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <StepNav onBack={back} onNext={go} busy={save.isPending} />
    </div>
  );
}

function SelfVerificationStep({ d, refresh, back, next, focus }: { d: AppData; refresh(): void; back(): void; next(): void; focus?: string | null }) {
  useFocusField(focus);
  const find = (t: string) => (d.documents as any[]).find((x) => x.docType === t); const [error, setError] = useState('');
  return (
    <div><h2 className="text-3xl font-bold">Self verification</h2><p className="mb-4 text-sm text-muted">Take a clear, well-lit photo of your face so our team can match it with your ID. Face the camera, remove sunglasses or masks, and make sure your whole face is visible.</p>
      <DocSlot fieldKey="self_verification" label="Your verification photo" hint="Opens your camera (front camera on a phone). The photo must be taken live; files cannot be uploaded." camera capture="user" accept="image/jpeg,image/png,image/webp" existing={find('self_verification')} uploadUrl="/owner/application/documents" fields={{ docType: 'self_verification' }} viewPath={(id) => `/owner/application/documents/${id}/file`} onDone={refresh} />
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <StepNav onBack={back} onNext={() => { const p = find('self_verification'); if (!p || p.status === 'rejected') return setError('Take your verification photo to continue'); setError(''); next(); }} busy={false} />
    </div>
  );
}

/* ------------------------------------------------------------------ step 4: review */
function ReviewStep({ d, refresh, back, go, onSubmitted }: { d: AppData; refresh(): void; back(): void; go(i: number, key?: string): void; onSubmitted(r: { reference: string; message: string }): void }) {
  const [terms, setTerms] = useState(false); const [decl, setDecl] = useState(false); const [error, setError] = useState('');
  const resubmit = d.application.status !== 'incomplete';
  const submit = useMutation({ mutationFn: () => post<{ reference: string; message: string }>('/owner/application/submit', { acceptTerms: true, declaration: true }), onSuccess: onSubmitted, onError: (e) => setError(apiError(e)) });
  const b = d.business;
  const docs: any[] = d.documents; const selfie = docs.find((x) => x.docType === 'self_verification');
  const Row = ({ k, v: val }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-muted">{k}</span><span className="text-right font-medium">{val || '—'}</span></div>;
  const Block = ({ title, step, children }: { title: string; step: number; children: ReactNode }) => <Card className="p-4"><div className="mb-1 flex items-center justify-between"><h3 className="text-xl font-bold">{title}</h3><button type="button" className="text-sm font-semibold underline" onClick={() => go(step)}>Edit</button></div><div className="divide-y divide-line">{children}</div></Card>;
  const holder = b.type === 'sole_proprietorship' ? "Proprietor's " : b.type && b.type !== 'individual' ? "Authorized person's " : '';
  return (
    <div><h2 className="text-3xl font-bold">Review & Submit</h2><p className="mb-4 text-sm text-muted">Check everything carefully before submitting for verification.</p>
      <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-sky-400/40 bg-sky-500/10 px-4 py-3 text-sm"><span aria-hidden="true">ℹ️</span>
        <p>Please review every section below carefully before submitting. PlaynX verifies these details as part of your application, and identity information can only be updated afterward through an approval request. Make sure everything is accurate and complete.</p></div>
      <div className="space-y-3">
        <Block title="Personal Details" step={1}><Row k="Legal full name" v={b.representativeName} /><Row k="Date of birth" v={b.dob} /><Row k="Phone number" v={b.phone} /><Row k="Turf / venue address" v={[b.address, b.addressLine2, b.city, b.state, b.pincode, b.country].filter(Boolean).join(', ')} /></Block>
        <Block title="Account Type" step={2}><Row k="Type" v={ALL_TYPES.find((t) => t.id === b.type)?.label} /><Row k="Name" v={b.name} /><Row k="PAN" v={b.panMasked} />{b.registrationNumber && <Row k={b.type === 'llp' ? 'LLPIN' : 'CIN'} v={b.registrationNumber} />}<Row k="Authorized person" v={`${b.representativeName ?? ''}${b.designation ? `, ${b.designation}` : ''}`} /><Row k="Address" v={b.address} /><Row k="State / City / PIN" v={[b.state, b.city, b.pincode].filter(Boolean).join(', ')} /></Block>
        <Block title="Documents" step={3}><Row k="Aadhaar card number" v={d.identity.aadhaarMasked} />{docs.filter((x) => x.docType === 'identity_proof').map((x) => <Row key={x.id} k={`${holder}Aadhaar Card Copy`} v={x.label} />)}</Block>
        <Block title="Self Verification" step={4}><Row k="Verification photo" v={selfie && selfie.status !== 'rejected' ? <span className="text-ok">✓ Uploaded</span> : <span className="text-danger">Not uploaded</span>} />
          <div className="pt-2"><DocSlot fieldKey="self_verification" label="Your verification photo" hint="Opens your camera. The photo must be taken live." camera capture="user" accept="image/jpeg,image/png,image/webp" existing={selfie} uploadUrl="/owner/application/documents" fields={{ docType: 'self_verification' }} viewPath={(id) => `/owner/application/documents/${id}/file`} onDone={refresh} /></div></Block>
      </div>
      <div className="mt-5 space-y-1 rounded-xl border border-line p-4 text-sm">
        <TermsCheckbox checked={terms} onChange={setTerms} />
        <label className="flex cursor-pointer items-start gap-3 py-1"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-brand" checked={decl} onChange={(e) => setDecl(e.target.checked)} /><span className={STAR}>I confirm that the information and documents provided by me are accurate and complete to the best of my knowledge. I understand they will be reviewed as part of the PlaynX verification process, and that if any document I upload is found to be false, forged or illegal, PlaynX may block my account.</span></label></div>
      {d.missing.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="font-bold">{d.missing.length} thing{d.missing.length === 1 ? ' is' : 's are'} missing. Select an item to go and fix it:</p>
          <ul className="mt-2 space-y-1">{d.missing.map((m: any) => (
            <li key={m.key + m.message}><button type="button" onClick={() => go(stepOf(m), m.key)} className="group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-danger/10">
              <span><span className="font-semibold underline">{m.message}</span><span className="ml-2 text-xs text-muted">{STEPS[stepOf(m)]}</span></span><span aria-hidden="true" className="transition group-hover:translate-x-1">→</span></button></li>))}</ul>
        </div>)}
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <StepNav onBack={back} onNext={() => { setError(''); submit.mutate(); }} nextLabel={resubmit ? 'Resubmit for Verification' : 'Submit for Verification'} busy={submit.isPending} disabled={!terms || !decl || d.missing.length > 0} />
    </div>
  );
}

/* ------------------------------------------------------------------ tracking */
const EVENT_LABEL: Record<string, string> = { submitted: 'Application submitted', resubmitted: 'Application resubmitted', review_started: 'Review started', info_requested: 'Additional information requested', resubmission_requested: 'Resubmission requested', approved: 'Application approved', rejected: 'Application rejected', document_reviewed: 'Document reviewed', document_replaced: 'Document replaced', section_verified: 'Section verified', section_unverified: 'Verification withdrawn' };

function Tracking({ d, onEdit }: { d: AppData; onEdit(): void }) {
  const a = d.application;
  const stepFor = (i: any) => (i.type === 'document' ? 3 : i.key === 'identity' ? 3 : 2);
  return (
    <div className="space-y-5">
      {a.status === 'approved' && <div className="rounded-2xl border border-ok/40 bg-ok/10 p-5"><h2 className="text-3xl font-bold">You're approved 🎉</h2><p className="text-sm">Your owner account is active. Add your first venue, set its pricing and opening hours, and submit it for approval to start taking bookings.</p><div className="mt-3 flex flex-wrap gap-2"><Link to="/owner/venues/new" className="btn-primary">Add your first venue</Link><Link to="/owner" className="btn-ghost">Go to dashboard</Link></div></div>}
      {a.status === 'rejected' && <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-5"><h2 className="text-3xl font-bold">Application rejected</h2><p className="text-sm">{d.events.find((e: any) => e.kind === 'rejected')?.note ?? 'Please contact support for details.'}</p><Link to="/owner/support" className="btn-ghost mt-3">Contact support</Link></div>}
      {d.correction && (
        <div role="alert" className="rounded-2xl border border-warn/50 bg-warn/10 p-5">
          <h2 className="text-3xl font-bold">{d.correction.kind === 'info_requested' ? 'Additional information required' : 'Resubmission required'}</h2>
          {d.correction.note && <p className="mt-1 text-sm"><b>From our team:</b> {d.correction.note}</p>}
          {d.correction.items.length > 0 && <ul className="mt-2 space-y-1 text-sm">{d.correction.items.map((i: any, k: number) => <li key={k}>• <b>{i.type === 'document' ? d.requiredDocs.find((x: any) => x.docType === i.key)?.label ?? i.key : i.key}</b>{i.reason ? `: ${i.reason}` : ''}</li>)}</ul>}
          <Button className="mt-3" data-pending-ok onClick={onEdit}>Update my application</Button>
        </div>)}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-muted">Application reference</p><p className="font-display text-4xl font-extrabold tracking-wide">{a.reference ?? 'Not submitted yet'}</p></div><Badge status={a.status === 'approved' ? 'approved' : a.status === 'rejected' ? 'rejected' : a.status === 'incomplete' ? 'pending' : 'pending'}>{APP_STATUS[a.status]}</Badge></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs uppercase text-muted">Owner</dt><dd className="font-semibold">{d.owner.fullName}</dd></div><div><dt className="text-xs uppercase text-muted">Business</dt><dd className="font-semibold">{d.business.name}</dd></div>
          <div><dt className="text-xs uppercase text-muted">Business type</dt><dd className="font-semibold">{ALL_TYPES.find((t) => t.id === d.business.type)?.label ?? '—'}</dd></div><div><dt className="text-xs uppercase text-muted">Registered on</dt><dd className="font-semibold">{a.submittedAt ? fmtDateTime(a.submittedAt) : '—'}</dd></div></dl>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">{([['Contact verification', 'contact'], ['Business verification', 'business'], ['Identity verification', 'identity']] as const).map(([l, k]) => (
        <Card key={k} className="p-4"><p className="text-xs uppercase text-muted">{l}</p><div className="mt-1"><SectionBadge s={d.sections[k]} /></div></Card>))}</div>
      {d.correction?.items?.length > 0 && <p className="text-xs text-muted">Items flagged: {d.correction.items.map((i: any) => `${i.key} (step ${stepFor(i) + 1})`).join(', ')}</p>}
      {d.documents.length > 0 && <Card className="p-5"><h3 className="mb-2 text-2xl font-bold">Your documents</h3><ul className="divide-y divide-line text-sm">{d.documents.map((x: any) => (
        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><FileLink path={`/owner/application/documents/${x.id}/file`}>{x.label}</FileLink>{x.note && <span className="block text-xs text-danger">{x.note}</span>}</span><Badge status={x.status === 'approved' ? 'approved' : x.status === 'rejected' ? 'rejected' : 'pending'}>{x.status === 'approved' ? 'Verified' : x.status === 'rejected' ? 'Rejected' : 'Pending review'}</Badge></li>))}</ul></Card>}
      <Card className="p-5"><h3 className="mb-3 text-2xl font-bold">Application history</h3>{d.events.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
        <ol className="space-y-3 border-l border-line pl-4">{d.events.map((e: any, i: number) => <li key={i} className="relative text-sm"><span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden="true" /><div className="font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</div>{e.note && <div className="text-muted">{e.note}</div>}<div className="text-xs text-muted">{fmtDateTime(e.created_at)}</div></li>)}</ol>)}</Card>
      <p className="text-center text-xs text-muted">We'll email and notify you at every status change. Questions? <Link className="underline" to="/owner/support">Contact support</Link></p>
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export function ApplicationPage() {
  const { user, logout } = useAuth(); const nav = useNavigate(); const qc = useQueryClient();
  const logoutAsk = useLogoutConfirm(() => { logout(); nav('/owner/login'); }, 'owner');
  const q = useApplication();
  const [focus, setFocus] = useState<string | null>(null); const [seenReview, setSeenReview] = useState(false);
  const [sp] = useSearchParams(); const [step, setStep] = useState<number | null>(null); const [blocked, setBlocked] = useState<string | null>(null); const [editing, setEditing] = useState(sp.get('edit') === '1'); const [done, setDone] = useState<{ reference: string; message: string } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['owner-application'] }); };
  const d = q.data as AppData | undefined;
  const furthest = useMemo(() => {
    if (!d) return 0; const m: any[] = d.missing;
    if (m.some((x) => x.type === 'contact')) return 0; if (d.personal?.done === false) return 1; if (m.some((x) => x.type === 'field' && x.key !== 'identity')) return 2;
    if (m.some((x) => x.key === 'identity' || x.type === 'document')) return 3; return 5; // self verification is optional: nothing missing means ready to review
  }, [d]);
  const needsContact = !!d?.missing.some((x: any) => x.type === 'contact'); // the code from the email (and mobile) comes before anything else
  const cur = needsContact ? 0 : (step ?? furthest);
  useEffect(() => { if (cur === 5) setSeenReview(true); }, [cur]);
  const shell = (children: ReactNode) => (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface"><div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4"><Logo subtitle="Venue owner" />
        <div className="flex items-center gap-2"><ThemeToggle /><span className="hidden text-sm text-muted sm:block">{user?.fullName}</span><Button variant="ghost" className="!py-2" onClick={logoutAsk.ask}>Log out</Button></div></div></header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      {logoutAsk.dialog}
    </div>);
  if (q.isLoading) return shell(<Loading />);
  if (q.isError || !d) return shell(<ErrorBox error={q.error} retry={() => q.refetch()} />);

  if (done) return shell(
    <div className="space-y-5 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok/15 text-3xl">✓</div><h1 className="text-4xl font-extrabold">Application submitted</h1>
      <p className="mx-auto max-w-lg text-sm text-muted">{done.message}</p><div className="mx-auto max-w-sm rounded-2xl border border-brand/50 bg-brand/10 p-4"><p className="text-xs uppercase tracking-widest text-muted">Your reference number</p><p className="font-display text-4xl font-extrabold tracking-wide">{done.reference}</p></div>
      <Button onClick={() => { setDone(null); setEditing(false); refresh(); }}>Track my application</Button></div>);

  const showWizard = d.application.status === 'incomplete' || (editing && d.application.editable);
  // a submitted application is tracked inside the portal (status plus the whole menu), not on a page of its own
  if (!showWizard && pendingOf(d.accountStatus, d.application.status)) return <Navigate to="/owner" replace />;
  if (!showWizard) return shell(<><h1 className="mb-1 text-4xl font-extrabold">Your application</h1><p className="mb-5 text-sm text-muted">Track the verification of your venue owner account.</p><Tracking d={d} onEdit={() => { setEditing(true); setStep(furthest); }} /></>);

  const go = (i: number, key?: string) => { setBlocked(null); setStep(i); setFocus(key ?? null); if (!key) window.scrollTo({ top: 0 }); };
  /** Moving ahead through the step bar: only to a step whose earlier steps are all filled in. Going back is always fine. */
  const jump = (i: number) => {
    if (i <= furthest) return go(i);
    const what = d.missing.filter((m: any) => stepOf(m) === furthest).map((m: any) => m.message);
    setBlocked(`You have not filled in the details on ${STEPS[furthest]} yet, so you cannot open ${STEPS[i]}.${what.length ? ` Still needed: ${what.slice(0, 4).join('; ')}.` : ' Fill in the page and press Save & continue.'}`);
    setStep(furthest); window.scrollTo({ top: 0 });
  };
  const issues = new Set<number>(seenReview ? d.missing.map(stepOf) : []);
  return shell(
    <>
      <h1 className="text-4xl font-extrabold">{d.application.status === 'incomplete' ? 'Complete your registration' : 'Update your application'}</h1>
      <p className="mb-5 text-sm text-muted">Your progress is saved at every step, so you can leave and come back anytime. Fields marked <span className="font-bold text-danger">*</span> are required.</p>
      {d.correction && <div role="status" className="mb-4 rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm"><b>{d.correction.kind === 'info_requested' ? 'More information needed' : 'Resubmission required'}:</b> {d.correction.note} {d.correction.items.map((i: any) => `${i.key}${i.reason ? ` (${i.reason})` : ''}`).join('; ')}</div>}
      <Progress step={cur} furthest={furthest} issues={issues} onGo={jump} />
      {blocked && <p role="alert" className="mb-4 rounded-xl border border-warn/50 bg-warn/10 px-3 py-2 text-sm">{blocked}</p>}
      <Card className="p-5 sm:p-6">
        {cur === 0 && <VerifyStep d={d} refresh={refresh} next={() => go(1)} focus={focus} />}
        {cur === 1 && <PersonalStep d={d} refresh={refresh} back={() => go(0)} next={() => go(2)} focus={focus} />}
        {cur === 2 && <BusinessStep d={d} refresh={refresh} back={() => go(1)} next={() => go(3)} focus={focus} toPersonal={() => go(1)} />}
        {cur === 3 && <IdentityStep d={d} refresh={refresh} back={() => go(2)} next={() => go(4)} focus={focus} />}
        {cur === 4 && <SelfVerificationStep d={d} refresh={refresh} back={() => go(3)} next={() => go(5)} focus={focus} />}
        {cur === 5 && <ReviewStep d={d} refresh={refresh} back={() => go(4)} go={go} onSubmitted={(r) => { setDone(r); refresh(); }} />}
      </Card>
      {editing && <button className="mt-4 text-sm text-muted underline" onClick={() => setEditing(false)}>← Back to application status</button>}
    </>);
}

/**
 * Opening hours are set for today but the slots have no price: customers would see slots they cannot book. Until a price is
 * set, only the pages that fix it stay open (pricing, opening hours, playing areas, support); every other page sends the owner
 * to Pricing, with a note that says what is missing.
 */
const PRICE_FIRST_OK = ['/owner/pricing', '/owner/hours', '/owner/areas', '/owner/support', '/owner/notifications'];
function PriceGate({ children, off }: { children: ReactNode; off: boolean }) {
  const loc = useLocation();
  const q = useQuery({ queryKey: ['pricing-gate'], enabled: !off, queryFn: () => get<{ blocked: boolean; areas: { id: string; name: string; venueId: string; venueName: string; today: number }[] }>('/owner/pricing-gate'), refetchInterval: 60_000, staleTime: 30_000, retry: false }); // saving a price refreshes it at once
  const { refetch } = q;
  useEffect(() => { if (!off && q.isStale) refetch(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the page changes, and only if the answer is old
  if (off || q.data?.blocked !== true || !Array.isArray(q.data.areas) || q.data.areas.length === 0) return <>{children}</>;
  const first = q.data.areas[0];
  const ok = PRICE_FIRST_OK.some((x) => loc.pathname === x || loc.pathname.startsWith(x + '/'));
  if (!ok) return <Navigate to={`/owner/pricing?venue=${first.venueId}&area=${first.id}`} replace />;
  return (<>
    <div role="alert" className="sticky top-0 z-[60] border-b border-danger/50 bg-[rgb(var(--surface))] px-4 py-3 text-sm text-danger shadow-lg"><div className="mx-auto max-w-6xl">
      <b className="block text-base">Set the slot prices first</b>
      You have set today's opening hours, but {q.data.areas.length === 1 ? <><b>{first.name}</b> ({first.venueName}) has {first.today} slot{first.today === 1 ? '' : 's'} today with no price</> : <>{q.data.areas.length} playing areas have slots today with no price ({q.data.areas.map((a) => `${a.name}, ${a.venueName}`).join('; ')})</>}.
      This playing area was made before the default price was asked, so it has none. Set a default price in Pricing (every slot without its own price then uses it), or give the slot a price. The rest of the portal opens once every slot today has a price.</div>
    </div>
    {children}</>);
}
