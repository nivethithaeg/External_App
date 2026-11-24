// Usage: ADMIN_EMAIL=you@x.com ADMIN_PASSWORD='long-password' npm run seed:admin
import bcrypt from 'bcryptjs';
import { loadConfig } from '../src/config.js';
import { createPgDb } from '../src/db.js';

const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 10) { console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars)'); process.exit(1); }
const cfg = loadConfig();
const db = createPgDb(cfg.DATABASE_URL, cfg.DATABASE_SSL === 'true');
await db.query(
  `INSERT INTO users (email, password_hash, full_name, role, admin_role, email_verified) VALUES ($1,$2,$3,'admin','super_admin',true)
   ON CONFLICT (lower(email)) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='admin', admin_role='super_admin', is_active=true`,
  [email.toLowerCase(), await bcrypt.hash(password, 12), process.env.ADMIN_NAME ?? 'Super Admin']);
console.log(`Super admin ready: ${email}`);
await db.close();
