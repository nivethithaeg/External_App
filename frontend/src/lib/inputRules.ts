import type { InputFilter } from '../components/ui';
import { FILTERS } from './inputFilters';
import { PHONE_CHECK, MOBILE_MESSAGE } from '../lib/phone';

/**
 * What every form box knows about itself from its label: an example to show inside it, what may be typed, and what makes it valid.
 * A form can still pass its own `placeholder` / `filter`; these only fill the gaps, so no box is left without an example or a check.
 */
export interface AutoRules { placeholder?: string; filter?: InputFilter; validate?(value: string): string }

const PHONE = PHONE_CHECK;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GST = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const money: InputFilter = { blocked: /[^\d.]/g, message: 'An amount can only have digits and a decimal point.', max: 10 };

export function autoRules(labelRaw: string, opts: { type?: string; autoComplete?: string; textarea?: boolean } = {}): AutoRules {
  const label = labelRaw.replace(/\((optional|required)[^)]*\)/gi, '').trim();
  const l = label.toLowerCase();
  const either = / or /.test(l); // "Email or mobile number": both kinds are fine, so no single rule applies
  const text = (placeholder: string): AutoRules => ({ placeholder });

  if (opts.type === 'date' || opts.type === 'time' || opts.type === 'datetime-local' || opts.type === 'checkbox' || opts.type === 'file') return {};
  if (either) return { placeholder: 'e.g. name@example.com or 9876543210' };
  if (/password/.test(l)) {
    if (opts.autoComplete === 'current-password' || /current|your password/.test(l)) return { placeholder: 'Enter your password' };
    if (/confirm/.test(l)) return { placeholder: 'Type the same password again', filter: FILTERS.password };
    return { placeholder: 'At least 8 characters, with a letter and a digit', filter: FILTERS.password, validate: (v) => (v && !(v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v)) ? 'Use at least 8 characters with a letter and a digit.' : '') };
  }
  if (/e-?mail/.test(l)) return { placeholder: 'e.g. name@example.com', filter: FILTERS.email, validate: (v) => (v && !EMAIL.test(v) ? 'Enter a valid email address, e.g. name@example.com.' : '') };
  if (/mobile|phone|contact number/.test(l)) return { placeholder: 'e.g. 9876543210', filter: FILTERS.mobile, validate: (v) => (v && !PHONE.test(v.replace(/[\s-]/g, '')) ? MOBILE_MESSAGE : '') };
  if (/6-digit code|otp/.test(l)) return { placeholder: '000000', filter: { blocked: /\D/g, message: 'The code has only digits.', max: 6 }, validate: (v) => (v && v.length !== 6 ? 'The code has 6 digits.' : '') };
  if (/\bpan\b/.test(l)) return { placeholder: 'e.g. ABCDE1234F', filter: FILTERS.pan, validate: (v) => (v && !PAN.test(v) ? 'A PAN looks like ABCDE1234F (5 letters, 4 digits, 1 letter).' : '') };
  if (/gstin|gst number/.test(l)) return { placeholder: 'e.g. 22AAAAA0000A1Z5', filter: FILTERS.gst, validate: (v) => (v && !GST.test(v) ? 'A GST number has 15 characters, e.g. 22AAAAA0000A1Z5.' : '') };
  if (/ifsc/.test(l)) return { placeholder: 'e.g. HDFC0001234', filter: FILTERS.ifsc, validate: (v) => (v && !IFSC.test(v) ? 'An IFSC looks like HDFC0001234 (4 letters, 0, then 6 letters or digits).' : '') };
  if (/account number/.test(l)) return { placeholder: 'e.g. 123456789012', filter: FILTERS.accountNumber, validate: (v) => (v && !/^\d{6,20}$/.test(v) ? 'An account number has 6 to 20 digits.' : '') };
  if (/upi/.test(l)) return { placeholder: 'e.g. name@okhdfcbank', validate: (v) => (v && !/^[\w.-]{2,}@[A-Za-z]{2,}$/.test(v) ? 'A UPI ID looks like name@bank.' : '') };
  if (/pin ?code|postal/.test(l)) return { placeholder: 'e.g. 560038', filter: FILTERS.pincode, validate: (v) => (v && !/^[1-9]\d{5}$/.test(v) ? 'A PIN code has 6 digits.' : '') };
  if (/\bcin\b/.test(l)) return { placeholder: 'e.g. U74999TN2018PTC123456', filter: FILTERS.cin };
  if (/aadhaar/.test(l)) return { placeholder: 'e.g. 123456789012', filter: FILTERS.aadhaar, validate: (v) => (v && v.length !== 12 ? 'An Aadhaar number has 12 digits.' : '') };
  if (/udyam/.test(l)) return { placeholder: 'e.g. UDYAM-TN-00-0000001', filter: FILTERS.udyam };
  if (/sac code/.test(l)) return text('e.g. 9996');
  if (/booking id/.test(l)) return text('e.g. KO-ABC1234');
  if (/₹|amount|price|min order/.test(l)) return { placeholder: 'e.g. 800', ...(opts.type === 'number' ? {} : { filter: money }), validate: (v) => (v && !(Number(v) >= 0) ? 'Enter an amount of 0 or more.' : '') };
  if (/%|percent/.test(l)) return text('e.g. 10');
  if (/\(days\)|days\b/.test(l)) return text('e.g. 60');
  if (/hours/.test(l)) return text('e.g. 24');
  if (/minutes/.test(l)) return text('e.g. 10');
  if (/capacity|players|total uses|per user|limit/.test(l)) return text('e.g. 10');
  if (/venue name|venue \/ brand|venue brand|business|trade name|company|firm|academy|organi[sz]ation/.test(l)) return text('e.g. Green Arena Sports');
  if (/event name/.test(l)) return text('e.g. Corporate cup');
  if (/(full|legal|customer|owner|opponent|proprietor|account holder|person|representative|first|last)[^.]*name|^name$|^name\b/.test(l)) return {
    placeholder: 'e.g. Ravi Kumar',
    ...(/^name$/.test(l) ? {} : { filter: FILTERS.personName }),
  };
  if (/surface/.test(l)) return text('e.g. Artificial grass');
  if (/address/.test(l)) return text('e.g. 12 Park Road, Indiranagar');
  if (/locality|area/.test(l)) return text('e.g. Indiranagar');
  if (/\bcity|location/.test(l)) return text('e.g. Erode');
  if (/country/.test(l)) return text('e.g. India');
  if (/subject/.test(l)) return text('e.g. Refund not received');
  if (/title/.test(l)) return text('e.g. Weekend offer');
  if (/\bcode\b/.test(l)) return text('e.g. KICK10');
  if (/description|message|comment|review|notes?\b|help/.test(l)) return text('Write a few words…');
  if (/reason|why/.test(l)) return text('e.g. Venue closed for maintenance');
  if (/reply/.test(l)) return text('Write your reply…');
  if (/designation/.test(l)) return text('e.g. Managing Partner');
  if (/value/.test(l)) return text('e.g. 10');
  if (/month/.test(l)) return {};
  return { placeholder: `Enter ${l.replace(/\s+/g, ' ')}` };
}
