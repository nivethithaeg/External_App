import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';

import { renderEmail, type EmailBrand } from './emailTemplate.js';

export interface Mailer { send(to: string, subject: string, html: string): Promise<void>; /** the website address for links in emails */ appUrl?: string; /** the support address shown in emails */ brand?: EmailBrand }

export const brandOf = (cfg: Config): EmailBrand => ({ supportEmail: cfg.SUPPORT_EMAIL || undefined, supportPhone: cfg.SUPPORT_PHONE || undefined });

export const appUrlOf = (cfg: Pick<Config, 'APP_URL' | 'CORS_ORIGINS'>) => (cfg.APP_URL || cfg.CORS_ORIGINS.split(',')[0] || 'http://localhost:5173').trim().replace(/\/+$/, '');

// The logos used by the email design travel inside each email (inline attachments), so they show in every inbox.
const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = [path.resolve(here, '..', '..', 'assets', 'email'), path.resolve(here, '..', '..', '..', 'assets', 'email')].find((d) => fs.existsSync(d));
/** every picture the email uses (cid:name), attached from assets/email/name.png or .jpg */
export const inlineImages = (html: string) => {
  if (!ASSETS) return [];
  const names = [...new Set([...html.matchAll(/cid:([a-z0-9-]+)/g)].map((m) => m[1]))];
  return names.flatMap((cid) => { const file = ['png', 'jpg'].map((x) => `${cid}.${x}`).find((f) => fs.existsSync(path.join(ASSETS, f))); return file ? [{ cid, filename: file, path: path.join(ASSETS, file), contentDisposition: 'inline' as const }] : []; });
};

export function createMailer(cfg: Config): Mailer {
  const appUrl = appUrlOf(cfg); const brand = brandOf(cfg);
  if (!cfg.SMTP_HOST) {
    return {
      appUrl, brand,
      async send(to, subject) {
        if (cfg.NODE_ENV === 'production') console.warn('[mailer] SMTP not configured; email skipped:', subject);
        else console.log(`[mailer:dev] to=${to} subject="${subject}"`);
      },
    };
  }
  const t = nodemailer.createTransport({
    host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, secure: cfg.SMTP_PORT === 465,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
  });
  return {
    appUrl, brand,
    async send(to, subject, html) {
      try { await t.sendMail({ from: cfg.SMTP_FROM, to, subject, html, attachments: inlineImages(html) }); }
      catch (e) { console.error('[mailer] failed to send', subject, e); }
    },
  };
}

/** An email in the PlaynX design with a title and a trusted HTML body (see renderEmail for the full options). */
export const emailLayout = (title: string, body: string, appUrl = 'http://localhost:5173') => renderEmail({ appUrl, title, html: body });
