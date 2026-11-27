import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { renderEmail } from '../src/lib/emailTemplate.js';
import { inlineImages } from '../src/lib/mailer.js';

describe('PlaynX email design', () => {
  it('a booking confirmation has the banner, greeting, details box, button and footer', () => {
    const html = renderEmail({ appUrl: 'https://playnx.test/', type: 'booking_confirmed', title: 'Booking confirmed', text: 'Green Arena (Turf 1) on Sat. Reference PX-AB12CDE.',
      name: 'Priya Sharma', role: 'customer', details: [['Venue', 'Green Arena · Turf 1'], ['Date', 'Sat, 21 Nov 2026'], ['Time', '05:00 PM – 06:00 PM'], ['Booking ID', 'PX-AB12CDE']],
      cta: { label: 'View my booking', url: 'https://playnx.test/bookings/b1' } });
    for (const t of ['Your Turf Booking', 'is Confirmed!', 'Get ready to play!', 'Hi Priya,', 'Your turf booking has been successfully confirmed.', 'Enjoy your game!', 'Booking Details', 'PX-AB12CDE', 'View my booking', 'https://playnx.test/bookings/b1', 'Premium', 'Help Centre', 'because you booked a turf with PlaynX', 'Unsubscribe']) expect(html).toContain(t);
    expect(html).toContain('cid:playnx-logo'); // the logo travels inside the email
    expect(inlineImages(html).map((a) => a.cid).sort()).toEqual(['icon-ball', 'icon-bolt', 'icon-calendar', 'icon-shield', 'icon-trophy', 'playnx-banner', 'playnx-logo', 'playnx-logo-light']);
    for (const a of inlineImages(html)) expect(fs.existsSync(a.path)).toBe(true);
    expect(html).toContain('https://playnx.test/settings'); // players manage their email settings here
  });
  it('owners and admins get the business points and their own settings link; text is escaped', () => {
    const owner = renderEmail({ appUrl: 'https://playnx.test', type: 'owner_new_booking', title: 'New booking', text: '<script>x</script>', role: 'owner' });
    expect(owner).toContain('New Booking'); expect(owner).toContain('because you run a venue on PlaynX'); expect(owner).toContain('/owner/notifications');
    expect(owner).not.toContain('<script>x</script>');
    const admin = renderEmail({ appUrl: 'https://playnx.test', type: 'admin_ticket_created', title: 'New support ticket', role: 'admin' });
    expect(admin).toContain('Admin'); expect(admin).toContain('New support ticket'); expect(admin).toContain('/admin/notifications');
  });
  it('shows the support address when one is set, and a code email has no unsubscribe link', () => {
    const html = renderEmail({ appUrl: 'https://playnx.test', type: 'otp', title: 'Verification code', supportEmail: 'support@playnx.test' });
    expect(html).toContain('mailto:support@playnx.test'); expect(html).not.toContain('Follow us on'); expect(html).not.toContain('social-');
    expect(html).not.toContain('Unsubscribe');
  });
});

describe('contact details in emails', () => {
  it('shows the PlaynX support email and phone at the bottom', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { brandOf } = await import('../src/lib/mailer.js');
    const brand = brandOf(loadConfig({ JWT_SECRET: 'x'.repeat(40) } as any));
    expect(brand).toEqual({ supportEmail: 'playnx.official@gmail.com', supportPhone: '+91 90958 21333' });
    const html = renderEmail({ appUrl: 'https://playnx.test', type: 'booking_confirmed', title: 'Booking confirmed', ...brand });
    expect(html).toContain('mailto:playnx.official@gmail.com'); expect(html).toContain('tel:+919095821333'); expect(html).toContain('+91 90958 21333');
  });
});
