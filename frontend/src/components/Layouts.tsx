import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_TEL } from '../lib/contact';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useInstallApp } from '../lib/install';
import { useLogoutConfirm } from './LogoutConfirm';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageTransition } from './Motion';
import { Logo, LogoMark } from './Logo';
import { needsEmailVerification, needsOwnerSignup, useAuth } from '../lib/auth';
import { useVerificationOptions } from './VerifyRow';
import { useTheme } from '../lib/theme';
import { useToast } from '../lib/toast';
import { get, post } from '../lib/api';
import { useNotificationSocket } from '../lib/socket';
import { cx } from '../lib/utils';
import { Loading } from './ui';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Appearance: switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="grid place-items-center rounded-xl border border-[#101B5C] bg-[#101B5C] p-2 text-[#A77BFF] transition duration-200 ease-out hover:scale-105 hover:border-[#1B2A80] hover:bg-[#1B2A80] hover:text-[#C9A6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7200FF] active:scale-95 dark:border-white/10">
      {/* Lucide "sliders-horizontal" (ISC licence), drawn inline so no icon library is needed */}
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" />
        <line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" />
      </svg>
    </button>
  );
}

export function NotificationBell({ to }: { to: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => get('/me/notifications', { limit: 1 }), enabled: !!user, refetchInterval: 60000 });
  useNotificationSocket(!!user, (n) => { qc.invalidateQueries({ queryKey: ['notifications'] }); toast(`${n.title}: ${n.body}`, 'info'); });
  const unread = q.data?.unread ?? 0;
  return (
    <Link to={to} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="bell relative rounded-xl border border-line p-2 text-sm hover:bg-surface2">
      <span aria-hidden="true" className="bell-ico inline-block">🔔</span>{unread > 0 && <span key={unread} className="bell-badge absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-ink">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}

/** Route guard: sends anonymous / wrong-role visitors to the right login page. */
export function RequireRole({ role, children }: { role: 'customer' | 'owner' | 'admin' | 'staff'; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to={role === 'admin' ? '/admin/login' : role === 'owner' || role === 'staff' ? '/owner/login' : '/login'} state={{ from: loc.pathname + loc.search }} replace />;
  if (user.role !== role) return <WrongAccount need={role} from={loc.pathname + loc.search} />;
  if (role === 'owner' && needsOwnerSignup(user)) return <Navigate to={user.emailVerified ? '/owner/complete-signup' : '/verify-account'} replace state={{ from: '/owner/complete-signup' }} />;
  if (role === 'customer' && needsEmailVerification(user)) return <NeedsVerification from={loc.pathname + loc.search}>{children}</NeedsVerification>;
  return <>{children}</>;
}

const ROLE_NAME = { customer: 'player', owner: 'venue owner', admin: 'admin', staff: 'venue staff' } as const;
const LOGIN_OF = { customer: '/login', owner: '/owner/login', admin: '/admin/login', staff: '/owner/login' } as const;
/**
 * Someone signed in with one kind of account opened a page for another (for example an admin email link while the
 * browser is signed in as a venue owner). Say so, and offer to switch accounts and come straight back to the page.
 */
function WrongAccount({ need, from }: { need: keyof typeof ROLE_NAME; from: string }) {
  const { user, logout } = useAuth(); const nav = useNavigate();
  const mine = user!.role as keyof typeof ROLE_NAME;
  const home = mine === 'admin' ? '/admin' : mine === 'owner' ? '/owner' : mine === 'staff' ? '/staff' : '/home';
  const switchAccount = () => { logout(); nav(LOGIN_OF[need], { replace: true, state: { from } }); };
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-4">
      <div role="alert" className="card w-full max-w-md p-6 text-center sm:p-8">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[#F5F0FF] text-2xl dark:bg-surface2" aria-hidden="true">🔐</span>
        <h1 className="font-display text-2xl font-bold">This page is for {need === 'admin' ? 'an' : 'a'} {ROLE_NAME[need]} account</h1>
        <p className="mt-2 text-sm text-muted">You are signed in as <b className="text-ink">{user!.fullName}</b> ({ROLE_NAME[mine]}). Log out and sign in with your {ROLE_NAME[need]} account to open it.</p>
        <div className="mt-6 grid gap-2">
          <button type="button" className="btn-primary !py-3" onClick={switchAccount}>Log out and log in as {ROLE_NAME[need]}</button>
          <Link to={home} className="btn-ghost !py-3">Go to my {ROLE_NAME[mine]} portal</Link>
        </div>
      </div>
    </div>);
}

/** Customer pages open only after the email code is confirmed. If the server cannot send email at all, nobody is locked out. */
function NeedsVerification({ from, children }: { from: string; children: ReactNode }) {
  const opts = useVerificationOptions();
  if (opts.isLoading) return <Loading />;
  if (opts.data?.email === false) return <>{children}</>;
  return <Navigate to="/verify-account" replace state={{ from }} />;
}

export function VerifyBanner() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user || user.role === 'admin' || user.emailVerified) return null;
  const send = async () => {
    setBusy(true);
    try { await post('/auth/otp/send', { channel: 'email' }); setStep('code'); toast(`Code sent to ${user.email}`); }
    catch (e: any) { toast(e?.response?.data?.error?.message ?? 'Could not send code', 'error'); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try { await post('/auth/otp/verify', { channel: 'email', code }); await refresh(); toast('Email verified'); }
    catch (e: any) { toast(e?.response?.data?.error?.message ?? 'Verification failed', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="border-b border-warn/30 bg-warn/10 px-4 py-2.5 text-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <span>Verify your email to book turfs and receive confirmations.</span>
        {step === 'idle' ? <button className="btn-ghost !py-1.5" disabled={busy} onClick={send}>Send code</button> : (
          <span className="flex items-center gap-2">
            <input className="field !w-32 !py-1.5 text-center tracking-widest" inputMode="numeric" maxLength={6} placeholder="000000" aria-label="Verification code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary !py-1.5" disabled={busy || code.length !== 6} onClick={verify}>Verify</button>
            <button className="text-xs text-muted underline" onClick={send} disabled={busy}>Resend</button>
          </span>)}
      </div>
    </div>
  );
}

const SOCIALS = ([['Instagram', import.meta.env.VITE_SOCIAL_INSTAGRAM], ['Facebook', import.meta.env.VITE_SOCIAL_FACEBOOK], ['YouTube', import.meta.env.VITE_SOCIAL_YOUTUBE], ['LinkedIn', import.meta.env.VITE_SOCIAL_LINKEDIN]] as [string, string | undefined][]).filter((x): x is [string, string] => !!x[1]);

const sheetCls = ({ isActive }: { isActive: boolean }) => cx('rounded-lg px-3 py-2.5 text-[15px] font-semibold transition', isActive ? 'bg-brand/15 text-brand' : 'text-ink active:bg-surface2');
const navCls = ({ isActive }: { isActive: boolean }) => cx('relative rounded-lg px-3 py-2 text-sm font-semibold transition after:absolute after:inset-x-3 after:-bottom-[17px] after:h-0.5 after:rounded after:bg-brand after:transition-transform after:duration-300', isActive ? 'text-ink after:scale-x-100' : 'text-muted after:scale-x-0 hover:text-ink hover:after:scale-x-50');

type MenuItem = { to: string; label: string };
const MENUS: { label: string; items: MenuItem[]; auth?: boolean; needsOffers?: boolean }[] = [
  { label: 'Bookings', auth: true, items: [{ to: '/bookings', label: 'My Bookings' }, { to: '/favourites', label: 'Favourites' }] },
  { label: 'Offers', needsOffers: true, items: [{ to: '/offers', label: 'Offers & Coupons' }] }, // shown only while at least one coupon is live
];
const ACCOUNT_ITEMS: MenuItem[] = [{ to: '/payments', label: 'Payments' }, { to: '/wallet', label: 'My Wallet' }, { to: '/my-reviews', label: 'My Reviews' }, { to: '/notifications', label: 'Notifications' }, { to: '/support', label: 'Help & Support' }, { to: '/profile', label: 'My Profile' }, { to: '/settings', label: 'Settings' }];

/** A dropdown that opens on click, closes on Escape, outside click and navigation. */
function NavMenu({ label, items, align = 'left', avatar }: { label: string; items: MenuItem[]; align?: 'left' | 'right'; avatar?: ReactNode }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const active = items.some((i) => loc.pathname === i.to || loc.pathname.startsWith(i.to + '/'));
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cx('relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition after:absolute after:inset-x-3 after:-bottom-[17px] after:h-0.5 after:rounded after:bg-brand after:transition-transform after:duration-300', active ? 'text-ink after:scale-x-100' : 'text-muted hover:text-ink')}>{avatar}{label} <span aria-hidden="true" className={cx('text-[10px] transition-transform duration-200', open && 'rotate-180')}>▾</span></button>
      {open && <div role="menu" aria-label={label} className={cx('m-menu absolute z-50 mt-1 min-w-52 rounded-xl border border-line bg-surface p-1 shadow-card', align === 'right' ? 'right-0' : 'left-0')}>
        {items.map((i) => <NavLink key={i.to} to={i.to} role="menuitem" className={({ isActive }) => cx('block rounded-lg px-3 py-2 text-sm font-semibold', isActive ? 'bg-surface2 text-ink' : 'text-muted hover:bg-surface2 hover:text-ink')}>{i.label}</NavLink>)}
      </div>}
    </div>
  );
}

const SOCIAL_ICON: Record<string, string> = {
  Instagram: 'M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.3-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z',
  Facebook: 'M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.9.4-1.7 1.8-1.7h1.6V3.8S15.6 3.5 14.3 3.5c-2.6 0-4.2 1.6-4.2 4.4v2.6H7.3v3.3h2.8V22z',
  YouTube: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z',
  LinkedIn: 'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4V21H3zM9.5 9.5h3.8v1.6h.1c.5-1 1.8-2 3.7-2 4 0 4.7 2.6 4.7 6V21h-4v-5c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7V21h-4z',
};

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10 md:border-0">
      <h2 className="m-0"><button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between py-4 text-left font-display text-sm font-bold uppercase tracking-[.18em] text-white md:cursor-default md:py-0 md:pb-5">
        <span className="relative pb-2 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-6 after:rounded after:bg-[#7200FF]">{title}</span>
        <span aria-hidden="true" className={`text-[#7200FF] transition md:hidden ${open ? 'rotate-180' : ''}`}>▾</span></button></h2>
      <div className={`${open ? 'block' : 'hidden'} pb-4 md:block md:pb-0`}>{children}</div>
    </div>
  );
}

