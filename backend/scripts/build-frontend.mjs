// Builds the website (../frontend) into backend/web, which is committed: the Hostinger app serves it as is,
// so the host never has to build the website itself. Run "npm run build:web" after website changes, then commit web/.
import { execSync } from 'node:child_process';
import path from 'node:path';

const dir = path.resolve('..', 'frontend');
const out = path.resolve('web');
const env = { ...process.env, VITE_API_URL: '' }; // same address as the API
const run = (cmd) => execSync(cmd, { cwd: dir, env, stdio: 'inherit' });
run(`npx vite build --outDir "${out}" --emptyOutDir`);
console.log(`[build-web] website built into ${out}`);
