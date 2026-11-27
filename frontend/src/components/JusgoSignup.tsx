import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiError, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Input } from './ui';
import { TermsCheckbox } from './TermsCheckbox';

/*
 * "I'm already registered in JusGo" for venue owners: email + JusGo Owner ID → PlaynX email code → approve on JusGo
 * → check the details JusGo sent → set a password. The JusGo API key never reaches this page: every JusGo call is made
 * by the PlaynX server.
 */

type Status = 'otp_sent' | 'pending' | 'fetching' | 'fetched' | 'denied' | 'expired' | 'failed' | 'completed' | 'unlinked';
interface Signup {
  id: string; status: Status; email: string; ownerCode: string | null; failure: string | null; otpResendAt: string | null; expiresAt: string | null; resendAt: string | null; existingAccount: boolean;
  profile: null | {
    publicCode: string | null; name: string | null; email: string | null; mobile: string | null; dateOfBirth: string | null; turfPhone: string | null;
    address: { line1: string | null; line2: string | null; city: string | null; state: string | null; pincode: string | null } | null;
    business: { accountType: string | null; legalName: string | null; gstin: string | null; address: string | null; partners: string[] } | null;
    panMasked: string | null; aadhaarMasked: string | null; aadhaarVerified: boolean | null; verification: string | null; documents: { type: string; fileName: string | null }[]; missingDocuments?: string[];
  };
}
const KEY = 'playnx_jusgo_link';
const DOC_NAME: Record<string, string> = { AADHAAR_COPY: 'Aadhaar copy', PROFILE_PHOTO: 'Profile photo', SELF_VERIFICATION: 'Self verification photo' };
const remembered = (): { id: string; token: string } | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const remember = (v: { id: string; token: string } | null) => { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
const secondsTo = (iso: string | null, now: number) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function JusgoSignup({ onCancel }: { onCancel(): void }) {
  const nav = useNavigate(); const { refresh } = useAuth();
  const [link, setLink] = useState(remembered);
  const [s, setS] = useState<Signup | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState<null | { role: string }>(null);
  const headers = link ? { 'X-Link-Token': link.token } : {};
  const call = async (method: 'get' | 'post', path: string, body?: unknown) => {
    const r = method === 'get' ? await api.get(`/auth/jusgo-link/${link!.id}${path}`, { headers }) : await api.post(`/auth/jusgo-link/${link!.id}${path}`, body ?? {}, { headers });
    return r.data;
  };

  // carry on after a page refresh
  useEffect(() => { if (link && !s) call('get', '').then((r) => setS(r.signup)).catch(() => { remember(null); setLink(null); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // while waiting for the approval: ask every 3 seconds (the server checks JusGo when no webhook has arrived)
  const polling = s?.status === 'pending' || s?.status === 'fetching';
  const timer = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    if (!polling || !link) return;
    timer.current = setInterval(() => { call('get', '').then((r) => setS(r.signup)).catch(() => {}); }, 3000);
    return () => clearInterval(timer.current);
  }, [polling, link?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(apiError(e)); } finally { setBusy(false); } };
  const startOver = () => { remember(null); setLink(null); setS(null); setError(''); };
  const cancel = () => { remember(null); onCancel(); };

  /* ---------- 1. email + JusGo Owner ID ---------- */
  const [f, setF] = useState({ email: '', ownerCode: '' });
  if (!link || !s) {
    const submit = (e: FormEvent) => { e.preventDefault(); run(async () => {
      if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) throw new Error('Enter the email you use on JusGo');
      if (!/^JGO-[A-Z0-9]{6}$/i.test(f.ownerCode.trim())) throw new Error('Enter your JusGo Owner ID, e.g. JGO-7X9QVZ');
      const r = (await api.post('/auth/jusgo-link', { email: f.email.trim(), ownerCode: f.ownerCode.trim() })).data;
      const l = { id: r.signup.id, token: r.token }; remember(l); setLink(l); setS(r.signup);
    }).catch(() => {}); };
    return (
      <Frame title="Sign up with your JusGo details" sub="Already a venue owner on JusGo? Bring your profile and onboarding details across instead of typing them again." onCancel={cancel}>
        <form onSubmit={submit} className="space-y-3.5" noValidate>
          <Input mandatory label="Email registered on JusGo" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input mandatory label="JusGo Owner ID" placeholder="JGO-7X9QVZ" value={f.ownerCode} onChange={(e) => setF({ ...f, ownerCode: e.target.value.toUpperCase() })} hint="Shown in the JusGo owner portal header and on your JusGo profile." />
          {error && <Err>{error}</Err>}
          <Button type="submit" className="w-full" loading={busy}>Continue</Button>
        </form>
      </Frame>);
  }

  /* ---------- 2. the PlaynX code ---------- */
  if (s.status === 'otp_sent') return <OtpStep s={s} now={now} busy={busy} error={error} onCancel={cancel}
    onVerify={(code) => run(async () => setS((await call('post', '/otp/verify', { code })).signup))}
    onResend={() => run(async () => setS((await call('post', '/otp/resend')).signup))} />;

  /* ---------- 3. waiting for the approval on JusGo ---------- */
  if (s.status === 'pending' || s.status === 'fetching') {
    const left = secondsTo(s.expiresAt, now), resendIn = secondsTo(s.resendAt, now);
    return (
      <Frame title="Approve the request on JusGo" sub="" onCancel={cancel}>
        <div role="status" className="rounded-2xl border border-line bg-surface2 p-5 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 animate-pulse place-items-center rounded-full bg-gradient-to-br from-[#7200FF] to-[#A100FF] text-2xl text-white" aria-hidden="true">✉</span>
          <p className="font-semibold">{s.status === 'fetching' ? 'Approved! Collecting your details…' : 'Approve the request in your JusGo owner portal (or from the email JusGo sent you).'}</p>
          <p className="mt-1 text-sm text-muted">We asked JusGo for the details of <b className="text-ink">{s.email}</b> ({s.ownerCode}). In JusGo, open the notification or <b className="text-ink">Profile → Connected apps</b> and choose <b className="text-ink">Approve and share</b>.</p>
          <p className="mt-4 font-display text-3xl font-bold tabular-nums" aria-label={`${mmss(left)} left`}>{mmss(left)}</p>
          <p className="text-xs text-muted">The request is open for 15 minutes.</p>
        </div>
        {error && <div className="mt-3"><Err>{error}</Err></div>}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button variant="ghost" disabled={resendIn > 0 || busy} onClick={() => run(async () => setS((await call('post', '/resend')).signup))}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend'}</Button>
          <Button variant="ghost" onClick={cancel}>Sign up normally instead</Button>
        </div>
      </Frame>);
  }

  /* ---------- 4. check the details, set a password ---------- */
  if (s.status === 'fetched' && s.profile && !done) return <Review s={s} busy={busy} error={error} onCancel={cancel}
    onFinish={(body) => run(async () => {
      const r = await call('post', '/complete', body);
      remember(null);
      if (r.linkedExisting) return setDone({ role: r.role });
      setToken(r.token); await refresh(); nav('/owner/application', { replace: true });
    })} />;

  if (done) return (
    <Frame title="Linked to your PlaynX account" sub="" onCancel={cancel}>
      <p className="text-sm">This email already has a PlaynX account, so we linked your JusGo details to it instead of making a second account.{done.role === 'owner' ? ' Any empty parts of your venue owner application have been filled in for you to check.' : ''}</p>
      <Link to={done.role === 'owner' ? '/owner/login' : '/login'} className="btn-primary mt-5 w-full">Log in to continue</Link>
    </Frame>);

  /* ---------- denied, expired or failed: back to the normal sign-up ---------- */
  const why = s.status === 'denied' ? 'The request was declined on JusGo.' : s.status === 'expired' ? 'The request was not approved within 15 minutes, or this email and Owner ID do not belong to the same JusGo venue owner account. Check both and try again.' : s.failure ?? 'We could not get your JusGo details.';
  return (
    <Frame title="We didn't get your JusGo details" sub="" onCancel={cancel}>
      <p role="alert" className="rounded-xl bg-warn/10 px-3 py-2 text-sm">{why}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><Button variant="ghost" onClick={startOver}>Try again</Button><Button onClick={cancel}>Sign up normally</Button></div>
    </Frame>);
}

function Frame({ title, sub, children, onCancel }: { title: string; sub: string; children: React.ReactNode; onCancel(): void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[rgb(var(--brand-text))]">Already registered in JusGo</p>
      <h1 className="text-4xl font-extrabold">{title}</h1>
      {sub && <p className="mb-5 mt-1 text-sm text-muted">{sub}</p>}
      <div className={sub ? '' : 'mt-5'}>{children}</div>
      <p className="mt-5 text-center text-sm text-muted"><button type="button" className="font-semibold text-[rgb(var(--brand-text))] underline" onClick={onCancel}>Sign up normally instead</button></p>
    </div>);
}
const Err = ({ children }: { children: React.ReactNode }) => <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{children}</p>;

function OtpStep({ s, now, busy, error, onVerify, onResend, onCancel }: { s: Signup; now: number; busy: boolean; error: string; onVerify(c: string): void; onResend(): void; onCancel(): void }) {
  const [code, setCode] = useState(''); const wait = secondsTo(s.otpResendAt, now);
  return (
    <Frame title="Confirm your email" sub={`We sent a 6-digit PlaynX code to ${s.email}. Enter it to continue.`} onCancel={onCancel}>
      <form className="space-y-3.5" noValidate onSubmit={(e) => { e.preventDefault(); onVerify(code); }}>
        <input autoFocus className="field text-center font-mono text-2xl tracking-[.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="6-digit code" placeholder="••••••"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        {error && <Err>{error}</Err>}
        <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>Verify and continue</Button>
        <p className="text-center text-sm text-muted">Didn't get it? <button type="button" disabled={wait > 0} onClick={onResend} className="font-semibold text-[rgb(var(--brand-text))] underline disabled:no-underline disabled:opacity-60">{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</button></p>
      </form>
    </Frame>);
}

function Review({ s, busy, error, onFinish, onCancel }: { s: Signup; busy: boolean; error: string; onFinish(body: Record<string, unknown>): void; onCancel(): void }) {
  const p = s.profile!;
  const [pw, setPw] = useState({ password: '', confirm: '', terms: false }); const [errs, setErrs] = useState<Record<string, string>>({});
  const addr = p.address ? [p.address.line1, p.address.line2, p.address.city, p.address.state, p.address.pincode].filter(Boolean).join(', ') : null;
  const rows: [string, string | null | undefined][] = [
    ['JusGo Owner ID', p.publicCode], ['Name', p.name], ['Email', p.email], ['Mobile', p.mobile], ['Date of birth', p.dateOfBirth], ['Address', addr],
    ['Business type', p.business?.accountType ? p.business.accountType.replace(/_/g, ' ').toLowerCase() : null], ['Business name', p.business?.legalName], ['GSTIN', p.business?.gstin],
    ['Partners', p.business?.partners.length ? p.business.partners.join(', ') : null], ['PAN', p.panMasked], ['Aadhaar', p.aadhaarMasked ? `${p.aadhaarMasked}${p.aadhaarVerified ? ' (verified on JusGo)' : ''}` : null],
    ['JusGo verification', p.verification ? p.verification.toLowerCase() : null], ['Documents', p.documents.length ? p.documents.map((d) => DOC_NAME[d.type] ?? d.type).join(', ') : null],
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (s.existingAccount) return onFinish({});
    const v: Record<string, string> = {};
    if (pw.password.length < 8 || !/[A-Za-z]/.test(pw.password) || !/[0-9]/.test(pw.password)) v.password = 'At least 8 characters with a letter and a digit';
    if (pw.confirm !== pw.password) v.confirm = 'Passwords do not match';
    if (!pw.terms) v.terms = 'Please accept the terms to continue';
    setErrs(v); if (Object.keys(v).length) return;
    onFinish({ password: pw.password, acceptTerms: true });
  };
  return (
    <Frame title="Check your JusGo details" sub="This is what JusGo sent. It fills your venue owner application; you can still change it there before you submit." onCancel={onCancel}>
      <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 px-4 py-2.5 text-sm"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words font-medium">{v}</dd></div>)}
      </dl>
      {(p.missingDocuments?.length ?? 0) > 0 && <p role="status" className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm"><b>{p.missingDocuments!.map((t) => DOC_NAME[t] ?? t).join(', ')}</b> could not be copied from JusGo. After you finish, upload {p.missingDocuments!.length === 1 ? 'it' : 'them'} in your venue owner application.</p>}
      <form onSubmit={submit} className="mt-5 space-y-3.5" noValidate>
        {s.existingAccount
          ? <p className="rounded-xl bg-brand/10 px-3 py-2 text-sm">This email already has a PlaynX account. We'll link your JusGo details to it instead of making a new one.</p>
          : <>
            <Input mandatory label="Create a PlaynX password" type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} error={errs.password} />
            <Input mandatory label="Confirm password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={errs.confirm} />
            <TermsCheckbox checked={pw.terms} onChange={(v) => setPw({ ...pw, terms: v })} error={errs.terms} />
          </>}
        {error && <Err>{error}</Err>}
        <Button type="submit" className="w-full" loading={busy}>{s.existingAccount ? 'Link to my PlaynX account' : 'Create my venue owner account'}</Button>
      </form>
    </Frame>);
}
