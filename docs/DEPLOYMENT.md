# Deployment

## Database + storage (Supabase)
1. New project → Settings → Database → copy the **pooler** connection string → `DATABASE_URL` (`DATABASE_SSL=true`).
2. Storage → create bucket `turf-media` (public). Use the service-role key only in the backend `.env`.
3. `npm run migrate` (idempotent, tracked in `schema_migrations`). Then seed the first admin (`npm run seed:admin`).

## Backend (Hostinger VPS, Ubuntu)
```bash
sudo apt install -y nginx certbot python3-certbot-nginx && curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs && sudo npm i -g pm2
git clone <repo> && cd backend && npm ci && cp .env.example .env   # fill in; NODE_ENV=production; CORS_ORIGINS=https://your-frontend
npm run build && npm run migrate   # migrate runs via tsx; or `node dist/src/migrate.js`
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
sudo cp ../docs/nginx.conf /etc/nginx/sites-available/playnx-api && sudo ln -s /etc/nginx/sites-available/playnx-api /etc/nginx/sites-enabled/ && sudo certbot --nginx -d api.YOUR-DOMAIN.com
```
Run a **single** API instance (Socket.IO rooms and the maintenance timer are in-process); scale later with a Socket.IO Redis adapter.
Optional push: `npm i firebase-admin` and set `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Razorpay
Dashboard → Webhooks → `https://api.YOUR-DOMAIN.com/api/webhooks/razorpay`, events `payment.captured`, `payment.failed`, `refund.processed`; secret = `RAZORPAY_WEBHOOK_SECRET`. Use live keys only after a test-mode run.

## Frontend (Vercel)
Root `frontend`, build `npm run build`, output `dist`. Edit `vercel.json` to point `/api` at your API (or set `VITE_API_URL=https://api.YOUR-DOMAIN.com` and add the Vercel domain to the API's `CORS_ORIGINS`). Socket.IO needs `VITE_API_URL` set (Vercel rewrites do not proxy WebSockets). Set `VITE_GOOGLE_MAPS_KEY` (restrict by HTTP referrer) and optional `VITE_FIREBASE_*`. For Hostinger static hosting, upload `dist/` and add an SPA fallback to `index.html`.

## Production checklist
- Strong unique `JWT_SECRET`; HTTPS everywhere; SMTP + SMS gateway configured (without them OTPs cannot reach users).
- Rotate any key that has been pasted into chat/tickets. Back up Supabase (PITR) before go-live.
