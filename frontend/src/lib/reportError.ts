import { API_BASE } from './api';

/** Tells the site owners about a crash in the browser (fire-and-forget, never throws, never reports the same message twice per page load). */
const sent = new Set<string>();
export function reportBrowserError(error: unknown) {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    if (sent.has(e.message) || sent.size >= 5) return;
    sent.add(e.message);
    const body = JSON.stringify({ message: e.message, stack: e.stack, url: location.pathname });
    if (navigator.sendBeacon && navigator.sendBeacon(`${API_BASE}/client-errors`, new Blob([body], { type: 'application/json' }))) return;
    void fetch(`${API_BASE}/client-errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* reporting must never break the page */ }
}

/** Also catches errors outside React rendering (event handlers, promises). Call once at start-up. */
export function installErrorReporting() {
  window.addEventListener('error', (ev) => reportBrowserError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportBrowserError(ev.reason));
}
