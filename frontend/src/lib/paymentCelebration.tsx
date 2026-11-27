import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { PaymentSuccess } from '../components/PaymentSuccess';

/**
 * The "Payment succeeded" screen. `celebratePayment()` is called only after the server has verified the payment
 * (the verify-payment request returned success), never from the Pay button. The state lives in memory, so a page
 * refresh never replays it. <PaymentCelebrationHost /> is mounted once at the app root, so the screen shows over
 * whichever page the customer lands on.
 */
let open = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => { open = v; listeners.forEach((l) => l()); };
export const celebratePayment = () => set(true);
export const dismissPaymentCelebration = () => set(false);

export function PaymentCelebrationHost() {
  const visible = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => open);
  const nav = useNavigate();
  if (!visible) return null;
  return <PaymentSuccess onClose={dismissPaymentCelebration} onDashboard={() => { dismissPaymentCelebration(); nav('/home'); }} />;
}
