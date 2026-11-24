import path from 'node:path';
import { ownerStaffRoutes, staffRoutes } from './routes/staff.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Ctx } from './types.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { initMonitor, reportError } from './lib/monitor.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { accountRoutes } from './routes/customer.js';
import { bookingRoutes } from './routes/bookings.js';
import { customerPortalRoutes } from './routes/customerPortal.js';
import { ownerRoutes } from './routes/owner.js';
import { ownerInsightRoutes } from './routes/ownerInsights.js';
import { ownerApplicationRoutes } from './routes/ownerApplication.js';
import { ownerExtraRoutes, adminExtraRoutes } from './routes/ownerExtras.js';
import { adminApplicationRoutes } from './routes/adminApplications.js';
import { adminRoutes } from './routes/admin.js';
import { webhookRoutes } from './routes/webhooks.js';

export function createApp(ctx: Ctx) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const origins = ctx.cfg.CORS_ORIGINS.split(',').map((s) => s.trim());
  app.use(cors({ origin: origins, credentials: true }));

  initMonitor(ctx.cfg);
  const test = ctx.cfg.NODE_ENV === 'test';
  const general = rateLimit({ windowMs: 15 * 60_000, limit: test ? 100000 : 600, standardHeaders: 'draft-7', legacyHeaders: false });
  const strict = rateLimit({ windowMs: 15 * 60_000, limit: test ? 100000 : 30, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' } } });

  // Webhooks need the raw body for HMAC verification, so they are mounted before express.json().
  app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhookRoutes(ctx));

  app.use(express.json({ limit: '100kb' }));
  app.use('/api', general);
  // errors from the website itself (a crashed page): forwarded to the same alert channel, size limited and strictly rate limited
  app.post('/api/client-errors', strict, (req, res) => {
    const b = (req.body ?? {}) as { message?: unknown; stack?: unknown; url?: unknown };
    const err = new Error(String(b.message ?? 'Browser error').slice(0, 300)); err.stack = String(b.stack ?? '').slice(0, 3000);
    reportError(err, { source: 'browser', method: 'GET', path: String(b.url ?? '').slice(0, 200) });
    res.status(204).end();
  });
  app.get('/api/health', async (_req, res) => {
    try { await ctx.db.query('SELECT 1'); res.json({ status: 'ok' }); } catch { res.status(503).json({ status: 'db_unavailable' }); }
  });

  app.use('/api/auth/login', strict);
  app.use('/api/auth/register', strict);
  app.use('/api/auth/otp', strict);
  app.use('/api/auth/google', strict);
  app.use('/api/auth/forgot-password', strict);
  app.use('/api/auth/reset-password', strict);
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api', publicRoutes(ctx));
  app.use('/api/me', accountRoutes(ctx));
  app.use('/api', customerPortalRoutes(ctx));
  app.use('/api/owner', ownerRoutes(ctx));
  app.use('/api/owner', ownerInsightRoutes(ctx));
  app.use('/api/owner', ownerApplicationRoutes(ctx));
  app.use('/api/owner', ownerStaffRoutes(ctx));
  app.use('/api/owner', ownerExtraRoutes(ctx));
  app.use('/api/staff', staffRoutes(ctx));
  app.use('/api/admin', adminApplicationRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api/admin', adminExtraRoutes(ctx));
  app.use('/api', bookingRoutes(ctx));

  if (!ctx.cfg.SUPABASE_URL) {
    // Local development storage only. Production uses Supabase Storage public URLs.
    app.use('/uploads', express.static(path.resolve('uploads'), { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
