export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n ?? 0));
export const fmtDate = (iso: string, tz = 'Asia/Kolkata') => new Date(iso).toLocaleDateString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (iso: string, tz = 'Asia/Kolkata') => new Date(iso).toLocaleTimeString('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
export const fmtDateTime = (iso: string, tz = 'Asia/Kolkata') => `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)}`;
export const fmtRange = (s: string, e: string, tz = 'Asia/Kolkata') => `${fmtDate(s, tz)} · ${fmtTime(s, tz)} – ${fmtTime(e, tz)}`;
export const todayISO = (offsetDays = 0) => { const d = new Date(Date.now() + offsetDays * 86400000); return d.toISOString().slice(0, 10); };
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
/** The lengths of time a slot or booking can be: 30 minutes, then 1 to 5 hours. */
export const DURATIONS = [30, 60, 120, 180, 240, 300] as const;
/** What a customer can pick for a playing area: those lengths that fit the area's shortest and longest booking and its slot size. */
export function bookableDurations(a: { min_duration_minutes: number; max_duration_minutes: number; slot_minutes: number }): number[] {
  const out = DURATIONS.filter((d) => d >= a.min_duration_minutes && d <= a.max_duration_minutes && d % a.slot_minutes === 0);
  if (out.length) return out;
  const legacy: number[] = []; for (let m = a.min_duration_minutes; m <= a.max_duration_minutes; m += a.slot_minutes) legacy.push(m); return legacy; // an area set up with an unusual length keeps working
}
export const durationLabel = (m: number) => (m % 60 === 0 ? `${m / 60} hr` : `${Math.floor(m / 60) ? Math.floor(m / 60) + ' hr ' : ''}${m % 60} min`);
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const statusTone = (s: string): 'ok' | 'warn' | 'danger' | 'neutral' => {
  if (['confirmed', 'completed', 'approved', 'verified', 'processed', 'captured', 'paid', 'resolved'].includes(s)) return 'ok';
  if (['pending', 'processing', 'ready', 'in_progress', 'open', 'draft', 'created', 'partially_refunded'].includes(s)) return 'warn';
  if (['cancelled', 'expired', 'rejected', 'failed', 'suspended', 'no_show'].includes(s)) return 'danger';
  return 'neutral';
};
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/**
 * Saves a generated file (CSV report, PDF…).
 * - Inside the PlaynX mobile app (a WebView) browsers can't save blobs, so the file is handed to the app, which saves and shares it.
 * - On a phone browser the share sheet ("Save to Files", Drive, WhatsApp…) is offered first.
 * - Everywhere else it is an ordinary download.
 */
export async function downloadBlob(blob: Blob, filename: string) {
  const rn = (window as unknown as { ReactNativeWebView?: { postMessage(m: string): void } }).ReactNativeWebView;
  if (rn?.postMessage) {
    rn.postMessage(JSON.stringify({ type: 'download', filename, mime: blob.type || 'application/octet-stream', data: await toBase64(blob) }));
    return;
  }
  const phone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (phone && typeof File === 'function' && typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return; }
      catch (e) { if ((e as Error).name === 'AbortError') return; /* otherwise fall back to a normal download */ }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** How a customer paid, as Razorpay names it (upi, card, netbanking, wallet, emi...), in words people know. */
export const payMethodLabel = (m?: string | null) => (!m ? '—' : ({ upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', cardless_emi: 'Cardless EMI', bank_transfer: 'Bank transfer', cash: 'Cash', offline: 'Offline' } as Record<string, string>)[m] ?? m.charAt(0).toUpperCase() + m.slice(1));
