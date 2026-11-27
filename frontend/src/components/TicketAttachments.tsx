import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export const TICKET_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
const MAX_FILES = 10;
const limitOf = (f: File) => (f.type.startsWith('video/') ? 50 : 8) * 1024 * 1024;

/** Picks photos and videos for a ticket: shows each one, lets it be removed, and says why a file is refused. */
export function TicketFilePicker({ files, onChange }: { files: File[]; onChange(files: File[]): void }) {
  const [err, setErr] = useState('');
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => { const urls = files.map((f) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : '')); setPreviews(urls); return () => urls.forEach((u) => u && URL.revokeObjectURL?.(u)); }, [files]);
  const add = (list: FileList | null) => {
    setErr(''); const next = [...files];
    for (const f of Array.from(list ?? [])) {
      if (!TICKET_FILE_TYPES.includes(f.type)) { setErr(`${f.name}: only JPG, PNG or WebP photos and MP4 or WebM videos.`); continue; }
      if (f.size > limitOf(f)) { setErr(`${f.name} is too large: photos up to 8 MB, videos up to 50 MB.`); continue; }
      if (next.length >= MAX_FILES) { setErr(`At most ${MAX_FILES} photos and videos.`); break; }
      next.push(f);
    }
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="ticket-files">Photos or videos (optional)</label>
      <input id="ticket-files" type="file" multiple accept={TICKET_FILE_TYPES.join(',')} aria-label="Add photos or videos" onChange={(e) => { add(e.target.files); e.target.value = ''; }}
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface2 file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
      <p className="text-xs text-muted">Show the problem: up to {MAX_FILES} files. Photos up to 8 MB, videos up to 50 MB.</p>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      {files.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Files to attach">{files.map((f, i) => (
          <li key={`${f.name}-${i}`} className="relative overflow-hidden rounded-lg border border-line bg-surface2">
            {f.type.startsWith('image/') && previews[i] ? <img src={previews[i]} alt={f.name} className="h-20 w-full object-cover" /> : <div className="grid h-20 place-items-center text-xs text-muted">🎬 {f.name.slice(0, 14)}</div>}
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-xs text-white">✕</button>
          </li>))}</ul>)}
    </div>);
}

/** Sends the chosen files to a ticket, one after another. Returns how many could not be sent. */
export async function uploadTicketFiles(ticketId: string, files: File[]): Promise<number> {
  let failed = 0;
  for (const f of files) {
    try { const fd = new FormData(); fd.append('file', f); await api.post(`/me/tickets/${ticketId}/attachments`, fd, { timeout: 120000 }); } catch { failed++; }
  }
  return failed;
}

/** The photos and videos of a ticket. Files are private, so each is fetched with the login and shown from memory. */
export function TicketAttachmentList({ base, ticketId, items }: { base: string; ticketId: string; items: { id: string; kind: 'image' | 'video' }[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true; const made: string[] = [];
    (async () => { for (const a of items) {
      try { const r = await api.get(`${base}/${ticketId}/attachments/${a.id}/file`, { responseType: 'blob' }); const u = URL.createObjectURL(r.data as Blob); made.push(u); if (live) setUrls((x) => ({ ...x, [a.id]: u })); } catch { /* shown as unavailable */ }
    } })();
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [base, ticketId, items.map((a) => a.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  return (
    <section aria-label="Photos and videos" className="space-y-1"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Photos and videos ({items.length})</h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{items.map((a, i) => (
        <li key={a.id} className="overflow-hidden rounded-lg border border-line bg-surface2">{!urls[a.id] ? <div className="grid h-28 place-items-center text-xs text-muted">Loading…</div>
          : a.kind === 'image' ? <a href={urls[a.id]} target="_blank" rel="noreferrer"><img src={urls[a.id]} alt={`Photo ${i + 1}`} className="h-28 w-full object-cover" /></a>
          : <video src={urls[a.id]} controls className="h-28 w-full bg-black" aria-label={`Video ${i + 1}`} />}</li>))}</ul>
    </section>);
}