const footLink = 'inline-block text-sm text-white/70 transition duration-200 hover:translate-x-1 hover:text-[#C9A6FF]';

/** The customer-facing footer: only customer pages. Owner and admin portals are not linked from here. */
function CustomerFooter({ loggedIn, hasOffers }: { loggedIn: boolean; hasOffers: boolean }) {
  const app = useInstallApp();
  const col = (label: string, items: [string, string][]) => (
    <FooterColumn title={label}><nav aria-label={label}><ul className="space-y-3">{items.map(([t, to]) => <li key={t}><Link className={footLink} to={to}>{t}</Link></li>)}</ul></nav></FooterColumn>);
  return (
    <footer className="mt-16 bg-[#101B5C] text-white/70">
      <div className="h-1 bg-gradient-to-r from-[#7200FF] via-[#A100FF] to-[#7200FF]" aria-hidden="true" />
      <div className="mx-auto grid max-w-7xl gap-x-10 gap-y-2 px-4 py-12 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] lg:gap-y-8">
        <div className="mb-6 md:col-span-2 lg:col-span-1 lg:mb-0">
          <Link to="/" aria-label="PlaynX home" className="inline-block"><Logo onDark /></Link>
          <p className="mt-4 font-display text-lg font-semibold tracking-wide text-white">Play <span className="text-[#A100FF]">•</span> Experience <span className="text-[#A100FF]">•</span> Repeat</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed">PlaynX is an online sports turf booking platform. Discover nearby venues, check live availability and book your game in minutes.</p>
          <ul className="mt-4 space-y-2 text-sm" aria-label="Contact PlaynX">
            <li><a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex items-center gap-2 text-white/85 transition hover:text-[#C9A6FF]"><span aria-hidden="true">✉️</span>{SUPPORT_EMAIL}</a></li>
            <li><a href={SUPPORT_TEL} className="inline-flex items-center gap-2 text-white/85 transition hover:text-[#C9A6FF]"><span aria-hidden="true">📞</span>{SUPPORT_PHONE}</a></li>
          </ul>
          {SOCIALS.length > 0 && <ul className="mt-5 flex gap-3" aria-label="Social media">{SOCIALS.map(([n, u]) => (
            <li key={n}><a href={u} target="_blank" rel="noreferrer" aria-label={n} className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-white transition duration-200 hover:-translate-y-0.5 hover:border-[#A100FF] hover:bg-[#7200FF]"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={SOCIAL_ICON[n]} /></svg></a></li>))}</ul>}
        </div>
        {col('Explore', [['Book a turf', '/home#book'], ['For venue owners', '/#owners'], ['Sports Categories', '/sports'], ...(hasOffers ? [['Offers & Coupons', '/offers'] as [string, string]] : [])])}
        {loggedIn ? col('My Account', [['My Profile', '/profile'], ['My Bookings', '/bookings'], ['Payment History', '/payments'], ['Saved Turfs', '/favourites']])
          : col('My Account', [['Log in', '/login'], ['Create account', '/register']])}
        {col('Customer Support', [['Help Centre', '/help'], ['Contact Us', '/contact'], ['FAQs', '/help'], ['Cancellation & Refunds', '/cancellation-policy']])}
        {col('Legal', [['Terms & Conditions', '/terms'], ['Privacy Policy', '/privacy'], ['Cookie Policy', '/cookies'], ['Refund Policy', '/cancellation-policy']])}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs sm:flex-row">
          <p>© {new Date().getFullYear()} PlaynX. All rights reserved.</p>
          {app.canInstall && <button type="button" onClick={app.install} className="rounded-full border border-[#A100FF]/60 px-4 py-1.5 font-semibold text-white transition hover:bg-[#7200FF]/30 active:scale-95">⬇ Install the app</button>}
          <p className="font-semibold text-white/80">Made for the love of <span className="text-[#C9A6FF]">sports</span>.</p>
        </div>
      </div>
    </footer>
  );
}

const COOKIE_KEY = 'playnx_cookie_notice';
/** A one-time note that we only store what the site needs. It is informative (there is nothing optional to switch off) and is remembered once dismissed. */
function CookieNotice() {
  const [shown, setShown] = useState(() => { try { return localStorage.getItem(COOKIE_KEY) !== '1'; } catch { return false; } });
  const reduce = useReducedMotion();
  const close = () => { try { localStorage.setItem(COOKIE_KEY, '1'); } catch { /* ignore */ } setShown(false); };
  return (
    <AnimatePresence>
      {shown && (
        <motion.div role="region" aria-label="Cookie notice" initial={reduce ? false : { y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl md:bottom-3 flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-[#101B5C]/95 p-4 text-sm text-white shadow-[0_16px_40px_-12px_rgb(0_0_0/.7)] backdrop-blur">
          <p className="min-w-0 flex-1 text-white/80">We only store what PlaynX needs to work, such as your login and preferences. No advertising or tracking cookies. <Link to="/cookies" className="font-semibold text-[#A100FF] underline">Cookie policy</Link></p>
          <button type="button" onClick={close} className="rounded-xl bg-brand px-5 py-2 text-sm font-bold text-brand-ink transition hover:brightness-110 active:scale-95">Got it</button>
        </motion.div>)}
    </AnimatePresence>);
}

/** The customer's profile picture, or their initial on an orange disc when none is uploaded. */
function Avatar({ url, name }: { url?: string | null; name: string }) {
  return url ? <img src={url} alt="" className="h-7 w-7 shrink-0 rounded-full border border-brand/60 object-cover" /> : <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">{name.trim().charAt(0).toUpperCase()}</span>;
}


const TAB_ICONS: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5V14h4v5.5h4.5V10',
  explore: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  bookings: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5',
  pin: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.800 12 21 12 21Zm0-8.500a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  login: 'M14 4h5v16h-5M10 8l4 4-4 4M3 12h11',
  menu: 'M4 7h16M4 12h16M4 17h16',
};
function TabIcon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TAB_ICONS[name]} /></svg>;
}

/** Phone-only bottom tab bar (like a shopping app): the main places one tap away, everything else under Menu. */
function BottomTabs({ loggedIn, menuOpen, onMenu }: { loggedIn: boolean; menuOpen: boolean; onMenu(): void }) {
  const tabs = loggedIn
    ? [{ to: '/home', label: 'Home', icon: 'home', end: true }, { to: '/bookings', label: 'Bookings', icon: 'bookings' }, { to: '/profile', label: 'Profile', icon: 'user' }]
    : [{ to: '/', label: 'Home', icon: 'home', end: true }, { to: '/nearby', label: 'Nearby', icon: 'pin' }, { to: '/login', label: 'Log in', icon: 'login' }];
  const cls = (on: boolean) => cx('relative flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-semibold transition-colors', on ? 'text-brand' : 'text-muted active:text-ink');
  const bar = (on: boolean) => on && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand" aria-hidden="true" />;
  return (
    <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgb(16_27_92/.3)] backdrop-blur md:hidden">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cls(isActive && !menuOpen)}>
          {({ isActive }) => <>{bar(isActive && !menuOpen)}<TabIcon name={t.icon} /><span className="truncate">{t.label}</span></>}
        </NavLink>))}
      <button type="button" onClick={onMenu} aria-expanded={menuOpen} aria-label="Menu" className={cls(menuOpen)}>{bar(menuOpen)}<TabIcon name="menu" /><span>Menu</span></button>
    </nav>);
}

/**
 * "Back" arrow shown on every page inside a portal except its home page. It goes to the previous page in the app, or to the
 * home page when the page was opened directly (a link, a refresh), so pressing it again and again always ends at home.
 */
export function BackButton({ home, alsoHome = [] }: { home: string; alsoHome?: string[] }) {
  const nav = useNavigate(); const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  if ([home, ...alsoHome].includes(path)) return null;
  const back = () => { const idx = (window.history.state as { idx?: number } | null)?.idx; if (typeof idx === 'number' && idx > 0) nav(-1); else nav(home); };
  return (
    <button type="button" onClick={back} aria-label="Go back" className="back-btn group mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-2 pr-4 text-sm font-semibold text-ink shadow-sm transition hover:border-brand/50 hover:text-[rgb(var(--brand-text))]">
      <span className="back-ico grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#7200FF] to-[#A100FF] text-white transition group-hover:-translate-x-0.5" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5m6-6-6 6 6 6" /></svg>
      </span>Back
    </button>);
}

export function CustomerLayout() {
  const { user, logout } = useAuth();
  const staffHome = user?.role === 'staff'; // staff have only their check-in screen
  const offersQ = useQuery({ queryKey: ['offers', 'menu'], queryFn: () => get<{ offers: unknown[] }>('/offers'), staleTime: 5 * 60_000 });
  const hasOffers = (offersQ.data?.offers?.length ?? 0) > 0;
  const avatarQ = useQuery({ queryKey: ['profile'], queryFn: () => get<{ profile: { avatar_url?: string | null } | null }>('/me/profile'), enabled: !!user, staleTime: 5 * 60_000 });
  const menus = MENUS.filter((m) => (!m.auth || user) && (!m.needsOffers || hasOffers));
  const nav = useNavigate();
  const logoutAsk = useLogoutConfirm(() => { logout(); nav('/'); });
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const on = () => setScrolled(window.scrollY > 8); on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on); }, []);
  if (staffHome) return <Navigate to="/staff" replace />;
  return (
    <div className="customer-theme min-h-screen overflow-x-clip pb-[calc(3.6rem+env(safe-area-inset-bottom))] md:pb-0">
      <header className={cx('sticky top-0 z-40 border-b bg-white/95 backdrop-blur transition-shadow duration-300 dark:bg-surface/95', scrolled ? 'border-transparent shadow-[0_6px_24px_-12px_rgb(16_27_92/.35)]' : 'border-line')}>
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-3 px-4">
          <Link to="/" aria-label="PlaynX home"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to={user ? '/home' : '/'} end className={navCls}>Home</NavLink>
            {menus.map((m) => <NavMenu key={m.label} label={m.label} items={m.items} />)}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user ? (<>
              <NotificationBell to="/notifications" />
              <div className="hidden sm:block"><NavMenu label={user.fullName.split(' ')[0]} items={ACCOUNT_ITEMS} align="right" avatar={<Avatar url={avatarQ.data?.profile?.avatar_url} name={user.fullName} />} /></div>
              <button className="btn-ghost !py-2 hidden md:inline-flex" onClick={logoutAsk.ask}>Log out</button>
            </>) : (<><Link to="/login" className="btn-ghost !py-2 hidden md:inline-flex">Log in</Link><Link to="/register" className="btn-primary !py-2 hidden sm:inline-flex">Sign up</Link></>)}
          </div>
        </div>
      </header>
      <VerifyBanner />
      <main className="mx-auto max-w-7xl px-4 py-8"><BackButton home={user?.role === 'customer' ? '/home' : '/'} alsoHome={user?.role === 'customer' ? ['/'] : []} /><PageTransition routeKey={loc.pathname}><Outlet /></PageTransition></main>
      <CustomerFooter loggedIn={!!user} hasOffers={hasOffers} />
      {open && (
        <div className="fixed inset-0 z-[55] md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
          <nav className="absolute inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] max-h-[75vh] animate-slide overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 text-ink shadow-2xl" aria-label="Mobile">
            <NavLink to={user ? '/home' : '/'} end className={sheetCls}>Home</NavLink>
            {menus.map((m) => <div key={m.label}><p className="px-3 pt-3 text-xs font-bold uppercase tracking-wider text-muted">{m.label}</p><div className="grid grid-cols-2 gap-1">{m.items.map((it) => <NavLink key={it.to} to={it.to} className={sheetCls}>{it.label}</NavLink>)}</div></div>)}
            {user && <div><p className="px-3 pt-3 text-xs font-bold uppercase tracking-wider text-muted">Account</p><div className="grid grid-cols-2 gap-1">{ACCOUNT_ITEMS.map((it) => <NavLink key={it.to} to={it.to} className={sheetCls}>{it.label}</NavLink>)}</div></div>}
            {user ? <button type="button" className="btn-ghost mt-4 w-full" onClick={() => { setOpen(false); logoutAsk.ask(); }}>Log out</button> : <div className="mt-4 grid grid-cols-2 gap-2"><Link to="/login" className="btn-ghost">Log in</Link><Link to="/register" className="btn-primary">Sign up</Link></div>}
          </nav>
        </div>)}
      <BottomTabs loggedIn={!!user} menuOpen={open} onMenu={() => setOpen((o) => !o)} />
      {logoutAsk.dialog}
      <CookieNotice />
    </div>
  );
}

