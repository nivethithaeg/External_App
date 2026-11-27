import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { Button, Input, Loading, Modal, PasswordInput, Select } from '../../components/ui';
import { VerifyRow, useVerificationOptions } from '../../components/VerifyRow';
import { useAuth, homeFor, landing, type MfaChallenge, type User } from '../../lib/auth';
import { AuthenticatorStep } from '../../components/AuthenticatorStep';
import { apiError, fieldErrors, get, post, put, uploadAvatar } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { BackButton, ThemeToggle } from '../../components/Layouts';
import { GoogleSignIn } from '../../components/GoogleSignIn';
import { FILTERS } from '../../lib/inputFilters';
import { TermsCheckbox } from '../../components/TermsCheckbox';
import { isIndianMobile, PHONE_CHECK, MOBILE_MESSAGE } from '../../lib/phone';

type Portal = 'customer' | 'owner' | 'admin';
const COPY: Record<Portal, { title: string; sub: string; side: string }> = {
  customer: { title: 'Game on.', sub: 'Book a turf in under a minute.', side: 'Football, cricket, badminton and more. Live availability, instant confirmation.' },
  owner: { title: 'Fill every slot.', sub: 'Turf owner portal', side: 'Manage venues, pricing and bookings. Get paid for every game played.' },
  admin: { title: 'Control room.', sub: 'Administrator access', side: 'Approvals, payments, refunds and platform health in one place.' },
};

