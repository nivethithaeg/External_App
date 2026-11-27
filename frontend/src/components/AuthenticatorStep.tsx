import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { Button } from './ui';
import { apiError } from '../lib/api';
import { useAuth, type MfaChallenge, type User } from '../lib/auth';

/**
 * The second step of an admin sign-in. The first time it shows a QR code to add PlaynX to Google Authenticator
 * (or any authenticator app); after that it only asks for the 6-digit code.
 */
export function AuthenticatorStep({ challenge, onDone, onCancel }: { challenge: MfaChallenge; onDone(u: User): void; onCancel(): void }) {
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [qr, setQr] = useState(''); const [copied, setCopied] = useState(false);
  const setup = !!challenge.mfaSetupRequired;

  useEffect(() => {
    if (!challenge.otpauthUrl) return;
    QRCode.toDataURL(challenge.otpauthUrl, { margin: 1, width: 220, color: { dark: '#101B5C', light: '#FFFFFF' } }).then(setQr).catch(() => setQr(''));
  }, [challenge.otpauthUrl]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your authenticator app.');
    setBusy(true);
    try { onDone(await verifyMfa(challenge, code)); }
    catch (err) { setError(apiError(err)); setCode(''); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(challenge.secret ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };

  return (
    <div>
      <h1 className="text-4xl font-extrabold">{setup ? 'Set up two-step sign-in' : 'Enter your code'}</h1>
      <p className="mb-5 mt-1 text-sm text-muted">{setup
        ? 'Admin accounts need a code from an authenticator app every time they sign in. This takes a minute, once.'
        : 'Open Google Authenticator on your phone and enter the 6-digit code for PlaynX.'}</p>

      {setup && (
        <ol className="mb-5 space-y-4 text-sm">
          <li className="flex gap-3"><Num n={1} /><span>Install <b>Google Authenticator</b> (or Microsoft Authenticator) on your phone.</span></li>
          <li className="flex gap-3"><Num n={2} /><div className="min-w-0 flex-1"><span>In the app tap <b>+</b>, then <b>Scan a QR code</b>, and scan this:</span>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              {qr ? <img src={qr} alt="QR code to add PlaynX to your authenticator app" width={176} height={176} className="rounded-xl border border-line bg-white p-2" /> : <div className="grid h-44 w-44 place-items-center rounded-xl border border-line text-xs text-muted">Loading QR…</div>}
              <div className="min-w-0 text-xs text-muted">Can't scan? Choose <b>Enter a setup key</b> and type:
                <code className="mt-1 block break-all rounded-lg bg-surface2 px-2 py-1.5 font-mono text-sm tracking-wider text-ink">{challenge.secret?.replace(/(.{4})/g, '$1 ').trim()}</code>
                <button type="button" onClick={copy} className="mt-1 font-semibold text-[rgb(var(--brand-text))] underline">{copied ? 'Copied' : 'Copy key'}</button>
                <span className="mt-1 block">Key type: time based.</span>
              </div>
            </div></div></li>
          <li className="flex gap-3"><Num n={3} /><span>Enter the 6-digit code the app shows for <b>PlaynX</b>.</span></li>
        </ol>)}

      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">6-digit code</span>
          <input autoFocus className="field text-center font-mono text-2xl tracking-[.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="6-digit code"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" />
        </label>
        {error && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={busy}>{setup ? 'Turn on and sign in' : 'Verify and sign in'}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">{setup ? '' : 'Lost your phone? Ask another admin to reset your two-step sign-in. '}
        <button type="button" onClick={onCancel} className="font-semibold text-[rgb(var(--brand-text))] underline">Back to log in</button></p>
    </div>
  );
}
const Num = ({ n }: { n: number }) => <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7200FF] to-[#A100FF] text-xs font-bold text-white">{n}</span>;
