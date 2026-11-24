// One-shot setup for a new Supabase project: checks the DB connection, applies migrations, creates the public storage bucket.
// Usage: npm run setup:supabase   (reads backend/.env)
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { createPgDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const cfg = loadConfig();
for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) if (!cfg[k]) { console.error(`Missing ${k} in backend/.env`); process.exit(1); }

const db = createPgDb(cfg.DATABASE_URL, cfg.DATABASE_SSL === 'true');
try {
  await db.query('SELECT 1');
  console.log('✓ Database connection OK');
  const applied = await migrate(db);
  console.log(applied.length ? `✓ Migrations applied: ${applied.join(', ')}` : '✓ Database already up to date');
} catch (e) { console.error('✗ Database step failed:', (e as Error).message); process.exit(1); } finally { await db.close(); }

const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: buckets, error: listErr } = await sb.storage.listBuckets();
if (listErr) { console.error('✗ Storage check failed:', listErr.message); process.exit(1); }
if (buckets.some((b) => b.name === cfg.SUPABASE_BUCKET)) console.log(`✓ Bucket "${cfg.SUPABASE_BUCKET}" already exists`);
else {
  const { error } = await sb.storage.createBucket(cfg.SUPABASE_BUCKET, { public: true, fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf'] });
  if (error) { console.error('✗ Could not create bucket:', error.message); process.exit(1); }
  console.log(`✓ Bucket "${cfg.SUPABASE_BUCKET}" created`);
}
if (buckets.some((b) => b.name === cfg.SUPABASE_PRIVATE_BUCKET)) console.log(`✓ Private bucket "${cfg.SUPABASE_PRIVATE_BUCKET}" already exists`);
else {
  const { error } = await sb.storage.createBucket(cfg.SUPABASE_PRIVATE_BUCKET, { public: false, fileSizeLimit: 12 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] });
  if (error) { console.error('✗ Could not create private bucket:', error.message); process.exit(1); }
  console.log(`✓ Private bucket "${cfg.SUPABASE_PRIVATE_BUCKET}" created (not public)`);
}
console.log('Done. Next: ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=... npm run seed:admin, then npm run dev');
