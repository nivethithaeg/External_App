import { useState, type ReactNode } from 'react';
import { Button, Modal } from './ui';

/**
 * Asks "Log out?" before signing the customer or owner out, so a stray click never ends the session.
 * `ask()` opens the dialog; `dialog` must be rendered once by the caller.
 */
export function useLogoutConfirm(onConfirm: () => void, who: 'customer' | 'owner' = 'customer'): { ask(): void; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const dialog = (
    <Modal open={open} onClose={() => setOpen(false)} title="Log out?">
      <p className="text-sm text-muted">{who === 'owner' ? 'You will need to sign in again to manage your venues, bookings and payments.' : 'You will need to sign in again to book turfs or see your bookings.'}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" autoFocus onClick={() => setOpen(false)}>Stay logged in</Button>
        <Button variant="danger" onClick={() => { setOpen(false); onConfirm(); }}>Log out</Button>
      </div>
    </Modal>);
  return { ask: () => setOpen(true), dialog };
}
