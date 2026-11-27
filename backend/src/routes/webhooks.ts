import { Router } from 'express';
import type { Ctx } from '../types.js';
import { confirmPayment, recordPaymentFailure } from '../lib/bookings.js';
import { settlePayout } from '../lib/payouts.js';
import { handleJusgoWebhook } from './jusgoLink.js';

/** Mounted with express.raw() BEFORE the JSON parser: the signature is computed over the exact raw body. */
export function webhookRoutes(ctx: Ctx) {
  const r = Router();
  /** JusGo customer-link events (signed with the JusGo webhook secret) */
  r.post('/jusgo', (req, res) => handleJusgoWebhook(ctx, req, res));
  r.post('/razorpay', async (req, res) => {
    const raw: Buffer = req.body;
    const sig = req.header('x-razorpay-signature') ?? '';
    if (!Buffer.isBuffer(raw) || !ctx.gateway.verifyWebhookSignature(raw, sig)) return res.status(400).json({ error: { code: 'bad_signature', message: 'Invalid signature' } });
    const eventId = req.header('x-razorpay-event-id');
    const event = JSON.parse(raw.toString('utf8'));
    if (!eventId) return res.status(400).json({ error: { code: 'bad_request', message: 'Missing event id' } });

    // Idempotency: a replayed event id is acknowledged without being processed again.
    const ins = await ctx.db.query(
      `INSERT INTO webhook_events (event_id, event_type, payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [eventId, event.event, raw.toString('utf8')]);
    if (!ins.rowCount) return res.json({ received: true, duplicate: true });

    try {
      const pay = event.payload?.payment?.entity;
      if (event.event === 'payment.captured' || event.event === 'order.paid') {
        const p = pay ?? event.payload?.order?.entity;
        if (pay?.order_id) await confirmPayment(ctx, { orderId: pay.order_id, paymentId: pay.id, method: pay.method });
        else if (p) { /* order.paid without payment entity: nothing to confirm */ }
      } else if (event.event === 'payment.failed' && pay?.order_id) {
        await recordPaymentFailure(ctx, pay.order_id);
      } else if (event.event === 'payout.processed' || event.event === 'payout.failed' || event.event === 'payout.reversed' || event.event === 'payout.rejected') {
        const po = event.payload?.payout?.entity;
        if (po?.id) await settlePayout(ctx, po.id, event.event === 'payout.processed' ? { ok: true, utr: po.utr ?? null } : { ok: false, reason: po.failure_reason || po.status_details?.description || event.event.replace('payout.', '') });
      } else if (event.event === 'refund.processed') {
        const rf = event.payload?.refund?.entity;
        if (rf?.id) await ctx.db.query(`UPDATE refunds SET status='processed', processed_at=COALESCE(processed_at, now()) WHERE razorpay_refund_id=$1`, [rf.id]);
      }
    } catch (e) {
      await ctx.db.query('DELETE FROM webhook_events WHERE event_id=$1', [eventId]); // allow Razorpay to retry
      throw e;
    }
    res.json({ received: true });
  });
  return r;
}
