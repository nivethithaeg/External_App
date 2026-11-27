// Zero-setup local development: the REAL API on an embedded Postgres (PGlite, persisted to ./.pglite).
// Not for production. Usage: npm run dev:local   (add DEMO=1 to load optional demo venues + logins)
import http from 'node:http';
import { PGlite, types } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/lib/mailer.js';
import { createSms } from '../src/lib/sms.js';
import { createRazorpayGateway } from '../src/lib/payments.js';
import { createStorage } from '../src/lib/storage.js';
import { attachRealtime, noopRealtime } from '../src/lib/realtime.js';
import { createNotifier } from '../src/lib/notify.js';
import { createPush } from '../src/lib/push.js';
import { createGoogleVerifier } from '../src/lib/google.js';
import { runMaintenance } from '../src/lib/bookings.js';
import { seedDemo } from './demo-data.js';
import type { Ctx } from '../src/types.js';

if (process.env.NODE_ENV === 'production') throw new Error('dev-local must not run in production');
process.env.JWT_SECRET ??= 'dev-only-secret-dev-only-secret-dev-only-secret';
// This entry point is fully local (embedded database + local file storage), so ignore any Supabase settings in .env.
const cfg = { ...loadConfig(), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' };
const pg = new PGlite(process.env.PGLITE_DIR ?? './.pglite', { extensions: { btree_gist }, parsers: { [types.NUMERIC]: (v: string) => parseFloat(v), [types.INT8]: (v: string) => parseInt(v, 10) } });
const wrap = (x: any) => ({ async query(text: string, params?: unknown[]) { const r = await x.query(text, params); return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length }; } });
const db = { ...wrap(pg), tx: (fn: any) => pg.transaction((t) => fn(wrap(t))), exec: async (s: string) => { await pg.exec(s); }, close: () => pg.close() } as Db;

console.log('Migrations applied:', await migrate(db));
if (process.env.DEMO === '1') {
  const pw = process.env.DEMO_PASSWORD ?? 'PlaynX@12345';
  if (await seedDemo(db, pw)) console.log(`Demo data loaded. Logins: admin@playnx.local / owner@playnx.local  password: ${pw}`);
}

const rt = { current: noopRealtime };
const proxy = { toVenue: (...a: [string, string, unknown]) => rt.current.toVenue(...a), toUser: (...a: [string, string, unknown]) => rt.current.toUser(...a) };
const mailer = createMailer(cfg);
const ctx: Ctx = { db, cfg, google: createGoogleVerifier(cfg), mailer, sms: createSms(cfg), gateway: createRazorpayGateway(cfg), storage: createStorage(cfg), realtime: proxy, notifier: createNotifier(db, proxy, mailer, createPush(cfg)), now: () => new Date() };
const server = http.createServer(createApp(ctx));
rt.current = attachRealtime(server, cfg);
setInterval(() => runMaintenance(ctx).catch((e) => console.error('[maintenance]', e)), 30_000);
server.listen(cfg.PORT, () => console.log(`PlaynX API (local, embedded Postgres) on http://localhost:${cfg.PORT}`));
