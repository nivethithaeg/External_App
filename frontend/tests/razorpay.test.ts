import { describe, expect, it, vi } from 'vitest';
import { openCheckout } from '../src/lib/razorpay';

describe('openCheckout', () => {
  it('turns off card saving so Razorpay does not ask for a "save your card" OTP', async () => {
    let opts: any;
    (window as any).Razorpay = class { constructor(o: any) { opts = o; } open() { opts.handler({ razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 's' }); } on() {} };
    const r = await openCheckout({ keyId: 'k', orderId: 'o', amount: 800, name: 'PlaynX', description: 'x', prefill: { name: 'A', contact: '+919876543210' } });
    expect(opts.remember_customer).toBe(false);
    expect(opts.amount).toBe(80000);
    expect(r.razorpay_payment_id).toBe('p');
    vi.unstubAllGlobals();
  });
});
