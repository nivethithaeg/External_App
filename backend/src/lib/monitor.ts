import type { Config } from '../config.js';

/**
 * Error alerts for the people running the site. Two optional destinations, both configured with environment variables:
 *  - SENTRY_DSN: errors are sent to Sentry (plain HTTPS, no SDK to install)
 *  - ERROR_WEBHOOK_URL: a short text message is posted (Slack, Discord and Teams incoming webhooks all accept {"text": ...})
 * With neither set, nothing is sent. Identical errors are sent at most once a minute, and never more than 30 a minute.
 */
export interface ErrorContext { ref?: string; method?: string; path?: string; userId?: string; source?: 'server' | 'browser' | 'process' }

let cfgRef: Pick<Config, 'SENTRY_DSN' | 'ERROR_WEBHOOK_URL' | 'NODE_ENV'> | null = null;
const seen = new Map<string, number>(); let windowStart = 0; let windowCount = 0;

export function initMonitor(cfg: Pick<Config, 'SENTRY_DSN' | 'ERROR_WEBHOOK_URL' | 'NODE_ENV'>) { cfgRef = cfg; seen.clear(); windowCount = 0; }
export const monitorEnabled = () => !!(cfgRef?.SENTRY_DSN || cfgRef?.ERROR_WEBHOOK_URL);

function parseDsn(dsn: string) {
  try { const u = new URL(dsn); const project = u.pathname.replace(/^\/+/, ''); if (!u.username || !project) return null; return { key: u.username, host: u.host, protocol: u.protocol, project }; } catch { return null; }
}

export function reportError(err: unknown, ctx: ErrorContext = {}) {
  if (!cfgRef || !monitorEnabled()) return;
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  const nowMs = Date.now();
  if (nowMs - windowStart > 60_000) { windowStart = nowMs; windowCount = 0; }
  if (windowCount >= 30) return;
  const sig = `${e.name}:${e.message}:${ctx.path ?? ''}`;
  if (nowMs - (seen.get(sig) ?? 0) < 60_000) return;
  seen.set(sig, nowMs); windowCount++;
  const env = cfgRef.NODE_ENV;
  const dsn = cfgRef.SENTRY_DSN ? parseDsn(cfgRef.SENTRY_DSN) : null;
  if (dsn) {
    const frames = (e.stack ?? '').split('\n').slice(1, 30).map((l) => ({ function: l.trim() })).reverse();
    const body = { event_id: crypto.randomUUID().replace(/-/g, ''), timestamp: nowMs / 1000, level: 'error', platform: 'node', environment: env, logger: ctx.source ?? 'server',
      exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames } }] }, tags: { source: ctx.source ?? 'server', ...(ctx.ref ? { reference: ctx.ref } : {}) },
      request: ctx.path ? { method: ctx.method, url: ctx.path } : undefined, user: ctx.userId ? { id: ctx.userId } : undefined };
    void fetch(`${dsn.protocol}//${dsn.host}/api/${dsn.project}/store/?sentry_version=7&sentry_key=${dsn.key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }
  if (cfgRef.ERROR_WEBHOOK_URL) {
    const text = `PlaynX ${env} error${ctx.ref ? ` [${ctx.ref}]` : ''}${ctx.source && ctx.source !== 'server' ? ` (${ctx.source})` : ''}\n${ctx.method ? `${ctx.method} ` : ''}${ctx.path ?? ''}\n${e.name}: ${e.message}`.slice(0, 1500);
    void fetch(cfgRef.ERROR_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }) }).catch(() => {});
  }
}
