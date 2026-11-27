# PlaynX: Turf Booking Platform

Three portals in one app: **Customer** (`/`), **Turf Owner** (`/owner`), **Admin** (`/admin`).
React + TypeScript + Tailwind + React Query (frontend) · Node/Express/TypeScript REST API · PostgreSQL (Supabase) · Razorpay · Google Maps · FCM · SMTP · Socket.IO.

```
backend/   Express API, SQL migrations, tests      frontend/  Vite React app, tests      docs/  deployment notes
```

## Run locally (no Postgres needed)
```bash
cd backend  && npm i && DEMO=1 npm run dev:local     # real API on embedded Postgres (PGlite), loads optional demo venues
cd frontend && npm i && npm run dev                  # http://localhost:5173 (proxies /api to :4000)
```
Demo logins (only with `DEMO=1`): `admin@playnx.local`, `owner@playnx.local`, password `PlaynX@12345`. Customers register themselves; with no SMTP configured, OTP emails are only logged as a subject line, so read the code from the `otp_codes` flow in tests or configure SMTP.
Payments need Razorpay **test** keys in `backend/.env` (copy `.env.example`); without them checkout returns "Payments are not configured".

## Run against Supabase / Postgres
1. Create a Supabase project, copy the pooled connection string into `DATABASE_URL`; create a **public** Storage bucket named `turf-media`; set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
2. `cd backend && cp .env.example .env` (fill it), then `npm run migrate` and `ADMIN_EMAIL=you@x.com ADMIN_PASSWORD='long-password' npm run seed:admin`.
3. `npm run dev`.

## Tests
```bash
cd backend && npm test     # 56 tests: pricing, booking engine, double-booking constraints, payments, webhooks, refunds, auth/RBAC, uploads
cd frontend && npm test    # component tests; `npm run build` type-checks and builds
```
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production.

## How double-booking is prevented
- `bookings` has `EXCLUDE USING gist (area_id WITH =, during WITH &&) WHERE status IN (pending, confirmed, completed, blocked)`; `slot_locks` has the same on live holds. Overlap is impossible regardless of app bugs; the API maps the violation to HTTP 409.
- Flow: lock (10 min, configurable) → pending booking + Razorpay order → signature-verified payment (or webhook) → confirmed. A 30 s job expires holds/unpaid bookings. Late payment on an expired hold revives the booking if the slot is still free, else auto-refunds.
- Payment confirmation is idempotent (row lock on the payment; webhook event IDs are de-duplicated).

## Auth note
Authentication is implemented in the API (bcrypt + JWT, email/SMS OTP) over Supabase **Postgres/Storage**, not Supabase Auth, so that role rules, OTP and the booking engine live in one place and are testable. RLS is enabled on every table (deny-by-default plus read policies for Supabase's `auth.uid()`); the API connects with the privileged DB role.
