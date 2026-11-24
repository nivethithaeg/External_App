import { Suspense, lazy, useState, type ReactNode } from 'react';
import { Loading, Modal } from './ui';

const TermsPage = lazy(() => import('../pages/customer/InfoPages').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('../pages/customer/InfoPages').then((m) => ({ default: m.PrivacyPage })));
const OwnerAgreementPage = lazy(() => import('../pages/customer/InfoPages').then((m) => ({ default: m.OwnerAgreementPage })));
const DOCS = { terms: { title: 'Terms and conditions', Page: TermsPage }, privacy: { title: 'Privacy policy', Page: PrivacyPage }, 'owner-agreement': { title: 'Venue owner agreement', Page: OwnerAgreementPage } } as const;

/** A link that shows the document right here in a pop-up, so nobody has to leave the form (or open a new tab) to read it. */
export function LegalLink({ doc, children }: { doc: keyof typeof DOCS; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { title, Page } = DOCS[doc];
  return (
    <>
      <button type="button" className="font-semibold underline" onClick={() => setOpen(true)}>{children}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide>
        <div className="max-h-[65vh] overflow-y-auto pr-1">{open && <Suspense fallback={<Loading />}><Page /></Suspense>}</div>
        <div className="mt-4 flex justify-end"><button type="button" className="btn-primary" onClick={() => setOpen(false)}>Done</button></div>
      </Modal>
    </>
  );
}
