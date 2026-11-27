import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, createApprovedVenue, setup, type TestEnv } from './helpers.js';
import { backupDatabase } from '../src/lib/backup.js';

let env: TestEnv; const root = fs.mkdtempSync(path.join(os.tmpdir(), 'playnx-backup-'));
beforeAll(async () => { env = await setup(); const a = await createAdmin(env); await createApprovedVenue(env, a); });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('database backup', () => {
  it('writes one gzip NDJSON file per table with a manifest, and leaves out secrets and short-lived tables', async () => {
    const out = await backupDatabase(env.db, root, { now: new Date('2030-01-05T10:00:00Z') });
    expect(fs.existsSync(path.join(out.dir, 'manifest.json'))).toBe(true);
    expect(out.tables.users).toBeGreaterThan(0); expect(out.tables.venues).toBe(1);
    const rows = zlib.gunzipSync(fs.readFileSync(path.join(out.dir, 'venues.ndjson.gz'))).toString().trim().split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1); expect(rows[0].name).toBeTruthy();
    for (const skipped of ['otp_codes', 'device_tokens', 'slot_locks', 'schema_migrations']) expect(out.tables).not.toHaveProperty(skipped);
  });

  it('deletes backups older than the retention period but keeps recent ones', async () => {
    const old = path.join(root, '2029-01-01T00-00-00'); fs.mkdirSync(old);
    const longAgo = new Date('2029-01-01T00:00:00Z'); fs.utimesSync(old, longAgo, longAgo);
    const fresh = path.join(root, '2030-01-04T00-00-00'); fs.mkdirSync(fresh); const recent = new Date('2030-01-04T00:00:00Z'); fs.utimesSync(fresh, recent, recent);
    await backupDatabase(env.db, root, { now: new Date('2030-01-06T10:00:00Z'), keepDays: 14 });
    expect(fs.existsSync(old)).toBe(false); expect(fs.existsSync(fresh)).toBe(true);
  });
});
