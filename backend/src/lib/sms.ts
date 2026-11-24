import type { Config } from '../config.js';

export interface Sms { send(phone: string, message: string): Promise<void> }

/** Generic HTTP SMS gateway: POSTs {to, message} with a bearer token. Point SMS_WEBHOOK_URL at your provider/adapter. */
export function createSms(cfg: Config): Sms {
  return {
    async send(phone, message) {
      if (!cfg.SMS_WEBHOOK_URL) {
        if (cfg.NODE_ENV !== 'production') console.log(`[sms:dev] to=${phone} message="${message}"`);
        else console.warn('[sms] SMS gateway not configured; message not sent');
        return;
      }
      const res = await fetch(cfg.SMS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.SMS_WEBHOOK_TOKEN}` },
        body: JSON.stringify({ to: phone, message }),
      });
      if (!res.ok) console.error('[sms] gateway error', res.status);
    },
  };
}
