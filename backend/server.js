// Hostinger (and any host whose entry file is "server.js") starts the app from here.
// The real server is the compiled TypeScript in dist/. If the host skipped the install scripts,
// build the API (and the website) here first, so the app still starts.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(here);
const run = (cmd) => { console.log(`[start] ${cmd}`); execSync(cmd, { cwd: here, stdio: 'inherit' }); };

process.on('uncaughtException', (e) => { console.error('[start] crashed:', e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('[start] crashed:', e); process.exit(1); });

try {
  if (!existsSync(path.join(here, 'dist', 'src', 'server.js'))) run('npm run build');
  if (!existsSync(path.join(here, '..', 'frontend', 'dist', 'index.html'))) run('node scripts/build-frontend.mjs');
} catch (e) {
  console.error('[start] build failed:', e?.message ?? e);
}
console.log(`[start] PlaynX starting on port ${process.env.PORT ?? 4000} (${process.env.NODE_ENV ?? 'development'})`);
// no top-level await here: Hostinger's LiteSpeed runner loads this file with require(), which refuses that
import('./dist/src/server.js').catch((e) => { console.error('[start] could not start:', e); process.exit(1); });
