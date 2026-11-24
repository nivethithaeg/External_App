/** Owner profile fields that, once the owner is approved, change only after an admin approves them. API name -> owner_profiles column. */
export const SENSITIVE_FIELDS = {
  businessName: 'business_name', gstin: 'gstin', pan: 'pan', address: 'address',
  bankAccountName: 'bank_account_name', bankAccountNumber: 'bank_account_number', bankIfsc: 'bank_ifsc', upiId: 'upi_id',
} as const;
export const BANK_COLUMNS = ['bank_account_name', 'bank_account_number', 'bank_ifsc', 'upi_id'];
export const FIELD_LABEL: Record<string, string> = {
  business_name: 'Business name', gstin: 'GSTIN', pan: 'PAN', address: 'Registered address',
  bank_account_name: 'Account holder name', bank_account_number: 'Account number', bank_ifsc: 'IFSC', upi_id: 'UPI ID',
};
/** Account numbers are never shown in full outside the owner's own bank page. */
export const maskAccount = (v: string | null | undefined) => (v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : null);
export const showValue = (col: string, v: unknown) => (v === null || v === undefined || v === '' ? null : col === 'bank_account_number' ? maskAccount(String(v)) : String(v));
/** An owner_profiles row as sent to the owner: the account number is masked. */
export const publicOwnerProfile = (row: any) => { const { bank_account_number: acct, ...safe } = row; return { ...safe, bank_account_number: maskAccount(acct) }; };
/** A change request as shown to the owner or an admin: proposed values by label, account number masked. */
export const describeChange = (c: any, current: any) => Object.entries(c.fields as Record<string, string>).map(([col, proposed]) => ({ field: col, label: FIELD_LABEL[col] ?? col, current: showValue(col, current?.[col]), proposed: showValue(col, proposed) }));