export function Shell({ portal, children, back = true }: { portal: Portal; children: React.ReactNode; back?: boolean }) {
  const c = COPY[portal];
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="pitch-stripes relative hidden flex-col justify-between overflow-hidden bg-[#101B5C] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#7200FF]/20 blur-3xl" />
        <Logo onDark />
        <svg viewBox="0 0 400 240" className="mx-auto w-full max-w-md opacity-90" aria-hidden="true">
          <rect x="10" y="10" width="380" height="220" rx="14" fill="#1B2A80" stroke="#7200FF" strokeWidth="3" />
          <line x1="200" y1="10" x2="200" y2="230" stroke="#7200FF" strokeWidth="3" /><circle cx="200" cy="120" r="38" fill="none" stroke="#7200FF" strokeWidth="3" />
          <rect x="10" y="70" width="60" height="100" fill="none" stroke="#7200FF" strokeWidth="3" /><rect x="330" y="70" width="60" height="100" fill="none" stroke="#7200FF" strokeWidth="3" />
          <circle cx="200" cy="120" r="7" fill="#7200FF" />
        </svg>
        <div><h2 className="font-display text-6xl font-extrabold uppercase leading-none">{c.title}</h2><p className="mt-3 max-w-sm text-white/70">{c.side}</p></div>
      </div>
      <div className="flex flex-col p-6">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3">{back && <div className="[&>button]:!mb-0"><BackButton home="/" /></div>}<Link to="/" className="lg:hidden"><Logo /></Link></div><ThemeToggle /></div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage({ portal }: { portal: Portal }) {
  const { login, googleLogin, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  const from = (loc.state as any)?.from as string | undefined;
  if (user && !mfa) { const l = user.role === 'customer' ? landing(user, from) : { to: from ?? homeFor(user), state: undefined }; return <Navigate to={l.to} replace state={l.state} />; }

  const google = async (credential: string) => {
    setError(''); setBusy(true);
    try { const u = await googleLogin(credential, portal === 'customer' ? { create: true } : {}); const l = u.role === 'customer' ? landing(u, u.role === portal ? from : undefined) : { to: u.role === portal && from ? from : homeFor(u), state: undefined }; nav(l.to, { replace: true, state: l.state }); } // a new Google player still confirms the emailed code
    catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!email || !password) return setError('Enter your email or mobile number and password');
    setBusy(true);
    try {
      const r = await login(email.trim(), password);
      if ('mfa' in r) return setMfa(r.mfa); // an admin: the authenticator code comes next
      finish(r);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const finish = (u: User) => {
    if (u.role !== portal) { toast(`Signed in as ${u.role}. Redirecting to the ${u.role} portal.`, 'info'); }
    const l = u.role === 'customer' ? landing(u, u.role === portal ? from : undefined) : { to: u.role === portal && from ? from : homeFor(u), state: undefined };
    nav(l.to, { replace: true, state: l.state });
  };
  if (mfa) return <Shell portal={portal}><AuthenticatorStep challenge={mfa} onDone={finish} onCancel={() => { setMfa(null); setPassword(''); }} /></Shell>;
  return (
    <Shell portal={portal}>
      <h1 className="text-5xl font-extrabold">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm text-muted">{COPY[portal].sub}</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input mandatory label="Email or mobile number" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordInput mandatory label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Log in</Button>
      </form>
      {portal !== 'admin' && <GoogleSignIn text="continue_with" role={portal === 'owner' ? 'owner' : 'customer'} />}
      <div className="mt-4 flex justify-between text-sm"><Link className="text-muted underline" to="/forgot-password">Forgot password?</Link>
        {portal !== 'admin' && <span className="text-muted">Don't have an account? <Link className="font-semibold text-[rgb(var(--brand-text))]" to={portal === 'owner' ? '/owner/register' : '/register'} state={from ? { from } : undefined}>Create account</Link></span>}</div>
    </Shell>
  );
}

const CUSTOMER_MORE = {
  intro: 'Customers are the players. PlaynX helps you find a turf near you, check its real availability and book it in a few taps.',
  sections: [
    { title: 'Find the right turf', items: ['Search venues by city, locality or name.', 'Filter by sport, date, time and price.', 'See photos, facilities, ratings and reviews before you book.', 'Save your favourite venues.'] },
    { title: 'Book and pay', items: ['Pick a playing area, a date and a time slot that is really free.', 'See the exact price, including any offer or coupon, before paying.', 'Pay online and get a booking reference instantly.', 'Use your PlaynX wallet balance and refunds on your next booking.'] },
    { title: 'Manage your games', items: ['See upcoming and past bookings in one place.', 'Cancel according to the venue’s cancellation rules; eligible refunds go back to you.', 'Show your booking reference at the venue to check in.', 'Join open games and play with new people.'] },
    { title: 'After the game', items: ['Rate the venue and write a review.', 'Get booking, payment and refund updates as notifications.', 'Contact PlaynX support from Help & Support if something goes wrong.'] },
  ],
};

const OWNER_MORE = {
  intro: 'Venue Owners are responsible for creating and managing the venue structure within JusGo. The Venue Owner is the starting point of the venue hierarchy.',
  sections: [
    { title: 'Main responsibilities', items: ['Register as a Venue Owner.', 'Manage the Venue Owner profile.', 'Create and manage venues.', 'Create and manage playing areas within venues.', 'Manage newly created playing areas.', 'Approve external integration requests.', 'Review integration-related requests.', 'Control which venues are shared with connected external applications.'] },
    { title: 'Available functionality', items: ['Configure supported sports.', 'Configure opening hours for each playing area.', 'Configure slot duration and slot timings.', 'Configure advance booking limits.', 'Configure minimum and maximum booking duration.', 'Configure instant booking rules.', 'Configure base pricing.', 'Configure external-app-specific pricing.', 'Manage availability.', 'Manage venue blocks and maintenance periods.', 'Configure cancellation rules.', 'Manage bookings and cancellations.'] },
    { title: 'Staff management', items: ['Create staff accounts for the people who run your venues.', 'Choose exactly which sections each staff member can view or manage.', 'Activate, deactivate or remove staff accounts at any time.', 'Staff work inside your Venue Owner portal; subscription and revenue stay with the Venue Owner only.'] },
  ],
};

/** One "I am a…" card: the top part opens the sign-up; "View more" opens the full description in a pop-up. */
function RoleCard({ to, icon, title, sub, points, more, cta }: { to: string; icon: string; title: string; sub: string; points: string[]; more: typeof OWNER_MORE | null; cta: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden transition hover:border-brand focus-within:border-brand">
      <Link to={to} className="group block p-5">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/15 text-2xl" aria-hidden="true">{icon}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="text-sm text-muted">{sub}</p>
            <ul className="mt-2 space-y-0.5 text-xs text-muted">{points.map((x) => <li key={x}>✓ {x}</li>)}</ul>
          </div>
          <span className="self-center text-xl text-brand transition group-hover:translate-x-1" aria-hidden="true">→</span>
        </div>
      </Link>
      {more && <>
        <div className="border-t border-line px-5 py-2.5"><button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="text-sm font-semibold text-[rgb(var(--brand-text))] hover:underline">View more</button></div>
        <Modal open={open} onClose={() => setOpen(false)} title={title}>
          <div className="space-y-3 text-sm">
            <p className="text-muted">{more.intro}</p>
            {more.sections.map((sec) => <div key={sec.title}><h3 className="font-bold">{sec.title}</h3><ul className="mt-1 space-y-0.5 text-muted">{sec.items.map((x) => <li key={x}>✓ {x}</li>)}</ul></div>)}
            <div className="flex flex-wrap justify-end gap-2 pt-1"><Link to={to} className="btn-primary">{cta}</Link></div>
          </div>
        </Modal>
      </>}
    </div>);
}

export function RegisterPage({ portal }: { portal: 'customer' | 'owner' }) {
  const [params] = useSearchParams();
  if (portal !== 'customer') return <OwnerRegisterForm portal={portal} />;
  // First choose who you are; the matching form shows after that.
  return params.get('as') === 'customer' ? <CustomerSignup /> : <AccountTypeChoice />;
}

function AccountTypeChoice() {
  const { user } = useAuth();
  if (user) return <Navigate to={homeFor(user)} replace />;
  const cards = [
    { to: '/register?as=customer', icon: '⚽', title: 'Customer', sub: 'I want to find and book turfs', points: ['Search turfs near you', 'Book slots and pay online', 'Show your booking reference at the venue'], more: CUSTOMER_MORE as typeof OWNER_MORE | null, cta: 'Sign up as a customer' },
    { to: '/owner/register', icon: '🏟️', title: 'Venue owner', sub: 'I want to list my turf', points: ['List your venues and courts', 'Manage slots and bookings', 'Get paid for every game'], more: OWNER_MORE as typeof OWNER_MORE | null, cta: 'Register as a venue owner' },
  ];
  return (
    <Shell portal="customer">
      <h1 className="text-5xl font-extrabold">Join PlaynX</h1>
      <p className="mb-6 mt-1 text-sm text-muted">First, tell us how you will use PlaynX.</p>
      <div className="grid gap-3" role="group" aria-label="Choose account type">
        {cards.map((c) => <RoleCard key={c.title} {...c} />)}
      </div>
      <p className="mt-6 text-center text-sm text-muted">Already registered? <Link className="font-semibold text-[rgb(var(--brand-text))]" to="/login">Log in</Link></p>
    </Shell>);
}

function OwnerRegisterForm({ portal }: { portal: 'customer' | 'owner' }) {
  const { register, googleLogin, user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [terms, setTerms] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (user) return <Navigate to={homeFor(user)} replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const google = async (credential: string) => {
    setError('');
    setBusy(true);
    try { const u = await googleLogin(credential, { create: true, role: portal }); const l = u.role === 'customer' ? landing(u) : u.role === 'owner' && !u.emailVerified ? { to: '/verify-account', state: { from: '/owner/complete-signup' } } : { to: homeFor(u), state: undefined }; nav(l.to, { replace: true, state: { ...(l.state ?? {}), fresh: true } }); } // the code was emailed at sign-up, so the verify step opens next
    catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    const v: Record<string, string> = {};
    if (f.firstName.trim().length < 2) v.firstName = 'Enter your first name';
    if (!/^\S+@\S+\.\S+$/.test(f.email)) v.email = 'Enter a valid email';
    const phone = f.phone.replace(/[\s-]/g, '');
    if (!isIndianMobile(phone)) v.phone = MOBILE_MESSAGE;
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/[0-9]/.test(f.password)) v.password = 'At least 8 characters with a letter and a digit';
    if (!f.confirmPassword) v.confirmPassword = 'Confirm your password'; else if (f.confirmPassword !== f.password) v.confirmPassword = 'Passwords do not match';
    if (!terms) v.terms = 'Accept the Terms and Conditions to continue';
    setErrs(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await register({ fullName: `${f.firstName.trim()} ${f.lastName.trim()}`.trim(), email: f.email.trim(), password: f.password, confirmPassword: f.confirmPassword, role: portal, phone: f.phone.replace(/[\s-]/g, '') });
      nav(portal === 'owner' ? '/owner/profile' : '/venues', { replace: true });
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  return (
    <Shell portal={portal}>
      <h1 className="text-5xl font-extrabold">{portal === 'owner' ? 'List your turf' : 'Join PlaynX'}</h1>
      <p className="mb-6 mt-1 text-sm text-muted">{portal === 'owner' ? 'Create your owner account. We verify every venue before it goes live.' : 'Create an account to book turfs near you.'}</p>
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Input mandatory label="First name" filter={FILTERS.personName} autoComplete="given-name" placeholder="Enter your first name" value={f.firstName} onChange={set('firstName')} error={errs.firstName} />
          <Input label="Last name" filter={FILTERS.personName} autoComplete="family-name" placeholder="Enter your last name" value={f.lastName} onChange={set('lastName')} />
        </div>
        <Input mandatory label="Email" filter={FILTERS.email} type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errs.email} />
        <Input mandatory label="Mobile number" filter={FILTERS.mobile} type="tel" autoComplete="tel" placeholder="9876543210" value={f.phone} onChange={set('phone')} error={errs.phone} hint="We'll text a code to verify it" />
        <PasswordInput mandatory label="Password" filter={FILTERS.password} autoComplete="new-password" placeholder="Create a strong password" value={f.password} onChange={set('password')} error={errs.password} />
        <PasswordInput mandatory label="Confirm password" filter={FILTERS.password} autoComplete="new-password" value={f.confirmPassword} onChange={set('confirmPassword')} error={errs.confirmPassword} />
        <TermsCheckbox checked={terms} onChange={setTerms} />
        {errs.terms && <p role="alert" className="text-xs text-danger">{errs.terms}</p>}
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
      <GoogleSignIn text="signup_with" role={portal} />
      <p className="mt-4 text-center text-sm text-muted">Already registered? <Link className="font-semibold text-[rgb(var(--brand-text))]" to={portal === 'owner' ? '/owner/login' : '/login'}>Log in</Link></p>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const { toast } = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [info, setInfo] = useState('');
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => { e.preventDefault(); setError(''); setInfo(''); setBusy(true); try { await fn(); } catch (err) { setError(apiError(err)); } finally { setBusy(false); } };
  const resend = run(async () => { await post('/auth/forgot-password', { email }); setInfo('If that account exists, a new code is on its way.'); });
  return (
    <Shell portal="customer">
      <h1 className="text-5xl font-extrabold">Reset password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">{step === 'email' ? "Enter your registered email or mobile number and we'll send a 6-digit code." : `If ${email} is registered, a code was sent to it. Enter it below with a new password. Codes expire in 10 minutes.`}</p>
      {step === 'email' ? (
        <form className="space-y-4" onSubmit={run(async () => { await post('/auth/forgot-password', { email: email.trim() }); setStep('reset'); })}>
          <Input mandatory label="Email or mobile number" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" loading={busy}>Send code</Button>
        </form>
      ) : (
        <form className="space-y-4" noValidate onSubmit={run(async () => {
          if (code.length !== 6) throw new Error('Enter the 6-digit code');
          if (pwProblem(pw)) throw new Error(PW_HELP);
          if (pw !== pw2) throw new Error('The two passwords do not match');
          await post('/auth/reset-password', { email: email.trim(), code, newPassword: pw, confirmPassword: pw2 }); toast('Password updated. Please log in.'); nav('/login');
        })}>
          <Input mandatory label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          <PasswordInput mandatory label="New password" filter={FILTERS.password} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint={PW_HELP} required />
          <PasswordInput mandatory label="Confirm new password" filter={FILTERS.password} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {info && <p role="status" className="text-sm text-muted">{info}</p>}
          <Button type="submit" className="w-full" loading={busy}>Update password</Button>
          <button type="button" className="block w-full text-center text-sm text-muted underline" disabled={busy} onClick={resend}>Resend code</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link className="text-muted underline" to="/login">Back to log in</Link></p>
    </Shell>
  );
}

const PHONE_RE = PHONE_CHECK;
const PW_HELP = 'At least 8 characters with a letter and a digit';
const pwProblem = (pw: string) => (pw.length < 8 || pw.length > 72 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw) ? PW_HELP : '');

/** Customer sign-up: name, mobile, email, password (+confirm) are required; picture, sport and location are optional. */
/** Small link back to the account-type choice, shown above a registration form. */
export function ChangeType() {
  return <Link to="/register" replace className="mb-4 inline-block text-sm font-semibold text-[rgb(var(--brand-text))] hover:underline">← Change account type</Link>;
}

function CustomerSignup() {
  const { register, user } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as any)?.from as string | undefined;
  const [f, setF] = useState({ fullName: '', phone: '', email: '', password: '', confirmPassword: '', sport: '', city: '' });
  const [avatar, setAvatar] = useState<File | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string; slug: string }[] }>('/sports'), staleTime: Infinity });
  const { toast } = useToast();
  if (user && !busy) return <Navigate to={from ?? homeFor(user)} replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const pickAvatar = (file?: File) => {
    if (!file) return setAvatar(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setErrs((x) => ({ ...x, avatar: 'Use a JPG, PNG or WebP image' })); return setAvatar(null); }
    if (file.size > 5 * 1024 * 1024) { setErrs((x) => ({ ...x, avatar: 'Image must be under 5 MB' })); return setAvatar(null); }
    setErrs((x) => { const { avatar: _a, ...rest } = x; return rest; }); setAvatar(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    const v: Record<string, string> = {};
    if (f.fullName.trim().length < 2) v.fullName = 'Enter your full name';
    if (!PHONE_RE.test(f.phone.replace(/[\s-]/g, ''))) v.phone = MOBILE_MESSAGE;
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) v.email = 'Enter a valid email address';
    const pw = pwProblem(f.password); if (pw) v.password = pw;
    if (!f.confirmPassword) v.confirmPassword = 'Confirm your password'; else if (f.confirmPassword !== f.password) v.confirmPassword = 'Passwords do not match';
    if (errs.avatar) v.avatar = errs.avatar;
    setErrs(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await register({ fullName: f.fullName.trim(), email: f.email.trim(), phone: f.phone.replace(/[\s-]/g, ''), password: f.password, confirmPassword: f.confirmPassword, role: 'customer',
        ...(f.sport ? { preferredSports: [f.sport] } : {}), ...(f.city.trim() ? { city: f.city.trim() } : {}) });
      if (avatar) { try { await uploadAvatar(avatar); } catch { toast('Your account is ready, but the profile picture could not be uploaded. You can add it from your profile.', 'info'); } }
      nav('/verify-account', { replace: true, state: { fresh: true, ...(from ? { from } : {}) } });
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrs(fe);
      setError(apiError(err));
    } finally { setBusy(false); }
  };

  return (
    <Shell portal="customer">
      <ChangeType />
      <h1 className="text-5xl font-extrabold">Join PlaynX</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Create an account to book turfs near you.</p>
      <form onSubmit={submit} className="space-y-3.5" noValidate>
        <Input mandatory label="Full name" filter={FILTERS.personName} autoComplete="name" value={f.fullName} onChange={set('fullName')} error={errs.fullName} />
        <Input mandatory label="Mobile number" filter={FILTERS.mobile} type="tel" inputMode="tel" autoComplete="tel" placeholder="9876543210" value={f.phone} onChange={set('phone')} error={errs.phone} hint="We'll text a 6-digit code to verify it" />
        <Input mandatory label="Email address" filter={FILTERS.email} type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errs.email} />
        <PasswordInput mandatory label="Password" filter={FILTERS.password} autoComplete="new-password" value={f.password} onChange={set('password')} error={errs.password} hint={PW_HELP} />
        <PasswordInput mandatory label="Confirm password" filter={FILTERS.password} autoComplete="new-password" value={f.confirmPassword} onChange={set('confirmPassword')} error={errs.confirmPassword} />
        <fieldset className="space-y-3.5 rounded-xl border border-line p-3.5"><legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Optional</legend>
          <div className="space-y-1.5">
            <label htmlFor="signup-avatar" className="block text-xs font-semibold uppercase tracking-wide text-muted">Profile picture</label>
            <input id="signup-avatar" ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="field text-sm" aria-invalid={errs.avatar ? true : undefined} onChange={(e) => pickAvatar(e.target.files?.[0])} />
            {errs.avatar && <p role="alert" className="text-xs text-danger">{errs.avatar}</p>}
          </div>
          <Select label="Preferred sport" value={f.sport} onChange={set('sport')}><option value="">No preference</option>{sports.data?.sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}</Select>
          <Input label="Preferred location" autoComplete="address-level2" placeholder="City or area" value={f.city} onChange={set('city')} />
        </fieldset>
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
      <GoogleSignIn text="signup_with" role="customer" />
      <p className="mt-4 text-center text-sm text-muted">Already registered? <Link className="font-semibold text-[rgb(var(--brand-text))]" to="/login" state={from ? { from } : undefined}>Log in</Link></p>
    </Shell>
  );
}

