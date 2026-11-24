import { useEffect, useRef, useState } from 'react';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
declare global { interface Window { google?: any } }

let loader: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  loader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = () => resolve(); s.onerror = () => { loader = null; reject(new Error('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
  return loader;
}

/** "Continue with Google" button (Google Identity Services). Hidden when VITE_GOOGLE_CLIENT_ID is not configured. */
export function GoogleButton({ onCredential, disabled, text = 'continue_with' }: { onCredential(credential: string): void; disabled?: boolean; text?: 'continue_with' | 'signup_with' | 'signin_with' }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential); cb.current = onCredential;
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return;
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r: any) => r.credential && cb.current(r.credential) });
      window.google.accounts.id.renderButton(ref.current, { type: 'standard', theme: 'outline', size: 'large', text, shape: 'pill', width: ref.current.clientWidth || 320 });
    }).catch((e) => setErr(e.message));
    return () => { cancelled = true; };
  }, [text]);
  if (!CLIENT_ID) return null;
  return (
    <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
      <div className="my-4 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
      <div ref={ref} className="flex min-h-[44px] justify-center" />
      {err && <p role="alert" className="mt-2 text-center text-xs text-danger">{err}</p>}
    </div>
  );
}
