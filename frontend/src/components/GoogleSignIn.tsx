import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GoogleButton } from './GoogleButton';
import { Button, Input, Modal } from './ui';
import { apiCode, apiError } from '../lib/api';
import { homeFor, landing, useAuth } from '../lib/auth';
import { cx } from '../lib/utils';

/** Google sign-in: existing accounts log straight in; new users choose Customer or Turf Owner first. */
/** `role` fixes the account type a brand-new Google user gets (owner pages pass 'owner'); without it they choose. */
export function GoogleSignIn({ text = 'continue_with', role: fixedRole }: { text?: 'continue_with' | 'signup_with' | 'signin_with'; role?: 'customer' | 'owner' }) {
  const { googleLogin } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as any)?.from as string | undefined;
  const [pending, setPending] = useState<string | null>(null);
  const [role, setRole] = useState<'customer' | 'owner'>(fixedRole ?? 'customer');
  const [business, setBusiness] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finish = (u: Awaited<ReturnType<typeof googleLogin>>) => { const l = u.role === 'customer' ? landing(u, from) : { to: homeFor(u), state: undefined }; nav(l.to, { replace: true, state: l.state }); };

  const onCredential = async (credential: string) => {
    setError(''); setBusy(true);
    try { finish(await googleLogin(credential, text === 'signup_with' && fixedRole ? { expect: fixedRole } : {})); }
    catch (e) {
      if (apiCode(e) !== 'no_account') return setError(apiError(e));
      if (fixedRole && text === 'signup_with') { // signing up with Google: the account is created straight away, no questions asked
        try { finish(await googleLogin(credential, { create: true, role: fixedRole })); } catch (e2) { setError(apiError(e2)); }
      } else if (fixedRole) setError('No account found for this Google email. Please sign up first.');
      else setPending(credential);
    }
    finally { setBusy(false); }
  };

  const create = async () => {
    if (role === 'owner' && business.trim().length < 2) return setError('Enter your business name');
    setError(''); setBusy(true);
    try { finish(await googleLogin(pending!, { create: true, role, ...(role === 'owner' ? { businessName: business.trim() } : {}) })); setPending(null); }
    catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <GoogleButton onCredential={onCredential} disabled={busy} text={text} />
      {!pending && error && <p role="alert" className="mt-2 text-center text-sm text-danger">{error}</p>}
      <Modal open={!!pending} onClose={() => { setPending(null); setError(''); }} title={fixedRole === 'owner' ? 'Create your venue owner account' : fixedRole === 'customer' ? 'Create your customer account' : 'How will you use KickOff?'}>
        <div className="space-y-4">
          <p className="text-sm text-muted">We couldn't find an account for this Google email. {fixedRole ? `We'll create a ${fixedRole === 'owner' ? 'venue owner' : 'customer'} account.` : 'Choose the type of account to create.'}</p>
          {!fixedRole && <div role="radiogroup" aria-label="Account type" className="grid gap-3 sm:grid-cols-2">
            {([['customer', '⚽', 'Customer', 'Find and book turfs'], ['owner', '🏟️', 'Turf owner', 'List and manage my venues']] as const).map(([v, icon, t, d]) => (
              <button key={v} type="button" role="radio" aria-checked={role === v} onClick={() => setRole(v)}
                className={cx('rounded-2xl border-2 p-4 text-left transition', role === v ? 'border-brand bg-brand/10' : 'border-line hover:border-brand/50')}>
                <div className="text-2xl">{icon}</div><div className="mt-1 text-lg font-bold">{t}</div><div className="text-xs text-muted">{d}</div></button>))}
          </div>}
          {role === 'owner' && <Input label="Business / venue brand" value={business} onChange={(e) => setBusiness(e.target.value)} autoFocus />}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => { setPending(null); setError(''); }}>Cancel</Button><Button loading={busy} onClick={create}>Continue</Button></div>
        </div>
      </Modal>
    </>
  );
}
