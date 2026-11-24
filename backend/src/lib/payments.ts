import crypto from 'node:crypto';
import type { Config } from '../config.js';
import { HttpError } from '../errors.js';

export interface GatewayOrder { id: string; amount: number; currency: string }
export interface GatewayRefund { id: string; status: string }
export interface PaymentGateway {
  createOrder(amountInr: number, receipt: string): Promise<GatewayOrder>;
  refund(paymentId: string, amountInr: number, notes?: Record<string, string>): Promise<GatewayRefund>;
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
  keyId(): string;
  /** how the customer paid (upi, card, netbanking, wallet…), asked from the gateway; null when it cannot say */
  paymentMethod?(paymentId: string): Promise<string | null>;
}

const hmac = (secret: string, data: string | Buffer) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Razorpay REST integration (https://razorpay.com/docs/api). Secrets never leave the server. */
export function createRazorpayGateway(cfg: Config): PaymentGateway {
  const auth = 'Basic ' + Buffer.from(`${cfg.RAZORPAY_KEY_ID}:${cfg.RAZORPAY_KEY_SECRET}`).toString('base64');
  async function call(path: string, body: unknown) {
    if (!cfg.RAZORPAY_KEY_ID || !cfg.RAZORPAY_KEY_SECRET) throw new HttpError(503, 'Payments are not configured', 'payments_unavailable');
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, json?.error?.description ?? 'Payment gateway error', 'gateway_error');
    return json;
  }
  return {
    keyId: () => cfg.RAZORPAY_KEY_ID,
    async paymentMethod(paymentId) {
      if (!cfg.RAZORPAY_KEY_ID || !cfg.RAZORPAY_KEY_SECRET) return null;
      try {
        const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: auth } });
        if (!res.ok) return null;
        const j: any = await res.json();
        return typeof j?.method === 'string' ? j.method : null;
      } catch { return null; }
    },
    async createOrder(amountInr, receipt) {
      const o = await call('/orders', { amount: Math.round(amountInr * 100), currency: 'INR', receipt });
      return { id: o.id, amount: o.amount / 100, currency: o.currency };
    },
    async refund(paymentId, amountInr, notes) {
      const r = await call(`/payments/${paymentId}/refund`, { amount: Math.round(amountInr * 100), notes });
      return { id: r.id, status: r.status };
    },
    verifyPaymentSignature: (orderId, paymentId, signature) =>
      !!cfg.RAZORPAY_KEY_SECRET && safeEqual(hmac(cfg.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), signature),
    verifyWebhookSignature: (raw, signature) =>
      !!cfg.RAZORPAY_WEBHOOK_SECRET && safeEqual(hmac(cfg.RAZORPAY_WEBHOOK_SECRET, raw), signature),
  };
}
