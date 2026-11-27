import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('installable app files', () => {
  const pub = (f: string) => resolve(process.cwd(), 'public', f);
  it('has a manifest with a name, start page, standalone display and real icons', () => {
    const m = JSON.parse(readFileSync(pub('manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ short_name: 'PlaynX', start_url: expect.stringContaining('/'), display: 'standalone', theme_color: '#101B5C' });
    for (const i of m.icons) expect(existsSync(pub(i.src.slice(1)))).toBe(true);
    expect(m.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    expect(m.icons.some((i: any) => i.sizes === '192x192')).toBe(true);
  });
  it('has a service worker that never caches API calls or other sites', () => {
    const sw = readFileSync(pub('sw.js'), 'utf8');
    expect(sw).toMatch(/startsWith\('\/api\/'\)/); expect(sw).toMatch(/url\.origin !== self\.location\.origin/); expect(sw).toMatch(/req\.method !== 'GET'/);
  });
  it('links the manifest and an Apple icon from the page', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"'); expect(html).toContain('apple-touch-icon');
  });
});