export interface NavItem { to: string; label: string; icon: string; end?: boolean }
export interface NavGroup { label: string; items: NavItem[] }

function ProfileMenu({ onLogout, links }: { onLogout(): void; links: { to: string; label: string }[] }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 text-sm hover:bg-surface2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-extrabold text-brand-ink" aria-hidden="true">{user?.fullName.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-[120px] truncate font-semibold sm:block">{user?.fullName}</span><span aria-hidden="true" className="text-xs text-muted">▾</span>
      </button>
      {open && (
        <div role="menu" className="card m-menu absolute right-0 z-50 mt-2 w-56 overflow-hidden p-1 text-sm">
          <div className="border-b border-line px-3 py-2"><div className="truncate font-semibold">{user?.fullName}</div><div className="truncate text-xs text-muted">{user?.email}</div></div>
          {links.map((l) => <Link key={l.to} role="menuitem" to={l.to} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-surface2">{l.label}</Link>)}
          <button role="menuitem" onClick={onLogout} className="logout-roll block w-full rounded-lg px-3 py-2 text-left text-danger hover:bg-danger/10">Log out</button>
        </div>)}
    </div>
  );
}

/** Dashboard shell: grouped sidebar (drawer on mobile), top bar with page title, search, help, notifications and profile menu, and breadcrumbs. */
/**
 * The orange active background for the admin sidebar: ONE rounded element that travels between menu items (a springy
 * cubic-bezier on its position and size, with a gentle 1.03 swell while it moves). It is measured from the active link, so it also follows the
 * sidebar when it collapses or the window resizes; those changes are applied instantly so the pill never lags behind.
 */
function NavPill({ routeKey, layoutKey, reduce }: { routeKey: string; layoutKey: string; reduce: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const instant = useRef(true); const first = useRef(true);
  const measure = () => {
    const nav = el.current?.parentElement; const a = nav?.querySelector<HTMLElement>("a[aria-current='page']");
    if (!nav || !a) return setBox(null);
    // add up layout offsets until the nav: correct even while a row is animating in (a transformed row becomes the offset parent)
    let x = 0, y = 0, n: HTMLElement | null = a;
    while (n && n !== nav) { x += n.offsetLeft; y += n.offsetTop; const p = n.offsetParent as HTMLElement | null; if (p && !nav.contains(p) && p !== nav) { x = a.offsetLeft; y = a.offsetTop; break; } n = p; }
    setBox({ x, y, w: a.offsetWidth, h: a.offsetHeight });
  };
  useLayoutEffect(() => { instant.current = first.current || reduce; first.current = false; measure(); }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // the menu rows and group links fade in: fit the pill again once each animation ends
    const nav = el.current?.parentElement; if (!nav) return;
    const on = (e: AnimationEvent) => { if (e.target !== el.current?.firstElementChild) { instant.current = true; measure(); } };
    nav.addEventListener('animationend', on); return () => nav.removeEventListener('animationend', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { // the menu changed shape (collapsed, a group opened): re-fit at once, and again once the width animation has finished
    instant.current = true; measure(); const t = setTimeout(measure, 380); return () => clearTimeout(t);
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const nav = el.current?.parentElement; if (!nav || typeof ResizeObserver === 'undefined') return;
    let lastW = nav.offsetWidth; // only a change of WIDTH (collapse, window resize) is applied instantly; a route change keeps its slide
    const ro = new ResizeObserver(() => { if (nav.offsetWidth !== lastW) { lastW = nav.offsetWidth; instant.current = true; } measure(); }); ro.observe(nav); return () => ro.disconnect();
  }, []);
  return (
    <span ref={el} aria-hidden="true" className="pointer-events-none absolute left-0 top-0"
      style={box ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h, transition: instant.current ? 'none' : 'transform .5s cubic-bezier(.34, 1.25, .5, 1), width .35s ease, height .35s ease' } : { visibility: 'hidden' }}>
      <span key={routeKey} className={cx('nav-pill block h-full w-full rounded-xl bg-brand', !reduce && 'nav-pill-swell')} />
    </span>);
}

/** Fades the old page out and slides the new one in from the right; waits for the exit so rapid clicks never overlap or flicker. */
function AdminPage({ routeKey, reduce }: { routeKey: string; reduce: boolean }) {
  const outlet = useOutlet();
  if (reduce) return <>{outlet}</>;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={routeKey} className={routeKey === '/admin' ? undefined : 'page-stagger'} initial={{ opacity: 0, x: 26 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.26, ease: 'easeInOut' }}>{outlet}</motion.div>
    </AnimatePresence>);
}

/**
 * Light theme only: the page content fades up a few pixels each time a new page opens. Played with the Web Animations API on a
 * plain wrapper, so the page is never remounted (its state is kept) and nothing is left transformed afterwards.
 */
function LightPageIn({ routeKey, reduce, children }: { routeKey: string; reduce: boolean; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (reduce || document.documentElement.getAttribute('data-theme') === 'dark' || !el.current?.animate) return;
    el.current.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  }, [routeKey, reduce]);
  return <div ref={el}>{children}</div>;
}

