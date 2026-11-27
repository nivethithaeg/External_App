// Builds the website (../frontend) after the backend is installed, so one Hostinger app serves both:
// the API on /api and the website on every other path. Skip with SKIP_FRONTEND_BUILD=1.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('..', 'frontend');
if (process.env.SKIP_FRONTEND_BUILD === '1' || !existsSync(path.join(dir, 'package.json'))) {
  console.log('[build-frontend] skipped');
  process.exit(0);
}
const env = {
  ...process.env,
  VITE_API_URL: process.env.VITE_API_URL ?? '', // same address as the API
  VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
};
const run = (cmd) => execSync(cmd, { cwd: dir, env, stdio: 'inherit' });
run('npm ci --include=dev --no-audit --no-fund');
run('npx vite build');
console.log('[build-frontend] website built into frontend/dist');
