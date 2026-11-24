import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface Mailer { send(to: string, subject: string, html: string): Promise<void> }

export function createMailer(cfg: Config): Mailer {
  if (!cfg.SMTP_HOST) {
    return {
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
    async send(to, subject, html) {
      try { await t.sendMail({ from: cfg.SMTP_FROM, to, subject, html }); }
      catch (e) { console.error('[mailer] failed to send', subject, e); }
    },
  };
}

export const emailLayout = (title: string, body: string) =>
  `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#151515;color:#ffffff;padding:24px;border-radius:12px">
   <h2 style="color:#FF6B22;margin-top:0">KickOff</h2><h3>${title}</h3>${body}
   <p style="color:#b0b0b0;font-size:12px;margin-top:24px">You are receiving this because you have an account on KickOff.</p></div>`;
