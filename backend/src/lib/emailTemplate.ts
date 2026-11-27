/**
 * The PlaynX email design, used for every email the platform sends (players, venue owners and admins):
 * logo, a banner photo with a heading for what the email is about, a greeting, the message, a booking details box,
 * one button, four brand points, a navy footer and a help line.
 * Email clients ignore most modern CSS, so this is table-based with inline styles and solid colour fallbacks.
 * Every picture (logos, banner, icons) is attached to the email itself (cid:...), so it shows in every inbox.
 */

export type EmailRole = 'customer' | 'owner' | 'admin' | 'staff' | undefined;
export interface EmailBrand {
  /** a support address shown as "Contact us at ..."; without it the Help Centre is linked */
  supportEmail?: string;
  /** a support phone number shown next to it */
  supportPhone?: string;
}
export interface EmailInput extends EmailBrand {
  appUrl: string;
  /** the notification type (booking_confirmed, refund, payout, admin_...); picks the banner heading and the wording */
  type?: string;
  title: string;
  /** the message as plain text (escaped here) */
  text?: string;
  /** extra trusted HTML placed under the message (for example a verification code box) */
  html?: string;
  name?: string;
  role?: EmailRole;
  /** label / value pairs shown in the details box: turf name, date, time and booking ID */
  details?: [string, string][];
  detailsTitle?: string;
  /** a note under the details box, such as what was paid now and what is due at the venue */
  detailsNote?: string;
  cta?: { label: string; url: string } | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const FONT = "'Poppins','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const NAVY = '#101B5C', PURPLE = '#5B14D6', INK = '#11152F', MUTED = '#5E6278', LINE = '#E2D9F7', BG = '#F9F8FD';
const BANNER_NAVY = '#070F4B'; // the colour the banner photo fades into on its left edge

/** banner heading (two lines, the second in purple) and the line under it */
const BANNERS: Record<string, [string, string, string]> = {
  booking_confirmed: ['Your Turf Booking', 'is Confirmed!', 'Get ready to play!'],
  booking_cancelled: ['Your Turf Booking', 'was Cancelled', 'Any refund due to you is on its way.'],
  booking_rescheduled: ['Your Turf Booking', 'has a New Time', 'Here are the updated details.'],
  booking_reminder: ['Game Time', 'is Coming Up!', 'See you on the field.'],
  refund: ['Your Refund', 'is on its Way', 'We will keep you posted until it reaches you.'],
  wallet: ['Your Wallet', 'was Updated', 'Use your balance on your next booking.'],
  owner_new_booking: ['New Booking', 'for Your Venue!', 'A player just booked a slot.'],
  owner_booking_rescheduled: ['A Booking', 'has a New Time', 'Your calendar is already updated.'],
  payout: ['Your Payout', 'is on its Way', 'Your share for completed games.'],
  venue_status: ['Venue', 'Update', 'Here is the latest on your venue.'],
  area_status: ['Playing Area', 'Update', 'Here is the latest on your playing area.'],
  owner_verification: ['Your Account', 'Update', 'Here is where things stand.'],
  application: ['Your Application', 'Update', 'Here is where things stand.'],
  bank: ['Bank Details', 'Update', 'About your payout account.'],
  bank_account: ['Bank Details', 'Update', 'About your payout account.'],
  support: ['Support', 'Update', 'We have an update on your ticket.'],
  security: ['Security', 'Alert', 'Something changed on your account.'],
  announcement: ['News from', 'PlaynX', 'Play • Experience • Repeat'],
  otp: ['Your Verification', 'Code', 'Use it within 10 minutes.'],
};
const bannerFor = (type: string | undefined, title: string): [string, string, string] =>
  (type && BANNERS[type]) || (type?.startsWith('admin_') ? ['Admin', 'Alert', title] : [title, '', 'Play • Experience • Repeat']);

/** the opening line under "Hi name," when it differs from the notification text */
const OPENING: Record<string, string> = { booking_confirmed: 'Your turf booking has been successfully confirmed.' };

const POINTS: [string, string, string][] = [['icon-ball', 'Premium', 'Turfs'], ['icon-bolt', 'Instant', 'Booking'], ['icon-shield', 'Secure', 'Payments'], ['icon-trophy', 'Play More,', 'Worry Less']];

/** why this person got the email, shown at the bottom */
function reason(type: string | undefined, role: EmailRole) {
  if (type === 'otp') return 'You received this email because this address was used to sign up or sign in on PlaynX.';
  if (role === 'admin') return 'You received this email because you are a PlaynX admin.';
  if (role === 'owner' || role === 'staff') return 'You received this email because you run a venue on PlaynX.';
  if (type?.startsWith('booking') || type === 'refund') return 'You received this email because you booked a turf with PlaynX.';
  return 'You received this email because you have a PlaynX account.';
}

export function renderEmail(e: EmailInput): string {
  const app = e.appUrl.replace(/\/+$/, '');
  const [h1, h2, sub] = bannerFor(e.type, e.title);
  const settings = e.role === 'owner' ? '/owner/notifications' : e.role === 'admin' ? '/admin/notifications' : '/settings';
  const canUnsubscribe = e.type !== 'otp' && e.type !== 'security';
  const opening = (e.type && OPENING[e.type]) || e.text || '';

  const details = e.details?.length ? `
  <tr><td style="padding:10px 24px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEFE;border:1px solid ${LINE};border-radius:18px">
      <tr><td style="padding:20px 22px 8px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="padding-right:12px"><img src="cid:icon-calendar" width="30" height="30" alt="" style="display:block;border:0"></td>
          <td valign="middle" style="font:700 20px ${FONT};color:${INK}">${esc(e.detailsTitle ?? 'Booking Details')}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:6px 12px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${e.details.map(([k, v], i) => `<td valign="top" style="padding:4px 12px;${i ? `border-left:1px solid ${LINE};` : ''}">
            <div style="font:400 13px ${FONT};color:${MUTED}">${esc(k)}</div>
            <div style="font:600 15px/1.35 ${FONT};color:${INK};padding-top:6px">${esc(v)}</div></td>`).join('')}
        </tr></table>
        ${e.detailsNote ? `<div style="font:400 13px ${FONT};color:${MUTED};padding:12px 12px 0">${esc(e.detailsNote)}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>` : '';

  const cta = e.cta ? `
  <tr><td align="center" style="padding:30px 24px 8px">
    <a href="${esc(e.cta.url)}" style="display:inline-block;background:${PURPLE};background-image:linear-gradient(90deg,#4B12C2,#6A1BE0);color:#ffffff;text-decoration:none;font:600 18px ${FONT};padding:16px 52px;border-radius:999px">${esc(e.cta.label)} &nbsp;&rarr;</a>
  </td></tr>` : '';

  const points = POINTS.map(([icon, a, b], i) => `
      <td align="center" valign="top" width="25%" style="padding:6px 4px;${i ? `border-left:1px solid ${LINE};` : ''}">
        <img src="cid:${icon}" width="64" height="64" alt="" style="display:block;margin:0 auto;border:0">
        <div style="font:400 15px/1.4 ${FONT};color:${INK};padding-top:10px">${a}<br>${b}</div></td>`).join('');

  const follow = `<td valign="middle" align="right" style="padding:22px 24px;border-left:1px solid rgba(255,255,255,.25);font:600 15px ${FONT};color:#ffffff">Play <span style="color:#A100FF">•</span> Experience <span style="color:#A100FF">•</span> Repeat</td>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.title)}</title></head>
