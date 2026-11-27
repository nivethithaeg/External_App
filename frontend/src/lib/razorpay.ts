declare global { interface Window { Razorpay?: new (opts: any) => { open(): void; on(ev: string, fn: (r: any) => void): void } } }

let loading: Promise<void> | null = null;
export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Could not load the payment window. Check your connection.')); };
    document.body.appendChild(s);
  });
  return loading;
}

export interface CheckoutResult { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }

/** Thrown when the payment window ends without a successful payment. `failed` is true when the payment was attempted and declined. */
export class PaymentNotCompleted extends Error { failed: boolean; constructor(failed: boolean, message: string) { super(message); this.name = 'PaymentNotCompleted'; this.failed = failed; } }
export const isPaymentNotCompleted = (e: unknown): e is PaymentNotCompleted => (e as Error)?.name === 'PaymentNotCompleted'; // by name, so it survives module mocks

/** Opens Razorpay Checkout. Resolves with the signed result. A declined attempt does not close the window (the customer may retry inside it); if it closes unpaid, rejects with PaymentNotCompleted. */
export async function openCheckout(o: { keyId: string; orderId: string; amount: number; name: string; description: string; prefill?: { name?: string; email?: string; contact?: string } }): Promise<CheckoutResult> {
  await loadRazorpay();
  return new Promise((resolve, reject) => {
    let failure: string | null = null;
    const rzp = new window.Razorpay!({
      key: o.keyId, order_id: o.orderId, amount: Math.round(o.amount * 100), currency: 'INR', name: o.name, description: o.description,
      prefill: o.prefill, theme: { color: '#7200FF' },
      remember_customer: false, // no "save your card" step or OTP; the customer just pays
      handler: (r: CheckoutResult) => resolve(r),
      modal: { ondismiss: () => reject(new PaymentNotCompleted(!!failure, failure ?? 'dismissed')) },
    });
    rzp.on('payment.failed', (r: any) => { failure = r?.error?.description || 'Payment failed'; });
    rzp.open();
  });
}