/** Shown right after sign-up: verify the email and mobile with the codes we just sent. Nothing is marked verified until the server accepts the code. */
export function VerifyAccountPage() {
  const { user, loading, refresh } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const st = useLocation().state as { from?: string; fresh?: boolean } | null;
  const opts = useVerificationOptions();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'customer' && user.role !== 'owner') return <Navigate to={homeFor(user)} replace />; // a venue owner who signed up with Google confirms the email here too
  const done = () => nav(st?.from ?? homeFor(user), { replace: true });
  const verified = async () => { await refresh(); qc.invalidateQueries({ queryKey: ['profile'] }); };
  // The email code is required. The only exception is a server with no email provider at all, where a code could never arrive.
  const noEmailProvider = opts.data?.email === false;
  const emailOk = user.emailVerified || noEmailProvider, phoneOk = user.phoneVerified || !user.phone || !opts.data?.sms;
  const justSent = !!st?.fresh; // right after sign-up the server has already emailed a code
  return (
    <Shell portal={user.role === 'owner' ? 'owner' : 'customer'} back={false}>
      <h1 className="text-4xl font-extrabold">Verify your email</h1>
      <p className="mb-5 mt-1 text-sm text-muted">{user.emailVerified ? 'Your email is verified.' : `${justSent ? 'We sent' : 'We will send'} a 6-digit code to ${user.email}. Enter it below to finish setting up your account. The code expires in 10 minutes.`}</p>
      {opts.isLoading ? <p className="text-sm text-muted">Checking…</p> : (
        <div className="space-y-3">
          <VerifyRow channel="email" target={user.email} verified={user.emailVerified} available={!!opts.data?.email} codeSent={justSent && !!opts.data?.email} onVerified={verified} />
          {user.phone && opts.data?.sms && <VerifyRow channel="phone" target={user.phone} verified={user.phoneVerified} available codeSent={justSent} onVerified={verified} />}
        </div>)}
      {noEmailProvider && !user.emailVerified && <p className="mt-3 text-xs text-muted">This server cannot send email yet, so verification is not possible right now.</p>}
      <Button className="mt-6 w-full" disabled={!emailOk} onClick={done}>Continue</Button>
      {!user.emailVerified && !noEmailProvider && <p className="mt-2 text-center text-xs text-muted">Verify your email to continue. <button type="button" className="underline" onClick={() => { localStorage.removeItem('playnx_token'); sessionStorage.removeItem('playnx_token'); location.assign('/login'); }}>Use a different account</button></p>}
      {user.emailVerified && !phoneOk && <p className="mt-2 text-center text-xs text-muted">You can verify your mobile any time from My Profile.</p>}
    </Shell>
  );
}