export function PortalLayout({ items, groups, subtitle, notificationsPath, helpPath, searchPath, profileLinks = [], rootLabel, confirmLogout, adminTheme, animatedSidebar }: {
  items?: NavItem[]; groups?: NavGroup[]; subtitle: string; notificationsPath: string; helpPath?: string; searchPath?: string; profileLinks?: { to: string; label: string }[]; rootLabel?: string; confirmLogout?: boolean; adminTheme?: boolean; animatedSidebar?: boolean;
}) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  if (adminTheme && user?.role === 'admin' && user.permissions) {
    items = items?.filter((i) => canSeeAdminPage(user.permissions, i.to));
    groups = groups?.map((g) => ({ ...g, items: g.items.filter((i) => canSeeAdminPage(user.permissions, i.to)) })).filter((g) => g.items.length > 0);
  }
  const loc = useLocation();
  const { toast } = useToast();
  useEffect(() => setOpen(false), [loc.pathname]);
  const all: NavGroup[] = groups ?? [{ label: '', items: items ?? [] }];
  const flat = all.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
  const current = [...flat].sort((x, y) => y.to.length - x.to.length).find((i) => (i.end ? loc.pathname === i.to : loc.pathname === i.to || loc.pathname.startsWith(i.to + '/')));
  const leave = () => { logout(); nav('/'); };
  const logoutAsk = useLogoutConfirm(leave, 'owner');
  const doLogout = confirmLogout ? logoutAsk.ask : leave; // the venue owner portal asks first
  // Collapsible sections: the one containing the current page is always open; others open on click.
  const activeGroup = current?.group ?? '';
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  useEffect(() => { if (activeGroup) setOpenGroups((o) => (o.includes(activeGroup) ? o : [...o, activeGroup])); }, [activeGroup]);
  const toggle = (label: string) => setOpenGroups((o) => (o.includes(label) ? o.filter((x) => x !== label) : [...o, label]));
  const reduce = !!useReducedMotion();
  const admin = !!adminTheme; // the admin portal also gets its palette and page transitions
  const fancy = admin || !!animatedSidebar; // animated sidebar: the admin and venue owner portals
  const sideKey = admin ? 'playnx_admin_side' : 'playnx_owner_side'; // each portal remembers its own choice
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(sideKey) === '1'; } catch { return false; } });
  const toggleSide = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(sideKey, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  const linkCls = ({ isActive }: { isActive: boolean }) => fancy
    ? cx('relative flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-[color,transform,box-shadow,background-color] duration-200', isActive ? 'text-brand-ink' : 'text-muted hover:text-ink')
    : cx('flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition', isActive ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-surface2 hover:text-ink');
  // a ripple from where the item was pressed
  const ripple = (e: React.PointerEvent<HTMLAnchorElement>) => { const t = e.currentTarget; const b = t.getBoundingClientRect(); t.style.setProperty('--rx', `${e.clientX - b.left}px`); t.style.setProperty('--ry', `${e.clientY - b.top}px`); t.classList.remove('side-ripple'); void t.offsetWidth; t.classList.add('side-ripple'); };
  /** One sidebar link. In the admin portal the orange background is a single shared element that glides between items, and the icon pops when its page is chosen. */
  const navItem = (i: NavItem) => (
    <NavLink key={i.to} to={i.to} end={i.end} className={(a) => cx(linkCls(a), fancy && 'side-link')} onPointerDown={fancy ? ripple : undefined} title={fancy && collapsed ? i.label : undefined}>
      {({ isActive }) => fancy ? (<>
        <motion.span aria-hidden="true" className="nav-ico relative w-5 text-center" animate={{ scale: isActive ? 1.14 : 1, rotate: 0 }} whileHover={reduce ? undefined : { scale: 1.18, rotate: -6 }} whileTap={reduce ? undefined : { scale: 0.88, rotate: 8 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>{i.icon}</motion.span>
        <span className="nav-label side-label relative">{i.label}</span></>)
        : (<><span aria-hidden="true" className="w-5 shrink-0 text-center">{i.icon}</span><span className="min-w-0 leading-tight">{i.label}</span></>)}
    </NavLink>);
  const side = (
    <nav className={cx('space-y-1', fancy && 'side-nav relative')} aria-label={`${subtitle} navigation`}>
      {fancy && <NavPill routeKey={loc.pathname} layoutKey={`${collapsed}|${openGroups.join(',')}`} reduce={reduce} />}
      {all.map((g) => {
        // Single-item or unlabeled sections render as a plain link; the rest are dropdowns. A collapsed sidebar shows every item as an icon.
        if (!g.label || g.items.length === 1 || (fancy && collapsed)) return g.items.map((i) => (
          navItem(i)));
        const isOpen = openGroups.includes(g.label);
        const hasActive = g.label === activeGroup;
        const id = `nav-${g.label.replace(/\W+/g, '-').toLowerCase()}`;
        return (
          <div key={g.label}>
            <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => toggle(g.label)}
              className={cx('side-group-btn flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold transition hover:bg-surface2', hasActive ? 'text-ink' : 'text-muted')}>
              <span>{g.label}</span>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" className={cx('side-chevron shrink-0', isOpen && 'rotate-180')}><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {isOpen && <div id={id} className="side-group mb-2 ml-2 mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">{g.items.map((i) => (
              navItem(i)))}</div>}
          </div>);
      })}
    </nav>
  );
  return (
    <div data-collapsed={fancy && collapsed ? 'true' : 'false'} style={fancy ? ({ '--side-w': collapsed ? '76px' : '260px' } as React.CSSProperties) : undefined} className={cx('min-h-screen lg:grid', fancy ? 'lg:grid-cols-[var(--side-w)_1fr] side-anim' : 'lg:grid-cols-[260px_1fr]', admin && 'admin-theme', fancy && 'fancy-nav', fancy && !admin && 'owner-portal')}>
      <aside className={cx('sticky top-0 hidden h-screen flex-col gap-5 overflow-y-auto overflow-x-hidden border-r border-line bg-surface p-4 lg:flex', fancy && 'side-enter')}>
        {fancy ? <span className="side-logo block"><span className="side-full"><Logo subtitle={subtitle} /></span><span className="side-mini"><LogoMark size={36} /></span></span> : <Logo subtitle={subtitle} />}{side}
        <div className="mt-auto space-y-2 pt-4 text-xs text-muted">
          {fancy && <button type="button" onClick={toggleSide} aria-pressed={collapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="side-toggle grid h-9 w-9 place-items-center rounded-full border border-line text-muted transition hover:border-brand hover:text-ink"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cx('side-toggle-ico', collapsed && 'rotate-180')}><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="portal-top sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur">
          {/* page change: a light beam and a ball run along the bottom of the top bar */}
          <span key={loc.pathname} aria-hidden="true" className="route-sweep"><i className="route-beam" /><i className="route-ball">⚽</i></span>
          <button className="rounded-xl border border-line p-2 lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>☰</button>
          {fancy && <button type="button" className="hidden rounded-xl border border-line p-2 lg:block" aria-label={collapsed ? 'Show full menu' : 'Close menu to icons'} aria-pressed={collapsed} onClick={toggleSide}>{collapsed ? '☰' : '✕'}</button>}
          <span className="lg:hidden"><Logo /></span>
          <h2 key={current?.label ?? subtitle} className="title-swap hidden font-display text-2xl font-bold lg:block">{current?.label ?? subtitle}</h2>
          {searchPath && (
            <form role="search" className="ml-auto hidden max-w-xs flex-1 md:block" onSubmit={(e) => { e.preventDefault(); if (term.trim()) { nav(`${searchPath}?q=${encodeURIComponent(term.trim())}`); setTerm(''); } }}>
              <input className="field !py-2" type="search" aria-label="Search bookings" placeholder="Search booking ref, customer…" value={term} onChange={(e) => setTerm(e.target.value)} /></form>)}
          <div className={cx('flex items-center gap-2', searchPath ? '' : 'ml-auto')}>
            {helpPath && <Link to={helpPath} aria-label="Help and support" className="rounded-xl border border-line px-3 py-2 text-sm hover:bg-surface2">?</Link>}
            <ThemeToggle /><NotificationBell to={notificationsPath} /><ProfileMenu onLogout={doLogout} links={profileLinks} />
          </div>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <div className="drawer-backdrop absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="drawer-panel absolute inset-y-0 left-0 w-72 max-w-[85%] space-y-5 overflow-y-auto border-r border-line bg-surface p-4">
              <div className="flex items-center justify-between"><Logo subtitle={subtitle} /><button aria-label="Close menu" className="rounded-lg p-1 text-muted hover:bg-surface2" onClick={() => setOpen(false)}>✕</button></div>
              {side}<button className="btn-ghost w-full" onClick={doLogout}>Log out</button></div>
          </div>)}
        <VerifyBanner />
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          <nav key={loc.pathname} aria-label="Breadcrumb" className="crumbs crumb-in mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Link className="hover:text-ink" to={flat[0]?.to ?? '/'}>{rootLabel ?? subtitle}</Link>
            {current && current.to !== flat[0]?.to && <>{current.group && <><span aria-hidden="true">›</span><span>{current.group}</span></>}<span aria-hidden="true">›</span><span aria-current="page" className="font-semibold text-ink">{current.label}</span></>}
          </nav>
          {admin ? <AdminPage routeKey={loc.pathname} reduce={reduce} /> : <LightPageIn routeKey={loc.pathname} reduce={reduce}><Outlet /></LightPageIn>}
        </main>
      </div>
      {logoutAsk.dialog}
    </div>
  );
}

