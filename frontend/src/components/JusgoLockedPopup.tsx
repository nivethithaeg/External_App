import { useEffect, useState } from 'react';
import { Button, Modal } from './ui';

/** The event the API layer sends when the server says a change must be made in JusGo (code "managed_in_jusgo"). */
export const JUSGO_LOCKED_EVENT = 'playnx:managed-in-jusgo';

/**
 * A venue linked with JusGo is changed in JusGo only (JusGo's rule for partner apps): venue details, playing areas, slots, prices and blocked
 * times. Whatever page tries such a change, this pop-up says where to make it instead.
 */
export function JusgoLockedPopup() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(JUSGO_LOCKED_EVENT, show);
    return () => window.removeEventListener(JUSGO_LOCKED_EVENT, show);
  }, []);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Change this in JusGo">
      <div className="space-y-3 text-sm">
        <p>This venue is linked with <b>JusGo</b>. Venue details, playing areas, slots, prices and blocked times can be changed <b>only in the JusGo owner portal</b>, not here.</p>
        <p className="text-muted">Make the change in JusGo. Bookings still come to PlaynX as usual, and a slot booked on JusGo is closed here automatically.</p>
        <div className="flex justify-end"><Button onClick={() => setOpen(false)}>OK</Button></div>
      </div>
    </Modal>
  );
}