/** Second step for customers who signed up with Google: add (and verify) a mobile number, plus optional preferences. */
export function CompleteProfilePage() {
  const { user, loading, refresh, setUser } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as any)?.from as string | undefined;
  const opts = useVerificationOptions();
  const sports = useQuery({ queryKey: ['sports'], queryFn: () => get<{ sports: { id: number; name: string; slug: string }[] }>('/sports'), staleTime: Infinity });
  const [f, setF] = useState({ phone: '', sport: '', city: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'customer') return <Navigate to={homeFor(user)} replace />;
  // next: the email code (a Google sign-up still confirms its email), then where the player was going
  const done = () => { const l = landing(user, from); nav(l.to === '/complete-profile' ? (from ?? '/home') : l.to, { replace: true, state: l.to === '/verify-account' ? { ...(l.state ?? {}), fresh: true } : l.state }); };
  const save = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const phone = f.phone.replace(/[\s-]/g, '');
    if (!PHONE_RE.test(phone)) return setErr(MOBILE_MESSAGE);
    setBusy(true);
    try {
      const r = await put<{ user: typeof user }>('/me/profile', { phone, ...(f.sport ? { preferredSports: [f.sport] } : {}), ...(f.city.trim() ? { city: f.city.trim() } : {}) });
      setUser(r.user!);
    } catch (x) { setErr(apiError(x)); } finally { setBusy(false); }
  };
  return (
    <Shell portal="customer" back={false}>
      <h1 className="text-4xl font-extrabold">Almost there, {user.fullName.split(' ')[0]}</h1>
      {!user.phone ? (<>
        <p className="mb-5 mt-1 text-sm text-muted">Add your mobile number so turf owners and PlaynX can reach you about your bookings.</p>
        <form onSubmit={save} className="space-y-3.5" noValidate>
          <Input mandatory label="Mobile number" filter={FILTERS.mobile} type="tel" inputMode="tel" autoComplete="tel" placeholder="9876543210" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} hint="We'll text a 6-digit code to verify it" />
          <Select label="Preferred sport (optional)" value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })}><option value="">No preference</option>{sports.data?.sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}</Select>
          <Input label="Preferred location (optional)" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="City or area" />
          {err && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
          <Button type="submit" className="w-full" loading={busy}>Save and continue</Button>
        </form></>) : (<>
        <p className="mb-5 mt-1 text-sm text-muted">Verify your mobile number with the code we text you. Your Google email is already verified.</p>
        <VerifyRow channel="phone" target={user.phone} verified={user.phoneVerified} available={!!opts.data?.sms} onVerified={refresh} />
        <Button className="mt-6 w-full" variant={user.phoneVerified ? 'primary' : 'ghost'} onClick={done}>{user.phoneVerified ? 'Continue' : 'Verify later'}</Button>
      </>)}
    </Shell>
  );
}
