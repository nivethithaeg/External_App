// Sends a test email to SMTP_USER itself. Usage: npm run check:smtp
import nodemailer from 'nodemailer';
import { loadConfig } from '../src/config.js';
const c = loadConfig();
if (!c.SMTP_HOST || !c.SMTP_USER) { console.error('SMTP_HOST / SMTP_USER not set'); process.exit(1); }
const t = nodemailer.createTransport({ host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_PORT === 465, auth: { user: c.SMTP_USER, pass: c.SMTP_PASS } });
try { await t.sendMail({ from: c.SMTP_FROM || c.SMTP_USER, to: c.SMTP_USER, subject: 'KickOff SMTP test', text: 'Email delivery works.' }); console.log('✓ SMTP OK, test email sent to', c.SMTP_USER); }
catch (e) { console.error('✗ SMTP failed:', (e as Error).message); process.exit(1); }
