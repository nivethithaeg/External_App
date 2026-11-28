import { withFileEncryption } from './lib/fileCrypto.js';
import { createJusgoClient } from './lib/jusgo.js';
import { pollJusgoChanges } from './lib/jusgoBookings.js';
import http from 'node:http';
import { loadConfig } from './config.js';
import { createPgDb } from './db.js';
import { migrate } from './migrate.js';
import { createApp } from './app.js';
import { createMailer } from './lib/mailer.js';
import { createSms } from './lib/sms.js';
import { createRazorpayGateway } from './lib/payments.js';
import { createStorage } from './lib/storage.js';
import { attachRealtime, noopRealtime } from './lib/realtime.js';
import { createNotifier } from './lib/notify.js';
import { createPush } from './lib/push.js';
import { createGoogleVerifier } from './lib/google.js';
import { runMaintenance } from './lib/bookings.js';
import { createRazorpayXPayouts, createTestPayouts, runAutoPayouts } from './lib/payouts.js';
import { reportError } from './lib/monitor.js';
import type { Ctx } from './types.js';

const cfg = loadConfig();
if (!cfg.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = createPgDb(cfg.DATABASE_URL, cfg.DATABASE_SSL === 'true');

const realtime = { current: noopRealtime };
const proxyRealtime = { toVenue: (...a: [string, string, unknown]) => realtime.current.toVenue(...a), toUser: (...a: [string, string, unknown]) => realtime.current.toUser(...a) };
const mailer = createMailer(cfg);
const ctx: Ctx = {
  db, cfg, google: createGoogleVerifier(cfg), mailer, sms: createSms(cfg), gateway: createRazorpayGateway(cfg), storage: withFileEncryption(createStorage(cfg), cfg.DATA_ENCRYPTION_KEY || cfg.JWT_SECRET, [cfg.JWT_SECRET]), jusgo: createJusgoClient(cfg),
  realtime: proxyRealtime, notifier: createNotifier(db, proxyRealtime, mailer, createPush(cfg)), now: () => new Date(),
  payouts: cfg.PAYOUTS_TEST_MODE === 'true' && cfg.NODE_ENV !== 'production' && !cfg.RAZORPAYX_ACCOUNT_NUMBER ? createTestPayouts() : createRazorpayXPayouts(cfg),
};
const app = createApp(ctx);
const server = http.createServer(app);
realtime.current = attachRealtime(server, cfg);

// Expire unpaid holds + complete finished bookings.
// automatic owner payouts (off unless an admin enables them and the bank account is set up): checked hourly
const payoutTimer = setInterval(() => runAutoPayouts(ctx).catch((e) => console.error('[auto-payouts]', e)), 60 * 60_000);
setTimeout(() => runAutoPayouts(ctx).then((n) => n && console.log(`[auto-payouts] ${n} payout(s)${ctx.payouts?.test ? ' (TEST, no real transfer)' : ''}`)).catch((e) => console.error('[auto-payouts]', e)), 15_000); // and once soon after start
const timer = setInterval(() => runMaintenance(ctx).catch((e) => console.error('[maintenance]', e)), 30_000);
// JusGo -> PlaynX: bookings made on JusGo close the same slot here. Checked every JUSGO_POLL_SECONDS (2 by default; 0 switches it off).
const jusgoEvery = Number(process.env.JUSGO_POLL_SECONDS ?? 2);
let jusgoLastError = 0;
const jusgoTimer = cfg.JUSGO_API_KEY && jusgoEvery > 0 ? setInterval(() => pollJusgoChanges(ctx).catch((e) => {
  if (Date.now() - jusgoLastError > 60_000) { jusgoLastError = Date.now(); console.error('[jusgo] reading changes failed:', e?.code ?? '', e?.message ?? e); } // at most once a minute in the log
}), jusgoEvery * 1000) : null;
// listen first (hosts like Hostinger expect it within seconds), then bring the database up to date; a failed migration still stops the app
server.listen(cfg.PORT, () => console.log(`PlaynX API listening on :${cfg.PORT} (${cfg.NODE_ENV})`));
if (process.env.AUTO_MIGRATE !== 'false') {
  try { console.log('Migrations applied:', await migrate(db)); } catch (e) { console.error('[migrate] failed:', e); process.exit(1); }
}

const shutdown = () => { clearInterval(timer); if (jusgoTimer) clearInterval(jusgoTimer); server.close(() => db.close().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e); reportError(e, { source: 'process' }); });
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); reportError(e, { source: 'process' }); setTimeout(() => process.exit(1), 1500); }); // report, then exit: the process manager restarts a clean one