<body style="margin:0;padding:0;background:${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="660" cellpadding="0" cellspacing="0" style="width:100%;max-width:660px;background:#ffffff;border:1.5px solid #D9CCF5;border-radius:26px;box-shadow:0 12px 40px -18px rgba(91,20,214,.35)">
  <tr><td style="height:14px;font-size:0;line-height:0">&nbsp;</td></tr>

  <tr><td align="center" style="padding:6px 24px 18px">
    <a href="${app}/" style="text-decoration:none"><img src="cid:playnx-logo" width="300" alt="PlaynX" style="display:block;width:300px;max-width:75%;height:auto;border:0;font:800 34px ${FONT};color:${NAVY}"></a>
  </td></tr>

  <tr><td style="padding:0 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:20px;overflow:hidden;background:${BANNER_NAVY}">
      <tr>
        <td valign="middle" style="background:${BANNER_NAVY};background-image:linear-gradient(110deg,#6A1BD8 0%,#2A1494 30%,${BANNER_NAVY} 75%);height:200px;padding:0 10px 0 30px;border-radius:20px 0 0 20px">
          <div style="font:italic 800 30px/1.15 ${FONT};color:#ffffff">${esc(h1)}</div>
          ${h2 ? `<div style="font:italic 800 32px/1.2 ${FONT};color:#A77BFF">${esc(h2)}</div>` : ''}
          <div style="width:150px;height:4px;background:#7B3BFF;border-radius:4px;margin:14px 0 16px"></div>
          <div style="font:400 17px ${FONT};color:#ffffff">${esc(sub)}</div>
        </td>
        <td valign="top" width="290" style="width:290px;padding:0;border-radius:0 20px 20px 0;overflow:hidden;background:#070F4B"><img src="cid:playnx-banner" width="290" height="200" alt="" style="display:block;width:290px;height:200px;border:0;border-radius:0 20px 20px 0"></td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:30px 26px 6px;font:700 22px ${FONT};color:${NAVY}">Hi ${esc(e.name?.trim() ? e.name.trim().split(/\s+/)[0] : 'there')},</td></tr>
  <tr><td style="padding:8px 26px 14px;font:400 17px/1.6 ${FONT};color:${INK}">
    ${esc(opening).replace(/\n/g, '<br>')}${e.type === 'booking_confirmed' ? ` <b style="color:${PURPLE}">Enjoy your game!</b>` : ''}
    ${e.html ?? ''}
  </td></tr>
  ${details}
  ${cta}

  <tr><td style="padding:28px 12px 18px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${points}</tr></table>
  </td></tr>

  <tr><td style="padding:12px 16px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};background-image:linear-gradient(110deg,${NAVY} 55%,#3A12A8 85%,#6A1BD8 100%);border-radius:18px">
      <tr>
        <td valign="middle" style="padding:20px 18px 20px 26px"><img src="cid:playnx-logo-light" width="190" alt="PlaynX" style="display:block;width:190px;height:auto;border:0;font:800 26px ${FONT};color:#ffffff"></td>
        ${follow}
      </tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:24px 24px 10px;font:400 15px/1.8 ${FONT};color:${INK}">
    ${e.supportEmail ? `Need help? Contact us at <a href="mailto:${esc(e.supportEmail)}" style="color:${PURPLE};font-weight:700;text-decoration:none">${esc(e.supportEmail)}</a>${e.supportPhone ? ` or call <a href="tel:${esc(e.supportPhone.replace(/[^\d+]/g, ''))}" style="color:${PURPLE};font-weight:700;text-decoration:none">${esc(e.supportPhone)}</a>` : ''}` : `Need help? Visit our <a href="${app}/help" style="color:${PURPLE};font-weight:700;text-decoration:none">Help Centre</a>`}<br>
    <span style="font-size:14px">${reason(e.type, e.role)}</span><br>
    ${canUnsubscribe ? `<a href="${app}${settings}" style="color:${PURPLE};font-size:14px">Unsubscribe</a>` : ''}
  </td></tr>
  <tr><td style="height:16px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
