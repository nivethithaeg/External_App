import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FAQS } from './Landing';

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;

function Page({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-5xl font-extrabold uppercase">{title}</h1>
      {updated && <p className="mt-1 text-xs text-muted">Last updated {updated}</p>}
      <div className="mt-6 space-y-5 text-sm leading-relaxed text-muted [&_h2]:mb-1 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_a]:text-ink [&_a]:underline">{children}</div>
    </article>
  );
}

export const AboutPage = () => (
  <Page title="About KickOff">
    <p>KickOff is an online sports turf booking platform. Players discover venues, compare prices, check live slot availability and book and pay online. Turf owners list their venues and manage pricing, availability and bookings in one place.</p>
    <h2>For players</h2><p>Search by city or area, filter by sport, price and rating, pick a slot, pay securely and show your booking reference at the venue. <Link to="/venues">Browse turfs</Link>.</p>
    <h2>For turf owners</h2><p>Register your venue, add photos, pricing and operating hours, and manage bookings and earnings. Every venue is reviewed by our team before it goes live. <Link to="/owner/register">Register your turf</Link>.</p>
  </Page>
);

export const ContactPage = () => (
  <Page title="Contact us">
    <p>Need help with a booking, payment or refund?</p>
    <ul><li>Players and owners: <Link to="/support">log in and create a support ticket</Link>. Our team replies in the ticket and by email.</li>
      {SUPPORT_EMAIL && <li>Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></li>}</ul>
    <p>Please include your booking reference (it starts with KO-) so we can help faster.</p>
  </Page>
);

export const HelpPage = () => (
  <Page title="Help centre">
    <p>Answers to common questions. Still stuck? <Link to="/contact">Contact us</Link>.</p>
    <div className="space-y-4">{FAQS.map(([q, a]) => <div key={q} className="card p-4"><h2 className="!mt-0 text-xl">{q}</h2><p>{a}</p></div>)}</div>
  </Page>
);

export const CancellationPage = () => (
  <Page title="Cancellation policy">
    <h2>Cancelling a booking</h2>
    <ul><li>Each venue sets a free-cancellation window (for example, 24 hours before the start time). You can see it before you pay.</li>
      <li>Cancel <b>before</b> the window starts and you get a <b>full refund</b>.</li>
      <li>Cancel <b>inside</b> the window and the booking is <b>not refundable</b>.</li>
      <li>Bookings that have already started cannot be cancelled.</li></ul>
    <h2>If the venue cancels</h2><p>If an owner or KickOff cancels your booking, you are always refunded in full.</p>
    <h2>Unpaid bookings</h2><p>A slot is held for a short time while you pay. If payment is not completed, the hold expires and the slot is released. If a payment arrives after the hold expired and the slot has been taken, it is refunded automatically.</p>
    <h2>Refunds</h2><p>Refunds go back to your original payment method through Razorpay and usually arrive in 5–7 working days. You can follow the status on your booking page under “Refund tracking”.</p>
  </Page>
);

export const TermsPage = () => (
  <Page title="Terms and conditions">
    <h2>Using KickOff</h2><p>KickOff lets players book time at sports venues listed by independent turf owners. By creating an account you agree to provide accurate details and keep your login secure.</p>
    <h2>Bookings and payments</h2><p>A booking is confirmed only after payment is verified. Prices shown include the amount payable for the selected slot. Each venue's rules and cancellation window apply; see the <Link to="/cancellation-policy">Cancellation Policy</Link>.</p>
    <h2>Conduct</h2><p>Use venues responsibly and follow the venue's rules. We may suspend accounts that misuse the platform, make fraudulent bookings or post abusive reviews.</p>
    <h2>Venues</h2><p>Venues are operated by their owners. KickOff verifies listings but is not responsible for the condition of a venue or for injuries occurring on site.</p>
    <h2>Changes</h2><p>We may update these terms. Continued use after an update means you accept the new terms.</p>
  </Page>
);

export const PrivacyPage = () => (
  <Page title="Privacy policy">
    <h2>What we collect</h2><ul><li>Account details: name, email, optional mobile number, and a hashed password (or Google sign-in identity).</li><li>Booking and payment records, and reviews you write.</li><li>Your location only if you choose “near me”, and only for that search.</li></ul>
    <h2>How we use it</h2><p>To run your account and bookings, send confirmations and verification codes, process payments and refunds, prevent fraud, and provide support. We do not sell your personal data.</p>
    <h2>Who sees it</h2><ul><li>Turf owners see the name and contact details of customers who book their venue.</li><li>Reviews show only your first name and last initial.</li><li>Payments are processed by Razorpay; we do not store card details.</li><li>Our infrastructure providers (database, storage, email) process data on our behalf.</li></ul>
    <h2>Your choices</h2><p>You can update your details in your profile. To request deletion of your account and personal data, sign in and choose <b>Request account deletion</b> in <Link to="/settings">Settings</Link> (or <Link to="/contact">contact us</Link>). We confirm by email, then delete or anonymise your data; records we must keep by law, such as payment and tax records, are kept for the required period.</p>
    <p>See also our <Link to="/cookies">Cookie policy</Link>.</p>
  </Page>
);

export const OwnerAgreementPage = () => (
  <Page title="Venue owner agreement">
    <p>This agreement applies to venue owners who list sports venues on KickOff.</p>
    <h2>Your listing</h2><p>You confirm that you own, lease or are authorised to operate each venue you list, that the information and documents you submit are accurate, and that you will keep them up to date. KickOff verifies owners and venues before they go live and may request corrections or reject an application.</p>
    <h2>Bookings and cancellations</h2><p>You agree to honour confirmed bookings, to keep your availability and pricing accurate, and to follow the cancellation window you set. If you cancel a confirmed booking, the customer is refunded in full.</p>
    <h2>Fees and settlements</h2><p>KickOff charges a commission on each booking, shown in your earnings. Settlements are paid to a bank account verified by KickOff, for completed bookings.</p>
    <h2>Verification and data</h2><p>You consent to KickOff verifying your identity and business documents. Documents are stored privately and reviewed only by authorised staff, as described in the <Link to="/privacy">Privacy Policy</Link>.</p>
    <h2>Suspension</h2><p>KickOff may suspend an account or venue for inaccurate information, misuse of the platform or repeated customer complaints.</p>
  </Page>
);

export const CookiePage = () => (
  <Page title="Cookie policy">
    <p>KickOff does not use advertising or tracking cookies, and we do not run third-party analytics. The few things we store on your device are there to make the site work.</p>
    <h2>What we store on your device</h2>
    <ul>
      <li><b>Your login</b>: a secure sign-in token, so you stay signed in. It is removed when you log out.</li>
      <li><b>Your preferences</b>: light or dark theme, the sports you like, and for owners and admins whether the sidebar is collapsed.</li>
      <li><b>Your convenience</b>: venues you viewed recently, and a booking you were in the middle of (kept for a short while, in your browser only) so you can pick up where you left off.</li>
    </ul>
    <h2>Third parties that may set their own cookies</h2>
    <ul>
      <li><b>Razorpay</b> loads when you pay, and handles your card or UPI details. We never see or store them.</li>
      <li><b>Google</b> if you choose Google sign-in, and for the fonts we display.</li>
    </ul>
    <h2>Your choices</h2>
    <p>You can clear this storage any time in your browser settings; you will simply be signed out. Blocking it completely will stop sign-in and booking from working. To delete your account and data, see our <Link to="/privacy">Privacy policy</Link>.</p>
  </Page>
);
