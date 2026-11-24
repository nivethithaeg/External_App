import { useState, type ReactNode } from 'react';
import { api, apiError } from '../lib/api';
import { useToast } from '../lib/toast';

/** Opens a private document: fetched with the user's session (never a public URL) and shown in a new tab as a temporary blob. */
export async function openPrivateFile(path: string) {
  const w = window.open('', '_blank'); // open synchronously so pop-up blockers allow it
  try {
    const r = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data as Blob);
    if (w) w.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (e) { w?.close(); throw e; }
}

/** Link to a stored document. Legacy public URLs open directly; private documents are fetched through the authenticated API. */
export function FileLink({ path, url, children }: { path: string; url?: string | null; children: ReactNode }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (url && /^https?:/.test(url)) return <a className="font-semibold underline" href={url} target="_blank" rel="noreferrer">{children} ↗</a>;
  return (
    <button type="button" disabled={busy} className="font-semibold underline disabled:opacity-60" onClick={async () => { setBusy(true); try { await openPrivateFile(path); } catch (e) { toast(apiError(e), 'error'); } finally { setBusy(false); } }}>
      {children} {busy ? '…' : '↗'}
    </button>
  );
}
