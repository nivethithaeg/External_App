import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { initMonitor, reportError } from '../src/lib/monitor.js';
import { setup } from './helpers.js';

let calls: { url: string; body: any }[] = [];
beforeEach(() => { calls = []; vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}'); })); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('error alerts', () => {
  it('sends nothing when no destination is configured', () => {
    initMonitor({ SENTRY_DSN: '', ERROR_WEBHOOK_URL: '', NODE_ENV: 'production' }); reportError(new Error('boom'));
    expect(calls).toHaveLength(0);
  });

  it('sends to Sentry and a chat webhook, once per minute for the same error', () => {
    initMonitor({ SENTRY_DSN: 'https://abc123@o1.ingest.sentry.io/42', ERROR_WEBHOOK_URL: 'https://hooks.example/x', NODE_ENV: 'production' });
    reportError(new Error('db exploded'), { ref: 'AB12CD', method: 'POST', path: '/api/bookings', userId: 'u1' });
    reportError(new Error('db exploded'), { path: '/api/bookings' }); // duplicate: dropped
    expect(calls).toHaveLength(2);
    const sentry = calls.find((c) => c.url.includes('sentry.io'))!;
    expect(sentry.url).toBe('https://o1.ingest.sentry.io/api/42/store/?sentry_version=7&sentry_key=abc123');
    expect(sentry.body.exception.values[0]).toMatchObject({ type: 'Error', value: 'db exploded' }); expect(sentry.body.tags.reference).toBe('AB12CD'); expect(sentry.body.user.id).toBe('u1');
    const hook = calls.find((c) => c.url.startsWith('https://hooks.example'))!;
    expect(hook.body.text).toContain('db exploded'); expect(hook.body.text).toContain('POST /api/bookings');
  });

  it('reports a crash in the website through the browser intake, with a size cap', async () => {
    const env = await setup();
    initMonitor({ SENTRY_DSN: '', ERROR_WEBHOOK_URL: 'https://hooks.example/x', NODE_ENV: 'production' });
    await request(env.app).post('/api/client-errors').send({ message: 'x'.repeat(5000), stack: 'at foo', url: '/venues' }).expect(204);
    expect(calls).toHaveLength(1); expect(calls[0]!.body.text.length).toBeLessThan(1600); expect(calls[0]!.body.text).toContain('(browser)');
  });
});
