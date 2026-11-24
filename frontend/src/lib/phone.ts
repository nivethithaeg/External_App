/**
 * A valid Indian mobile number: 10 digits starting with 6, 7, 8 or 9 (^[6-9]\d{9}$).
 * Numbers saved earlier come back as +91XXXXXXXXXX; those are checked on the 10 digits after the +91.
 */
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const MOBILE_MESSAGE = 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210';
export const isIndianMobile = (v: string) => MOBILE_RE.test(v.replace(/[\s-]/g, '').replace(/^\+?91(?=[6-9]\d{9}$)/, ''));
/** Drop-in for the old `PHONE.test(value)` style checks. */
export const PHONE_CHECK = { test: (v: string) => isIndianMobile(v) };
