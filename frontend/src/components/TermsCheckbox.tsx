import { useId, useState } from 'react';
import { Button, Modal } from './ui';

/** The Terms and Conditions every customer and venue owner accepts. The wording is JusGo's (exactly). */
export const SIGNUP_TERMS = [
  'You will provide accurate information.',
  'You will use the account only for legitimate bookings.',
  'Bookings are subject to turf availability and the applicable cancellation/refund policy.',
  'You agree to follow the rules and safety guidelines of the selected turf.',
  'You are responsible for maintaining the security of your account.',
  'Misuse, fraudulent bookings, or inappropriate behavior may result in account suspension or termination.',
];

/**
 * "I agree to the Terms and Conditions." The words "Terms and Conditions" open JusGo's six terms in a pop-up (nobody leaves the form);
 * opening or closing the pop-up never ticks the box.
 */
export function TermsCheckbox({ checked, onChange, error }: { checked: boolean; onChange(v: boolean): void; error?: string }) {
  const id = useId(); const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex cursor-pointer items-start gap-3 py-1">
        <input id={`${id}-box`} type="checkbox" aria-required aria-invalid={!!error} aria-label="I agree to the Terms and Conditions" className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="min-w-0 text-sm">I agree to the <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="font-semibold underline">Terms and Conditions</button>.<span className="ml-0.5 text-danger" aria-hidden="true">*</span></span>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title="Terms and Conditions">
        <ol className="list-decimal space-y-2 pl-5 text-sm [overflow-wrap:anywhere]">{SIGNUP_TERMS.map((t) => <li key={t}>{t}</li>)}</ol>
        <div className="mt-4 flex justify-end"><Button type="button" onClick={() => setOpen(false)}>Done</Button></div>
      </Modal>
    </div>
  );
}
