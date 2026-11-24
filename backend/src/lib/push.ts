import type { Config } from '../config.js';

export interface Push { send(tokens: string[], title: string, body: string, data?: Record<string, string>): Promise<string[]> }

/** Firebase Cloud Messaging via firebase-admin (optional dependency, loaded lazily). Returns invalid tokens to prune. */
export function createPush(cfg: Config): Push {
  let messaging: any = null;
  let tried = false;
  async function init() {
    if (tried) return messaging;
    tried = true;
    if (!cfg.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
    try {
      const admin: any = await import('firebase-admin' as string);
      const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(cfg.FIREBASE_SERVICE_ACCOUNT_JSON)) });
      messaging = admin.messaging(app);
    } catch (e) { console.warn('[push] FCM unavailable (is firebase-admin installed?):', (e as Error).message); }
    return messaging;
  }
  return {
    async send(tokens, title, body, data = {}) {
      const m = await init();
      if (!m || !tokens.length) return [];
      const res = await m.sendEachForMulticast({ tokens, notification: { title, body }, data });
      const bad: string[] = [];
      res.responses.forEach((r: any, i: number) => {
        if (!r.success && /registration-token|not-registered/.test(r.error?.code ?? '')) bad.push(tokens[i]);
      });
      return bad;
    },
  };
}