export const ownerGroups: NavGroup[] = [
  { label: 'Dashboard', items: [{ to: '/owner', label: 'Overview', icon: '📊', end: true }] },
  { label: 'Venue management', items: [
    { to: '/owner/venues', label: 'My venues', icon: '🏟️' }, { to: '/owner/areas', label: 'Playing areas', icon: '🥅' },
    { to: '/owner/hours', label: 'Operating hours', icon: '🕒' }] },
  { label: 'Booking management', items: [
    { to: '/owner/bookings', label: 'All bookings', icon: '📅', end: true }, { to: '/owner/bookings/upcoming', label: 'Upcoming bookings', icon: '⏭️' },
    { to: '/owner/bookings/history', label: 'Booking history', icon: '🕘' }, { to: '/owner/bookings/cancelled', label: 'Cancelled bookings', icon: '🚫' }, { to: '/owner/customers', label: 'Customers', icon: '👥' }] },
  { label: 'Scheduling', items: [
    { to: '/owner/calendar', label: 'Calendar', icon: '🗓️' }, { to: '/owner/slots', label: 'Slot management', icon: '🧩' }, { to: '/owner/blocked', label: 'Blocked slots', icon: '⛔' }] },
  { label: 'Business management', items: [
    { to: '/owner/pricing', label: 'Pricing & rates', icon: '💲' }, { to: '/owner/offers', label: 'Offers & coupons', icon: '🏷️' }, { to: '/owner/reports', label: 'Report & Payments', icon: '📈' }] },
  { label: 'Communication', items: [
    { to: '/owner/notifications', label: 'Notifications', icon: '🔔' }, { to: '/owner/announcements', label: 'Announcements', icon: '📣' }, { to: '/owner/reviews', label: 'Reviews', icon: '⭐' }, { to: '/owner/support', label: 'Admin support', icon: '🎧' }] },
  { label: 'Account', items: [
    { to: '/owner/account/staff', label: 'Staff logins', icon: '🧑‍💼' }, { to: '/owner/activity', label: 'Activity log', icon: '🧾' },
    { to: '/owner/account/profile', label: 'My profile', icon: '👤' }, { to: '/owner/account/business', label: 'Business information', icon: '🏢' },
    { to: '/owner/account/payouts', label: 'Payouts', icon: '🏦' }, { to: '/owner/account/bank', label: 'Bank account details', icon: '🏧' }, { to: '/owner/account/payment-settings', label: 'Payment settings', icon: '💳' }, { to: '/owner/account/security', label: 'Security settings', icon: '🔐' },
    { to: '/owner/delete-account', label: 'Delete account', icon: '🗑️' }] },
];
/** The permission each admin page needs. A page without an entry is open to every admin. */
export const ADMIN_PAGE_PERMISSION: Record<string, string> = {
  '/admin/venues': 'venues', '/admin/listing-changes': 'venues', '/admin/area-approvals': 'venues', '/admin/business-changes': 'users', '/admin/sports': 'venues', '/admin/applications': 'users', '/admin/profile-changes': 'users', '/admin/owners': 'users', '/admin/users': 'users', '/admin/customers': 'users', '/admin/reviews': 'venues', '/admin/wallets': 'payouts',
  '/admin/bookings': 'bookings', '/admin/payments': 'payments', '/admin/refunds': 'refunds', '/admin/payouts': 'payouts', '/admin/coupons': 'coupons', '/admin/notify': 'notifications', '/admin/tickets': 'tickets',
  '/admin/reports': 'reports', '/admin/revenue': 'reports', '/admin/settings': 'settings', '/admin/team': 'admins',
};
export const canSeeAdminPage = (perms: string[] | undefined, to: string) => { const need = ADMIN_PAGE_PERMISSION[to]; return !need || !perms || perms.includes('*') || perms.includes(need) || perms.includes(`${need}:read`); };
export const adminGroups: NavGroup[] = [
  { label: 'Dashboard', items: [
    { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
    { to: '/admin/notifications', label: 'Notifications', icon: '🔔' }] },
  { label: 'Venue Owner Approvals', items: [
    { to: '/admin/applications', label: 'Owner applications', icon: '🗂️' },
    { to: '/admin/profile-changes', label: 'Profile changes', icon: '✏️' },
    { to: '/admin/business-changes', label: 'Business type changes', icon: '🏢' },
    { to: '/admin/venues', label: 'Venue approvals', icon: '✅' },
    { to: '/admin/area-approvals', label: 'Playing area approvals', icon: '🥅' },
    { to: '/admin/listing-changes', label: 'Listing changes', icon: '📝' }] },
  { label: 'Venues & Owners', items: [
    { to: '/admin/owners', label: 'Turf owners', icon: '🧑‍💼' },
    { to: '/admin/users', label: 'Users', icon: '👥' },
    { to: '/admin/sports', label: 'Sports', icon: '⚽' },
    { to: '/admin/payouts', label: 'Owner payouts', icon: '🏦' }] },
  { label: 'Customers', items: [
    { to: '/admin/customers', label: 'Customers', icon: '🧑' },
    { to: '/admin/bookings', label: 'Bookings', icon: '📅' },
    { to: '/admin/payments', label: 'Payments', icon: '💳' },
    { to: '/admin/refunds', label: 'Refunds', icon: '↩️' },
    { to: '/admin/wallets', label: 'Wallets', icon: '👛' },
    { to: '/admin/reviews', label: 'Reviews', icon: '⭐' },
    { to: '/admin/tickets', label: 'Complaints', icon: '🎧' },
    { to: '/admin/coupons', label: 'Coupons', icon: '🏷️' }] },
  { label: 'Logs & Reports', items: [
    { to: '/admin/reports', label: 'Reports', icon: '📈' },
    { to: '/admin/revenue', label: 'Revenue', icon: '💰' },
    { to: '/admin/notify', label: 'Broadcast', icon: '📣' },
    { to: '/admin/audit', label: 'Audit logs', icon: '🧾' }] },
  { label: 'System', items: [
    { to: '/admin/team', label: 'Admin team', icon: '🔐' },
    { to: '/admin/settings', label: 'Commission & settings', icon: '⚙️' }] },
];

/** The same pages as one flat list. */
export const adminNav: NavItem[] = adminGroups.flatMap((g) => g.items);
