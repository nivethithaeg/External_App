import axios, { AxiosError } from 'axios';

export const TOKEN_KEY = 'kickoff_token';
export const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;
export const api = axios.create({ baseURL: API_BASE, timeout: 20000 });

/**
 * The login lives only as long as the browser is open: it is kept in sessionStorage, never in localStorage, so closing Chrome
 * signs the account out even without pressing Log out. Tabs of the same open browser share it (a new tab asks an open one).
 */
const SHARE_ASK = 'kickoff_token_ask', SHARE_GIVE = 'kickoff_token_give', LOGOUT_ALL_TABS = 'kickoff_logout';
export const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t: string | null, _persist = true) => {
  try {
    localStorage.removeItem(TOKEN_KEY); // an older login kept on the device: never used again
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else { const had = sessionStorage.getItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); if (had) { localStorage.setItem(LOGOUT_ALL_TABS, String(Date.now())); localStorage.removeItem(LOGOUT_ALL_TABS); } }
  } catch { /* storage unavailable */ }
};
if (typeof window !== 'undefined') {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  window.addEventListener('storage', (e) => {
    try {
      if (e.key === SHARE_ASK && e.newValue) { const t = getToken(); if (t) { localStorage.setItem(SHARE_GIVE, t); localStorage.removeItem(SHARE_GIVE); } }
      else if (e.key === SHARE_GIVE && e.newValue && !getToken()) sessionStorage.setItem(TOKEN_KEY, e.newValue);
      else if (e.key === LOGOUT_ALL_TABS && e.newValue && getToken()) { sessionStorage.removeItem(TOKEN_KEY); window.location.reload(); }
    } catch { /* ignore */ }
  });
}
/** A new tab: ask the other open tabs of this browser for the login, waiting a moment for an answer. */
export function askOtherTabsForToken(waitMs = 250): Promise<string | null> {
  if (getToken() || typeof window === 'undefined') return Promise.resolve(getToken());
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener('storage', on); clearTimeout(timer); resolve(getToken()); };
    const on = (e: StorageEvent) => { if (e.key === SHARE_GIVE && e.newValue) setTimeout(done, 0); };
    window.addEventListener('storage', on);
    const timer = setTimeout(done, waitMs);
    try { localStorage.setItem(SHARE_ASK, String(Date.now())); localStorage.removeItem(SHARE_ASK); } catch { done(); }
  });
}

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let onUnauthorized: (() => void) | null = null;
/** Called when the server refuses an add/change because the owner's application is not approved yet (the portal shows a pop-up). */
let onNotApproved: ((code: string) => void) | null = null;
export const setNotApprovedHandler = (fn: ((code: string) => void) | null) => { onNotApproved = fn; };
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };
api.interceptors.response.use((r) => r, (err: AxiosError<any>) => {
  const url = err.config?.url ?? '';
  if (err.response?.status === 401 && getToken() && !url.includes('/auth/login')) onUnauthorized?.();
  if (err.response?.status === 403 && ['owner_not_approved', 'bank_required'].includes(err.response.data?.error?.code)) onNotApproved?.(err.response.data.error.code);
  return Promise.reject(err);
});

/** Human-readable message from any thrown error. */
export function apiError(e: unknown): string {
  const ax = e as AxiosError<any>;
  const d = ax?.response?.data?.error;
  if (d?.details?.length && d.code === 'validation_error') return d.details.map((x: any) => `${x.path ? x.path + ': ' : ''}${x.message}`).join('; ');
  if (d?.message) return d.message;
  if (ax?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  // The server answered but not with one of our JSON errors (e.g. a proxy, an old server, a wrong address): say exactly what failed.
  if (ax?.response) return `The server answered ${ax.response.status}${ax.response.statusText ? ' ' + ax.response.statusText : ''} for ${(ax.config?.method ?? 'get').toUpperCase()} ${ax.config?.url ?? 'a request'}. Reload the page; if it persists, send this message to support.`;
  if (ax?.message === 'Network Error') return 'Cannot reach the server. Check your connection.';
  return (e as Error)?.message || 'Something went wrong';
}
export const apiCode = (e: unknown): string | undefined => (e as AxiosError<any>)?.response?.data?.error?.code;
export const get = async <T = any>(url: string, params?: object) => (await api.get<T>(url, { params })).data;
export const post = async <T = any>(url: string, body?: unknown) => (await api.post<T>(url, body)).data;
export const put = async <T = any>(url: string, body?: unknown) => (await api.put<T>(url, body)).data;
export const patch = async <T = any>(url: string, body?: unknown) => (await api.patch<T>(url, body)).data;
export const del = async <T = any>(url: string, body?: unknown) => (await api.delete<T>(url, { data: body })).data;

/** Server-side field problems keyed by field name, so a form can show the reason next to the field. Covers validation errors and
 *  conflicts that name a field (e.g. an email that is already registered). Returns {} for errors that aren't about one field. */
export function fieldErrors(e: unknown): Record<string, string> {
  const d = (e as AxiosError<any>)?.response?.data?.error;
  const out: Record<string, string> = {};
  if (d?.code === 'validation_error') for (const x of d.details ?? []) if (x.path && !out[x.path]) out[x.path] = x.message;
  if (d?.details?.field) out[d.details.field] = d.message;
  return out;
}

/** Customer profile picture upload (JPEG/PNG/WebP, checked again by the server). */
export async function uploadAvatar(file: File): Promise<string> {
  const fd = new FormData(); fd.append('file', file);
  return (await api.post<{ avatarUrl: string }>('/me/profile/avatar', fd, { timeout: 60000 })).data.avatarUrl;
}
