import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiError, get, post } from '../lib/api';
import { Badge, Button } from './ui';

export const useVerificationOptions = () => useQuery({ queryKey: ['verification-options'], queryFn: () => get<{ email: boolean; sms: boolean }>('/auth/verification-options'), staleTime: 5 * 60_000 });

/**
 * One contact (email or mobile) to verify with a one-time code. Honest by design: when the server has no email/SMS provider configured
 * it says so instead of pretending a code was sent. The 30 s resend cooldown mirrors the server's limit.
 */
export function VerifyRow({ channel, target, verified, available, codeSent = false, onVerified }: { channel: 'email' | 'phone'; target: string | null; verified: boolean; available: boolean; codeSent?: boolean; onVerified(): void | Promise<void> }) {
  const label = channel === 'email' ? 'Email' : 'Mobile';
  const [sent, setSent] = useState(codeSent);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'send' | 'verify'>('');
  const [error, setError] = useState('');
  const [wait, setWait] = useState(codeSent ? 30 : 0);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const send = async () => {
    setError(''); setBusy('send');
    try { await post('/auth/otp/send', { channel }); setSent(true); setCode(''); setWait(30); }
    catch (e) { setError(apiError(e)); } finally { setBusy(''); }
  };
  const verify = async () => {
    setError(''); setBusy('verify');
    try { await post('/auth/otp/verify', { channel, code }); await onVerified(); }
    catch (e) { setError(apiError(e)); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-2 rounded-xl border border-line p-3" data-testid={`verify-${channel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span><b>{label}</b> <span className="text-muted">{target ?? 'not added'}</span></span>
        {verified ? <Badge status="verified" /> : !target ? <span className="text-xs text-muted">Add one in your profile</span> : !available ? <Badge status="pending">Not verified</Badge> : null}
      </div>
      {!verified && target && !available && <p className="text-xs text-muted">{channel === 'email' ? 'Email delivery is not set up on this server yet, so a code cannot be sent.' : 'SMS delivery is not set up on this server yet, so a code cannot be sent.'}</p>}
      {!verified && target && available && (
        <div className="flex flex-wrap items-center gap-2">
          {sent && <input className="field !w-32 !py-2 text-center tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label={`${label} verification code`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6 && !busy) { e.preventDefault(); verify(); } }} />}
          {sent && <Button type="button" className="!py-2" disabled={code.length !== 6} loading={busy === 'verify'} onClick={verify}>Verify {label.toLowerCase()}</Button>}
          <Button type="button" variant="ghost" className="!py-2" disabled={wait > 0} loading={busy === 'send'} onClick={send}>{!sent ? 'Send code' : wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</Button>
        </div>)}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
