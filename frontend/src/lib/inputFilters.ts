import type { InputFilter } from '../components/ui';

/** What each kind of box accepts while typing. Anything else is not typed, and the reason shows under the box. */
export const FILTERS = {
  personName: { blocked: /[^\p{L} .'-]/gu, message: "Only letters, spaces, apostrophes, hyphens and full stops are allowed in a name.", max: 100 },
  businessName: { blocked: /[^\p{L}\p{N} &.,'()/-]/gu, message: 'Only letters, numbers, spaces and & . , - ( ) / are allowed in a business name.', max: 150 },
  mobile: { blocked: /[^\d+]/g, message: 'A mobile number can only have digits (and + at the start).', max: 13 },
  email: { blocked: /\s/g, message: 'An email address cannot have spaces.', max: 254 },
  password: { blocked: /\s/g, message: 'A password cannot have spaces.', max: 72 },
  digits: (max: number, what = 'This box'): InputFilter => ({ blocked: /\D/g, message: `${what} can only have digits.`, max }),
  pan: { blocked: /[^A-Za-z0-9]/g, message: 'A PAN has only letters and digits, e.g. ABCDE1234F.', max: 10, upper: true },
  gst: { blocked: /[^A-Za-z0-9]/g, message: 'A GST number has only letters and digits.', max: 15, upper: true },
  cin: { blocked: /[^A-Za-z0-9]/g, message: 'A CIN has only letters and digits.', max: 21, upper: true },
  udyam: { blocked: /[^A-Za-z0-9-]/g, message: 'An Udyam number has only letters, digits and hyphens.', max: 19, upper: true },
  pincode: { blocked: /\D/g, message: 'A PIN code can only have digits.', max: 6 },
  aadhaar: { blocked: /\D/g, message: 'An Aadhaar number can only have digits.', max: 12 },
  ifsc: { blocked: /[^A-Za-z0-9]/g, message: 'An IFSC code has only letters and digits.', max: 11, upper: true },
  accountNumber: { blocked: /\D/g, message: 'A bank account number can only have digits.', max: 20 },
} satisfies Record<string, InputFilter | ((...a: any[]) => InputFilter)>;
