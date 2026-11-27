/** PlaynX's public contact details: shown on the Contact page, in the footer and the help pages. */
export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'playnx.official@gmail.com';
export const SUPPORT_PHONE = (import.meta.env.VITE_SUPPORT_PHONE as string | undefined) || '+91 90958 21333';
/** the number as a tel: link (digits and a leading +) */
export const SUPPORT_TEL = `tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}`;
