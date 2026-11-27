import type { Config } from './config.js';
import type { Db } from './db.js';
import type { PaymentGateway } from './lib/payments.js';
import type { Mailer } from './lib/mailer.js';
import type { Storage } from './lib/storage.js';
import type { Realtime } from './lib/realtime.js';
import type { Notifier } from './lib/notify.js';
import type { Sms } from './lib/sms.js';
import type { GoogleVerifier } from './lib/google.js';
import type { PayoutProvider } from './lib/payouts.js';
import type { JusgoClient } from './lib/jusgo.js';

export type Role = 'customer' | 'owner' | 'admin' | 'staff';
export interface AuthUser {
  id: string; email: string; role: Role; adminRole: string | null; adminPermissions?: string[] | null; fullName: string;
}
export interface Ctx {
  db: Db; cfg: Config; google: GoogleVerifier; gateway: PaymentGateway; mailer: Mailer; sms: Sms;
  storage: Storage; realtime: Realtime; notifier: Notifier; now: () => Date;
  /** Bank payouts to owners; absent or disabled means an admin pays by hand. */
  payouts?: PayoutProvider;
  /** JusGo partner API (customer-link); absent when not configured */
  jusgo?: JusgoClient;
}
declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}
