// Verifies Razorpay credentials by creating a ₹1 test order. Usage: npm run check:razorpay
import { loadConfig } from '../src/config.js';
import { createRazorpayGateway } from '../src/lib/payments.js';
const cfg = loadConfig();
try {
  const o = await createRazorpayGateway(cfg).createOrder(1, `check_${Date.now()}`);
  console.log(`✓ Razorpay OK (${cfg.RAZORPAY_KEY_ID.startsWith('rzp_test') ? 'test' : 'LIVE'} mode). Order ${o.id}, ₹${o.amount}`);
} catch (e) { console.error('✗ Razorpay failed:', (e as Error).message); process.exit(1); }
