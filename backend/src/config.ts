import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default(''),
  DATABASE_SSL: z.string().default('false'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_BUCKET: z.string().default('turf-media'),
  SUPABASE_PRIVATE_BUCKET: z.string().default('turf-private'),
  REQUIRE_PHONE_VERIFICATION: z.string().default('false'),
  // A playing area needs a geo-tagged photo (GPS position inside the photo) before its venue can be sent for approval, and the photo must be taken within this distance of the venue.
  REQUIRE_AREA_GEOTAG: z.string().default('false'),
  GEOTAG_MAX_METERS: z.coerce.number().int().min(50).max(5000).default(500),
  // Photos of a playing area must be live: taken with the in-app camera, together with the phone's live location. The server checks the
  // location against the venue and signs a proof tied to that exact photo; the proof is good for this many minutes.
  REQUIRE_LIVE_AREA_PHOTOS: z.string().default('false'),
  // JusGo's Add venue form needs a geo-tagged video recorded at the venue before it can be sent for approval. 'false' skips the check (development without a phone).
  REQUIRE_VENUE_GEO_VIDEO: z.string().default('true'),
  LIVE_PROOF_MAX_MINUTES: z.coerce.number().int().min(1).max(240).default(60),
  LIVE_MAX_ACCURACY_METERS: z.coerce.number().int().min(10).max(2000).default(150),
  // Looks up the street address of a live photo's location. Empty turns it off. Only the latitude and longitude are sent.
  GEOCODE_URL: z.string().default('https://nominatim.openstreetmap.org/reverse'),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  SENTRY_DSN: z.string().default(''), // optional: send server errors to Sentry
  ERROR_WEBHOOK_URL: z.string().default(''), // optional: post server errors to a Slack/Discord/Teams webhook
  // test payouts: with no RazorpayX account, money ready for an owner is marked paid automatically as a TEST (no real transfer). Never in production.
  PAYOUTS_TEST_MODE: z.enum(['true', 'false']).default('false'),
  RAZORPAYX_ACCOUNT_NUMBER: z.string().default(''), // the business current account that payouts are sent from; empty = payouts stay manual
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('KickOff <no-reply@localhost>'),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().default(''),
  SMS_WEBHOOK_URL: z.string().default(''),
  SMS_WEBHOOK_TOKEN: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  return parsed.data;
}
