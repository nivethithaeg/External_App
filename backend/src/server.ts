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
if (process.env.AUTO_MIGRATE !== 'false') console.log('Migrations applied:', await migrate(db));

const realtime = { current: noopRealtime };
const proxyRealtime = { toVenue: (...a: [string, string, unknown]) => realtime.current.toVenue(...a), toUser: (...a: [string, string, unknown]) => realtime.current.toUser(...a) };
const mailer = createMailer(cfg);
const ctx: Ctx = {
  db, cfg, google: createGoogleVerifier(cfg), mailer, sms: createSms(cfg), gateway: createRazorpayGateway(cfg), storage: createStorage(cfg),
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
server.listen(cfg.PORT, () => console.log(`KickOff API listening on :${cfg.PORT} (${cfg.NODE_ENV})`));

const shutdown = () => { clearInterval(timer); server.close(() => db.close().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e); reportError(e, { source: 'process' }); });
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); reportError(e, { source: 'process' }); setTimeout(() => process.exit(1), 1500); }); // report, then exit: the process manager restarts a clean one
