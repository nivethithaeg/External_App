import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));
vi.mock('../src/lib/razorpay', () => ({ openCheckout: vi.fn(), isPaymentNotCompleted: (e: any) => e?.name === 'PaymentNotCompleted' }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const OWNER = { id: 'o1', email: 'o@x.co', phone: '+919800000000', fullName: 'Arjun Mehta', role: 'owner', adminRole: null, emailVerified: false, phoneVerified: false };
const ADMIN = { id: 'a1', email: 'admin@x.co', phone: null, fullName: 'Admin', role: 'admin', adminRole: 'super_admin', emailVerified: true, phoneVerified: false };
const REQUIRED = [{ docType: 'pan_card', label: 'PAN card' }, { docType: 'identity_proof', label: 'Identity proof (masked Aadhaar or other ID)' }, { docType: 'address_proof', label: 'Business address proof' }];
const appData = (over: any = {}) => ({
  accountStatus: 'profile_incomplete', application: { reference: null, status: 'incomplete', submittedAt: null, editable: true },
  contact: { email: 'o@x.co', phone: '+919800000000', emailVerified: false, phoneVerified: false, phoneRequired: false, phoneOtpAvailable: false }, owner: { fullName: 'Arjun Mehta' },
  business: { type: null, name: 'Arjun Mehta', hasPan: false, panMasked: null }, identity: { type: null, consentGiven: false }, documents: [], requiredDocs: REQUIRED, venues: [],
  sections: { contact: 'pending', business: 'incomplete', identity: 'incomplete', venue: 'incomplete' }, missing: [{ type: 'contact', key: 'email', message: 'Verify your email address' }], correction: null, events: [], ...over });

let user: any = OWNER; let app: any = appData(); let routes: Record<string, any> = {};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('kickoff_token', 't'); user = OWNER; app = appData(); routes = {};
  vi.mocked(api.post).mockResolvedValue({}); vi.mocked(api.put).mockResolvedValue({});
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url in routes) return routes[url];
    return ({ '/auth/me': { user }, '/owner/application': app, '/me/notifications': { notifications: [], unread: 0 }, '/sports': { sports: [{ id: 1, name: 'Football', slug: 'football' }] }, '/facilities': { facilities: [{ id: 1, name: 'Parking' }] } } as Record<string, any>)[url] ?? {};
  });
});
const renderAt = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);

describe('owner entry points', () => {
  it('the welcome page offers register and login', async () => {
    localStorage.clear(); sessionStorage.clear(); renderAt('/owner/welcome');
    expect(await screen.findByRole('link', { name: /Register as Venue Owner/ })).toHaveAttribute('href', '/owner/register');
    expect(screen.getByRole('link', { name: /Venue Owner Login/ })).toHaveAttribute('href', '/owner/login');
  });

  it('signup validates every field client-side, including matching passwords and a valid mobile number', async () => {
    localStorage.clear(); sessionStorage.clear(); renderAt('/owner/register');
    const name = await screen.findByLabelText('Full name') as HTMLInputElement;
    await userEvent.type(name, 'R2D2');
    expect(name.value).toBe('RD'); expect(screen.getByText(/Only letters, spaces, apostrophes/)).toBeInTheDocument(); // digits are not typed, and the reason shows
    await userEvent.type(screen.getByLabelText('Mobile number'), '123');
    await userEvent.type(screen.getByLabelText('Email address'), 'nope');
    await userEvent.type(screen.getByLabelText('Password'), 'weak');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    for (const m of [/valid 10-digit mobile/, /valid email/, /At least 8 characters/, /do not match/]) expect(await screen.findByText(m)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Step 1 of 4/);
  });

  it('login accepts email or mobile and can show the password', async () => {
    localStorage.clear(); sessionStorage.clear();
    vi.mocked(api.post).mockRejectedValue({ response: { data: { error: { message: 'Incorrect email or password' } } } });
    renderAt('/owner/login');
    await userEvent.type(await screen.findByLabelText('Email or mobile number'), '9876543210');
    const pw = screen.getByLabelText('Password'); await userEvent.type(pw, 'Passw0rd1');
    expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: /Show/ })); expect(pw).toHaveAttribute('type', 'text');
    expect(screen.queryByRole('checkbox', { name: /Remember me/ })).toBeNull(); // closing the browser always signs out
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/login', { email: '9876543210', password: 'Passw0rd1', remember: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
  });

  it('forgot password asks for email or mobile and requires matching new passwords', async () => {
    localStorage.clear(); sessionStorage.clear(); renderAt('/forgot-password');
    await userEvent.type(await screen.findByLabelText('Email or mobile number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: '9876543210' }));
    await userEvent.type(await screen.findByLabelText('6-digit code'), '123456');
    await userEvent.type(screen.getByLabelText('New password'), 'BrandNew123'); await userEvent.type(screen.getByLabelText('Confirm new password'), 'Mismatch123');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('The two passwords do not match')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith('/auth/reset-password', expect.anything());
  });
});

/** What the server does to an owner whose application is not approved: it refuses the add or change. */
const refuseChange = async () => {
  const { api } = await import('../src/lib/api');
  const keep = api.defaults.adapter;
  api.defaults.adapter = async (cfg: any) => { const err: any = new Error('refused'); err.config = cfg; err.response = { status: 403, data: { error: { code: 'owner_not_approved', message: 'Your owner account must be approved by KickOff first.' } }, config: cfg, headers: {} }; throw err; };
  try { await api.post('/owner/venues', { name: 'x' }); } catch { /* the pop-up is the answer */ } finally { api.defaults.adapter = keep; }
};

describe('owner gate and status-based redirection', () => {
  it('lets an owner awaiting approval into the portal, but every click says Waiting for admin approval', async () => {
    app = appData({ accountStatus: 'verification_pending', application: { reference: 'KOA-20301201-A1B2C3', status: 'under_review', submittedAt: '2030-12-01T10:00:00Z', editable: false }, contact: { ...appData().contact, emailVerified: true },
      business: { type: 'sole_proprietorship', name: 'Mehta Sports' }, missing: [], sections: { contact: 'verified', business: 'under_review', identity: 'under_review' },
      events: [{ kind: 'submitted', note: 'Application submitted', created_at: '2030-12-01T10:00:00Z' }] });
    renderAt('/owner');
    expect(await screen.findByRole('heading', { level: 1, name: /^Welcome/ })).toBeInTheDocument();
    expect(screen.getByText(/waiting for admin approval/i)).toBeInTheDocument();
    expect(screen.getByText('KOA-20301201-A1B2C3')).toBeInTheDocument();
    expect(screen.getAllByText('Under review').length).toBeGreaterThanOrEqual(3); // contact is verified; the other sections are under review
    for (const l of ['Contact verification', 'Business verification', 'Identity verification']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(screen.queryByText('Venue verification')).not.toBeInTheDocument(); // venues are added after approval
    expect(screen.getAllByText('Application submitted').length).toBeGreaterThan(0);
    // the menu pages open for looking; the server refuses any add or change, and that shows the popup
    routes['/owner/venues'] = { venues: [] };
    await userEvent.click(screen.getAllByRole('button', { expanded: false })[0]);
    await userEvent.click(await screen.findByRole('link', { name: /My venues/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your venues' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Waiting for admin approval' })).not.toBeInTheDocument(); // opening a page is not blocked
    await refuseChange();
    const dlg = await screen.findByRole('dialog', { name: 'Waiting for admin approval' });
    expect(within(dlg).getByText(/adding or changing anything opens once your application is approved/)).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Waiting for admin approval' })).not.toBeInTheDocument());
    // "Add venue" does not open the venue form at all: the pop-up opens instead and the owner stays on the venues page
    await userEvent.click(screen.getAllByRole('link', { name: /Add venue/ })[0]);
    expect(await screen.findByRole('dialog', { name: 'Waiting for admin approval' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your venues' })).toBeInTheDocument(); expect(screen.queryByLabelText(/Venue name/)).not.toBeInTheDocument();
  });

  it('lets an active owner straight into the dashboard', async () => {
    app = appData({ accountStatus: 'active', application: { reference: 'KOA-1', status: 'approved', editable: false }, missing: [] });
    routes['/owner/overview'] = { counts: { venues: 0, active_venues: 0, areas: 0 }, today: { bookings: 0, revenue: 0 }, month: { bookings: 0, revenue: 0 }, upcoming: 0, awaitingPayment: 0, slots: { total: 0, booked: 0, available: 0, occupancyPct: 0 }, statusBreakdown: [], schedule: [], nextBookings: [], popularAreas: [], recentTransactions: [], venues: [], revenue: { day: [], week: [], month: [], year: [] } };
    renderAt('/owner');
    expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening),/ })).toBeInTheDocument();
  });

  it('shows the exact correction request and lets the owner start fixing it', async () => {
    app = appData({ accountStatus: 'verification_pending', application: { reference: 'KOA-1', status: 'resubmission_required', editable: true }, contact: { ...appData().contact, emailVerified: true }, missing: [],
      business: { type: 'sole_proprietorship', name: 'Mehta Sports', hasPan: true, panMasked: 'AB•••••4F' }, sections: { contact: 'verified', business: 'changes_requested', identity: 'changes_requested' },
      correction: { kind: 'resubmission_requested', note: 'Fix your PAN and address', items: [{ type: 'document', key: 'pan_card', reason: 'PAN image is blurry' }, { type: 'field', key: 'address', reason: 'Add PIN code' }] },
      documents: [{ id: 'd1', docType: 'pan_card', label: 'PAN card', status: 'rejected', note: 'PAN image is blurry' }] });
    renderAt('/owner/application');
    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('Resubmission required')).toBeInTheDocument();
    expect(banner).toHaveTextContent('Fix your PAN and address'); expect(banner).toHaveTextContent('PAN image is blurry'); expect(banner).toHaveTextContent('Add PIN code');
    expect(screen.getAllByText('Changes requested')).toHaveLength(2); // business + identity
    await userEvent.click(screen.getByRole('button', { name: 'Update my application' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Update your application' })).toBeInTheDocument();
  });

  it('shows the rejection reason and no way to edit', async () => {
    app = appData({ accountStatus: 'rejected', application: { reference: 'KOA-9', status: 'rejected', editable: false }, missing: [], events: [{ kind: 'rejected', note: 'PAN does not match the business', created_at: '2030-12-02T10:00:00Z' }] });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Application rejected' })).toBeInTheDocument();
    expect(screen.getByText('PAN does not match the business', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update my application/ })).not.toBeInTheDocument();
  });
});

describe('registration wizard', () => {
  it('step 1: blocks Continue until the email is verified, and sends the OTP', async () => {
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Verify your contact details' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Registration progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText('SMS verification is not available yet')).toBeInTheDocument(); // mobile OTP is optional until an SMS gateway exists
    await userEvent.click(screen.getByRole('button', { name: 'Send email OTP' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/otp/send', { channel: 'email' }));
    await userEvent.type(await screen.findByLabelText('Email code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/otp/verify', { channel: 'email', code: '123456' }));
  });

  it('step 2: fields change with the business type, and invalid PAN / CIN / partner details are rejected before any request', async () => {
    app = appData({ contact: { ...appData().contact, emailVerified: true }, missing: [{ type: 'field', key: 'businessType', message: 'Choose your business type' }] });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Business information' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Business or Trade Name')).not.toBeInTheDocument(); // nothing until a type is chosen
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([expect.stringMatching(/^Individual/), expect.stringMatching(/^Sole Proprietorship/), expect.stringMatching(/^Partnership \/ Private Limited Company/)]);
    await userEvent.click(screen.getByRole('radio', { name: /^Individual/ }));
    expect(screen.getByLabelText('Full Legal Name')).toBeInTheDocument(); expect(screen.getByLabelText('Date of Birth')).toBeInTheDocument(); expect(screen.getByLabelText('Residential Address')).toBeInTheDocument();
    expect(screen.queryByLabelText('Business or Trade Name')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Sole Proprietorship/ }));
    expect(screen.getByLabelText("Proprietor's Full Legal Name")).toBeInTheDocument(); expect(screen.getByLabelText('Business or Trade Name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Udyam \/ MSME Number/)).toBeInTheDocument(); expect(screen.getByLabelText(/GST Number/)).toBeInTheDocument(); expect(screen.queryByLabelText(/CIN/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Partnership \/ Private Limited Company/ }));
    expect(screen.getByLabelText('Registered Business Name')).toBeInTheDocument(); expect(screen.getByLabelText('Business PAN Number')).toBeInTheDocument();
    expect(screen.getByLabelText("Authorized Person's Full Name")).toBeInTheDocument(); expect(screen.getByLabelText("Authorized Person's Phone Number")).toBeInTheDocument();
    expect(screen.getByLabelText('CIN (Private Limited Company only)')).toBeInTheDocument(); expect(screen.getByText(/Partner \/ Director Details/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Registered Business Name'), 'Mehta & Co'); await userEvent.type(screen.getByLabelText('Business PAN Number'), 'BAD'); await userEvent.type(screen.getByLabelText('CIN (Private Limited Company only)'), 'XX');
    await userEvent.type(screen.getByLabelText('Registered Business Address'), '12 Park Road, Bengaluru');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByText(/valid PAN, e.g./)).toBeInTheDocument(); expect(screen.getByText(/valid 21-character CIN/)).toBeInTheDocument();
    expect(screen.getByText('Enter the 12-digit Aadhaar number')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    expect(await screen.findByText('Select the state')).toBeInTheDocument(); expect(screen.getByText(/valid 6-digit PIN/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('State'), 'Karnataka'); await userEvent.selectOptions(screen.getByLabelText('City'), 'Bengaluru'); await userEvent.type(screen.getByLabelText('PIN code'), '560038');
    await userEvent.clear(screen.getByLabelText('Business PAN Number')); await userEvent.type(screen.getByLabelText('Business PAN Number'), 'abcde1234f');
    await userEvent.clear(screen.getByLabelText('CIN (Private Limited Company only)'));
    await userEvent.type(screen.getByLabelText("Authorized Person's Full Name"), ' Arjun Mehta'); await userEvent.type(screen.getByLabelText("Authorized Person's Phone Number"), '9876543210');
    await userEvent.type(screen.getByLabelText('Name'), 'Arjun Mehta'); await userEvent.type(screen.getByLabelText('PAN'), 'abcde1234f'); await userEvent.type(screen.getByLabelText('Aadhaar'), '123456789012'); await userEvent.type(screen.getByLabelText('Contact Number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/application/business', expect.objectContaining({ businessType: 'partnership_pvt_ltd', pan: 'ABCDE1234F', businessName: 'Mehta & Co', state: 'Karnataka', city: 'Bengaluru', partners: [{ name: 'Arjun Mehta', pan: 'ABCDE1234F', aadhaar: '123456789012', phone: '9876543210' }] })));
  });

  it('step 3 (Documents): the Aadhaar card number and one Aadhaar copy, labelled for whose they are, like JusGo', async () => {
    app = appData({ contact: { ...appData().contact, emailVerified: true }, business: { type: 'partnership_pvt_ltd', name: 'Firm', hasPan: true, panMasked: 'AB•••••4F', representativeName: 'Arjun Mehta' },
      requiredDocs: [{ docType: 'identity_proof', label: 'Aadhaar / Government ID copy' }],
      missing: [{ type: 'field', key: 'identity', message: 'Enter the Aadhaar card number' }, { type: 'document', key: 'identity_proof', message: 'Upload: Aadhaar / Government ID copy' }] });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByText(/PDF, JPG, JPEG or PNG, up to 10 MB each/)).toBeInTheDocument();
    expect(screen.getByLabelText("Authorized person's Aadhaar Card Number", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("Upload Authorized person's Aadhaar Card Copy", { exact: false })).toBeInTheDocument();
    expect(screen.queryByLabelText('Identity proof type')).not.toBeInTheDocument(); expect(screen.queryByLabelText(/Upload PAN card/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByText('Enter the 12-digit Aadhaar number')).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Authorized person's Aadhaar Card Number", { exact: false }), '123412341234');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Aadhaar Card Copy is required/); expect(api.put).not.toHaveBeenCalled(); // the copy is still missing
  });

  it('step 5: submit stays disabled until the terms and declaration are accepted, then shows the reference', async () => {
    app = appData({ contact: { ...appData().contact, emailVerified: true }, missing: [], business: { type: 'sole_proprietorship', name: 'Mehta Sports', panMasked: 'AB•••••4F', hasPan: true, address: '12 Park Rd', representativeName: 'Arjun Mehta' },
      identity: { type: 'aadhaar_masked', consentGiven: true, aadhaarMasked: 'XXXXXXXX1234' }, documents: [{ id: 'd1', docType: 'identity_proof', label: 'Aadhaar / Government ID copy', status: 'pending' }] });
    vi.mocked(api.post).mockImplementation(async (url: string) => (url === '/owner/application/submit' ? { reference: 'KOA-20301201-ZZ99AA', message: 'Your KICKOFF Venue Owner application has been submitted successfully. Our verification team will review your information and notify you about the approval status.' } : {}));
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument();
    expect(screen.queryByText('Venue')).not.toBeInTheDocument(); expect(screen.getByText('AB•••••4F')).toBeInTheDocument(); // masked PAN in the summary, no venue block
    const submit = screen.getByRole('button', { name: 'Submit for Verification' }); expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I agree to the Terms and Conditions/ })); expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I confirm that the information and documents/ })); expect(submit).toBeEnabled();
    // the six terms open in a pop-up on this page (not a dropdown, not a new tab) and opening them does not tick the box
    expect(screen.queryByRole('link', { name: 'Terms and Conditions' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Terms and Conditions' }));
    const dlg = await screen.findByRole('dialog', { name: 'Terms and Conditions' });
    expect(within(dlg).getAllByRole('listitem')).toHaveLength(6); expect(within(dlg).getByText('You will provide accurate information.')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Done' }));
    await userEvent.click(submit);
    expect(await screen.findByText('KOA-20301201-ZZ99AA')).toBeInTheDocument();
    expect(screen.getByText(/submitted successfully/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/owner/application/submit', { acceptTerms: true, declaration: true });
  });

  it('has six steps, personal details right after the email check, and never asks for a venue during registration', async () => {
    app = appData({ contact: { ...appData().contact, emailVerified: true }, missing: [] });
    renderAt('/owner/application');
    const steps = await screen.findByRole('list', { name: 'Registration progress' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(6);
    for (const s of ['Verify contact', 'Personal details', 'Account type', 'Documents', 'Self verification', 'Review']) expect(within(steps).getByText(s)).toBeInTheDocument();
    expect(screen.queryByText('Venue')).not.toBeInTheDocument(); expect(screen.queryByRole('heading', { name: /first venue/i })).not.toBeInTheDocument();
  });
});

describe('a step opens only once the earlier steps are filled in', () => {
  const gaps = (over: any = {}) => appData({ contact: { ...appData().contact, emailVerified: true }, business: { type: 'sole_proprietorship', name: 'Mehta Sports', hasPan: true, panMasked: 'AB•••••4F', representativeName: 'Arjun Mehta' }, identity: { type: 'aadhaar_masked', consentGiven: true },
    missing: [{ type: 'field', key: 'address', message: 'Enter the business address' }, { type: 'document', key: 'pan_card', message: 'Upload: PAN card' }], ...over });
  const stepButton = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Registration progress' })).getByRole('button', { name });

  it('stays on the unfinished step and says what is not filled in when someone tries to skip ahead', async () => {
    app = gaps(); renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Business information' })).toBeInTheDocument(); // the first unfinished step
    await userEvent.click(await stepButton(/Review/));
    const msg = await screen.findByRole('alert');
    expect(msg).toHaveTextContent(/You have not filled in the details on Account type yet, so you cannot open Review/);
    expect(msg).toHaveTextContent(/Enter the business address/);
    expect(screen.getByRole('heading', { name: 'Business information' })).toBeInTheDocument(); // still here
    await userEvent.click(await stepButton(/Documents/));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot open Documents/);
  });

  it('details given on Personal details are filled in on later pages and cannot be changed there; the notice leads back to where they were entered', async () => {
    const business = { type: 'individual', name: 'Arjun Mehta', hasPan: true, panMasked: 'AB•••••4F', representativeName: 'Arjun Mehta', dob: '1990-05-01', phone: '+919876543210', address: '12 Park Road', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', country: 'India' };
    app = gaps({ personal: { done: true, passwordSet: true }, business, missing: [{ type: 'document', key: 'pan_card', message: 'Upload: PAN card' }] });
    renderAt('/owner/application');
    await userEvent.click(await stepButton(/Account type/));
    expect(await screen.findByRole('heading', { name: 'Business information' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/already gave in Personal details/);
    for (const l of ['Full Legal Name', 'Date of Birth', 'Residential Address', 'PIN code', 'Phone Number']) expect(screen.getByLabelText(l, { exact: false }), l).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Full Legal Name', { exact: false })).toHaveValue('Arjun Mehta');
    expect(screen.getByLabelText('State')).toBeDisabled(); expect(screen.getByLabelText('City')).toBeDisabled();
    expect(screen.getByLabelText('PAN Number', { exact: false })).not.toHaveAttribute('readonly'); // first entered on this page
    await userEvent.click(screen.getByRole('button', { name: /Edit them in Personal details/ }));
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
    expect(screen.getByLabelText('Legal full name', { exact: false })).not.toHaveAttribute('readonly'); // editable on the page where it was first filled
    await userEvent.click(await stepButton(/Documents/));
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Date of Birth', { exact: false })).not.toBeInTheDocument(); // the Documents page does not ask for them again
  });

  it('the verification photo is mandatory: the step will not continue without it, and Review says Not uploaded with a Take photo button', async () => {
    app = gaps({ missing: [], business: { type: 'individual', name: 'Arjun', hasPan: true, panMasked: 'AB•••••4F', representativeName: 'Arjun Mehta' }, identity: { type: 'aadhaar_masked', aadhaarMasked: 'XXXXXXXX1234' }, documents: [{ id: 'd1', docType: 'identity_proof', label: 'Aadhaar / Government ID copy', status: 'pending' }] });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument();
    expect(screen.getByText('Not uploaded')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    await userEvent.click(await stepButton(/Self verification/));
    expect(await screen.findByRole('heading', { name: 'Self verification' })).toBeInTheDocument();
    expect(screen.queryByText('(optional)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Take your verification photo to continue/);
    expect(screen.getByRole('heading', { name: 'Self verification' })).toBeInTheDocument();
  });

  it('going back to an earlier step is always allowed', async () => {
    app = gaps({ missing: [] }); renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument();
    await userEvent.click(await stepButton(/Account type/));
    expect(await screen.findByRole('heading', { name: 'Business information' })).toBeInTheDocument();
    await userEvent.click(await stepButton(/Review/)); // everything is filled in, so it opens again
    expect(await screen.findByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument();
  });

  it('the personal details page must be filled before the business page opens', async () => {
    app = gaps({ personal: { done: false } }); renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
    await userEvent.click(await stepButton(/Account type/));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not filled in the details on Personal details yet/);
    expect(screen.getByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
  });

  it('an unverified email keeps the owner on the code step: nothing else opens until it is verified', async () => {
    app = gaps({ contact: { ...appData().contact, emailVerified: false }, missing: [{ type: 'contact', key: 'email', message: 'Verify your email address' }] });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Verify your contact details' })).toBeInTheDocument();
    await userEvent.click(await stepButton(/Account type/));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Verify your email address/);
    expect(screen.getByRole('heading', { name: 'Verify your contact details' })).toBeInTheDocument();
    expect(within(document.querySelector('[data-field="email"]') as HTMLElement).getByRole('button', { name: 'Send email OTP' })).toBeInTheDocument();
  });

  it('shows no list and allows submitting once nothing is missing', async () => {
    app = gaps({ missing: [] }); renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Review & Submit' })).toBeInTheDocument();
    expect(screen.queryByText(/missing/)).not.toBeInTheDocument();
  });
});

describe('reasons are shown at the field', () => {
  const businessApp = (over: any = {}) => appData({ contact: { ...appData().contact, emailVerified: true }, business: { type: 'sole_proprietorship', name: 'Mehta Sports', phone: '9876543210', hasPan: true, panMasked: 'AB•••••4F', address: '12 Park Rd', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', representativeName: 'Arjun Mehta' }, missing: [{ type: 'field', key: 'businessName', message: 'x' }], ...over });

  it('shows the reviewer\'s reason under the exact field they flagged', async () => {
    app = businessApp({ application: { reference: 'KOA-1', status: 'resubmission_required', editable: true }, missing: [{ type: 'field', key: 'address', message: 'x' }],
      correction: { kind: 'resubmission_requested', note: 'Please fix', items: [{ type: 'field', key: 'address', reason: 'Add the PIN code' }, { type: 'field', key: 'businessName', reason: 'Use the registered legal name' }] } });
    renderAt('/owner/application');
    await userEvent.click(await screen.findByRole('button', { name: 'Update my application' }));
    expect(await screen.findByRole('heading', { name: 'Business information' })).toBeInTheDocument();
    expect(await screen.findByText('Reviewer: Add the PIN code')).toBeInTheDocument();
    expect(screen.getByText('Reviewer: Use the registered legal name')).toBeInTheDocument();
    expect(screen.queryByText(/Reviewer: .*PAN/)).not.toBeInTheDocument(); // only flagged fields carry a reason
  });

  it('shows the server\'s reason under the field it is about, not as a vague banner', async () => {
    app = businessApp();
    vi.mocked(api.put).mockRejectedValue({ response: { data: { error: { code: 'validation_error', message: 'Invalid input', details: [{ path: 'pan', message: 'Enter a valid PAN, e.g. ABCDE1234F' }] } } } });
    renderAt('/owner/application');
    await screen.findByRole('heading', { name: 'Business information' });
    await userEvent.type(screen.getByLabelText('PAN Number'), 'ABCDE1234F');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    const msg = await screen.findByText('Enter a valid PAN, e.g. ABCDE1234F');
    expect(msg).toHaveAttribute('role', 'alert'); expect(screen.getByLabelText('PAN Number')).toBeInTheDocument();
  });

  it('tells the owner why an OTP failed, right under the contact details', async () => {
    renderAt('/owner/application');
    await userEvent.click(await screen.findByRole('button', { name: 'Send email OTP' }));
    await userEvent.type(await screen.findByLabelText('Email code'), '000000');
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { error: { message: 'Incorrect code' } } } });
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/Email: Incorrect code/)).toBeInTheDocument();
  });

  it('says which signup field clashes when an email is already registered', async () => {
    localStorage.clear(); sessionStorage.clear();
    vi.mocked(api.post).mockRejectedValue({ response: { data: { error: { code: 'email_taken', message: 'An account with this email address already exists. Log in instead.', details: { field: 'email' } } } } });
    renderAt('/owner/register');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Arjun Mehta'); await userEvent.type(screen.getByLabelText('Mobile number'), '+919876543210');
    await userEvent.type(screen.getByLabelText('Email address'), 'taken@x.co'); await userEvent.type(screen.getByLabelText('Password'), 'Passw0rd1'); await userEvent.type(screen.getByLabelText('Confirm password'), 'Passw0rd1');
    await userEvent.click(screen.getByRole('button', { name: /Create account/ }));
    expect(await screen.findByText('An account with this email address already exists. Log in instead.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('admin application review', () => {
  const detail = { owner: { id: 'o1', full_name: 'Arjun Mehta', email: 'o@x.co', phone: '+919800000000', email_verified: true, phone_verified: false, application_status: 'submitted', application_ref: 'KOA-1', business_type: 'sole_proprietorship', business_name: 'Mehta Sports', pan: 'ABCDE1234F', address: '12 Park Rd', identity_type: 'aadhaar_masked', identity_consent_at: '2030-12-01T10:00:00Z', terms_accepted_at: '2030-12-01T10:00:00Z', terms_version: '2026-11' },
    documents: [{ id: 'd1', doc_type: 'pan_card', label: 'PAN card', status: 'pending', created_at: '2030-12-01T10:00:00Z' }], venues: [{ id: 'v1', name: 'Mehta Arena', city: 'Bengaluru', status: 'draft', media: 2, documents: 1 }], events: [{ kind: 'submitted', note: 'Application submitted', created_at: '2030-12-01T10:00:00Z', actor: 'Arjun Mehta' }] };
  beforeEach(() => {
    user = ADMIN;
    routes['/admin/applications'] = { applications: [{ owner_id: 'o1', full_name: 'Arjun Mehta', email: 'o@x.co', phone: null, business_name: 'Mehta Sports', business_type: 'sole_proprietorship', application_ref: 'KOA-1', application_status: 'submitted', submitted_at: '2030-12-01T10:00:00Z', venues: 1, pending_documents: 1 }] };
    routes['/admin/applications/o1'] = detail;
  });

  it('lists applications, shows the full review packet, and sends corrections with reasons', async () => {
    renderAt('/admin/applications');
    expect(await screen.findByRole('heading', { level: 1, name: 'Owner applications' })).toBeInTheDocument();
    await userEvent.click(await screen.findByText('KOA-1'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('ABCDE1234F')).toBeInTheDocument(); expect(within(dlg).getByRole('button', { name: /PAN card/ })).toBeInTheDocument(); // opened through the authenticated viewer, not a link
    expect(within(dlg).getByText(/Mehta Arena/)).toBeInTheDocument(); expect(within(dlg).getByText('Review history')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'PAN card' }));
    await userEvent.type(within(dlg).getByLabelText('Reason for PAN card'), 'Blurry scan');
    await userEvent.type(within(dlg).getByLabelText('Message to the owner'), 'Please fix the PAN');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Request resubmission' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/applications/o1/decision', { action: 'request_resubmission', note: 'Please fix the PAN', items: [{ type: 'document', key: 'pan_card', reason: 'Blurry scan' }] }));
  });

  it('rejecting needs a message and approving is a single click', async () => {
    renderAt('/admin/applications?owner=o1');
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getAllByRole('button', { name: 'Reject' }).at(-1)).toBeDisabled(); // the decision button (document rows have their own)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Approve application' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/applications/o1/decision', { action: 'approve', items: [] }));
  });

  it('the admin sidebar links to owner applications', async () => {
    renderAt('/admin/applications');
    expect(await screen.findByRole('link', { name: /Owner applications/ })).toHaveAttribute('href', '/admin/applications');
  });
});

describe('finding submitted owner documents', () => {
  const owner = { id: 'o1', full_name: 'Nivetha', email: 'n@x.co', phone: null, business_name: 'Nivetha Sports', verification_status: 'pending', application_status: 'submitted', application_ref: 'KOA-1', pending_documents: 4, venues: 0, commission_override: null, created_at: '2030-12-01T10:00:00Z' };
  beforeEach(() => { user = ADMIN; routes['/admin/owners'] = { owners: [owner] }; });

  it('the dashboard alert for owners awaiting review links to Owner applications, not the old page', async () => {
    routes['/admin/dashboard'] = { totals: { customers: 0, owners: 1, venues: 0, bookings: 0 }, revenue: { gmv: 0, commission: 0, gmv_month: 0, commission_month: 0 }, trend: [], pendingVenues: 0, pendingOwners: 1, openTickets: 0, topVenues: [], bookingsBySport: [] };
    renderAt('/admin');
    const link = await screen.findByRole('link', { name: /owner applications? to review/ });
    expect(link).toHaveAttribute('href', '/admin/applications');
    expect(link).toHaveTextContent(/1 owner application to review/);
  });

  it('the Turf owners list shows the application status and how many documents await review', async () => {
    renderAt('/admin/owners');
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('4 documents to review')).toBeInTheDocument();
  });

  it('opening such an owner points to the document review and turns off the one-click verify that would skip it', async () => {
    renderAt('/admin/owners');
    await userEvent.click(await screen.findByText('Nivetha Sports'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('link', { name: /Review application & documents/ })).toHaveAttribute('href', '/admin/applications?owner=o1');
    expect(within(dlg).queryByRole('button', { name: 'Verify owner' })).not.toBeInTheDocument();
  });
});

describe('navigation to Owner applications', () => {
  beforeEach(() => {
    user = ADMIN;
    routes['/admin/dashboard'] = { totals: { customers: 0, owners: 1, venues: 0, bookings: 0 }, revenue: { gmv: 0, commission: 0, gmv_month: 0, commission_month: 0 }, trend: [], pendingVenues: 0, pendingOwners: 1, openTickets: 0, topVenues: [], bookingsBySport: [] };
    routes['/admin/applications'] = { applications: [] };
  });
  it('clicking the owner applications alert on the dashboard lands on the Owner applications page (not a 404)', async () => {
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('link', { name: /owner applications? to review/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Owner applications' })).toBeInTheDocument();
    expect(screen.queryByText(/out of bounds/)).not.toBeInTheDocument();
  });
  it('the sidebar link and a full page load of the URL both work too', async () => {
    routes['/admin/venues'] = { venues: [] };
    renderAt('/admin/venues');
    await userEvent.click(await screen.findByRole('link', { name: /Owner applications/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Owner applications' })).toBeInTheDocument();
  });
});

describe('unexpected responses never blank the screen', () => {
  it('a page that receives data it cannot show displays a message and a reload button instead of a blank page', async () => {
    user = ADMIN; routes['/admin/venues'] = {}; // malformed: no venues array
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt('/admin/venues');
    expect(await screen.findByRole('heading', { name: "This page couldn't be shown" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    spy.mockRestore();
  });
  it('an unexpected HTTP error says what failed instead of just a status code', async () => {
    const { apiError } = await import('../src/lib/api');
    expect(apiError({ config: { method: 'get', url: '/admin/applications' }, response: { status: 404, statusText: 'Not Found', data: '<html>' } })).toContain('answered 404 Not Found for GET /admin/applications');
    expect(apiError({ response: { status: 400, data: { error: { message: 'PAN is wrong' } } } })).toBe('PAN is wrong'); // our own messages still win
  });
});

describe('section verification', () => {
  const reviewed = (over: any = {}) => ({ owner: { id: 'o1', full_name: 'Nivetha', email: 'n@x.co', phone: null, email_verified: true, phone_verified: false, application_status: 'under_review', application_ref: 'KOA-1', business_type: 'sole_proprietorship', business_name: 'Nivetha Sports', pan: 'ABCDE1234F', address: '12 Park Rd', business_verified_at: null, identity_verified_at: null, ...over },
    documents: [{ id: 'd1', doc_type: 'pan_card', label: 'PAN card', status: 'approved', created_at: '2030-12-01T10:00:00Z' }, { id: 'd2', doc_type: 'identity_proof', label: 'Identity proof', status: 'approved', created_at: '2030-12-01T10:00:00Z' }], venues: [], events: [] });
  beforeEach(() => { user = ADMIN; routes['/admin/applications'] = { applications: [] }; });

  it('approving one document shows loading on that button only; the other buttons stay as they are', async () => {
    routes['/admin/applications/o1'] = { ...reviewed(), documents: [
      { id: 'd1', doc_type: 'pan_card', label: 'PAN card', status: 'pending', created_at: '2030-12-01T10:00:00Z' },
      { id: 'd2', doc_type: 'identity_proof', label: 'Identity proof', status: 'pending', created_at: '2030-12-01T10:00:00Z' }] };
    vi.mocked(api.patch).mockImplementation(() => new Promise(() => undefined)); // stays in flight
    renderAt('/admin/applications?owner=o1');
    const dlg = await screen.findByRole('dialog');
    const approveBtns = await within(dlg).findAllByRole('button', { name: 'Approve' });
    expect(approveBtns).toHaveLength(2);
    await userEvent.click(approveBtns[0]);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/owner-documents/d1', { status: 'approved', note: undefined }));
    await waitFor(() => expect(within(approveBtns[0]).getByRole('status')).toBeInTheDocument()); // the clicked one spins
    expect(within(approveBtns[1]).queryByRole('status')).not.toBeInTheDocument(); // the other document's Approve does not
    for (const r of within(dlg).getAllByRole('button', { name: 'Reject' })) expect(within(r).queryByRole('status')).not.toBeInTheDocument();
    expect(within(dlg).queryAllByRole('status').filter((x) => dlg.contains(x) && x.getAttribute('aria-label') === 'Loading')).toHaveLength(1);
  });

  it('shows a verify button for Business and Identity and tells the admin when all documents are approved', async () => {
    routes['/admin/applications/o1'] = reviewed();
    renderAt('/admin/applications?owner=o1');
    const dlg = await screen.findByRole('dialog');
    const panel = within(dlg).getByLabelText('Verification status');
    expect(within(panel).getByRole('status')).toHaveTextContent(/All documents are approved/);
    expect(within(panel).getAllByText('Not verified yet')).toHaveLength(2);
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark identity verification' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/applications/o1/sections', { section: 'identity', verified: true }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark business verification' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/applications/o1/sections', { section: 'business', verified: true }));
  });

  it('a verified section can be withdrawn, and the hint disappears once both are verified', async () => {
    routes['/admin/applications/o1'] = reviewed({ business_verified_at: '2030-12-02T10:00:00Z', identity_verified_at: '2030-12-02T10:00:00Z' });
    renderAt('/admin/applications?owner=o1');
    const panel = within(await screen.findByRole('dialog')).getByLabelText('Verification status');
    expect(within(panel).queryByRole('status')).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Withdraw business verification' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/applications/o1/sections', { section: 'business', verified: false }));
  });

  it('shows the server\'s reason when a section cannot be verified yet', async () => {
    routes['/admin/applications/o1'] = reviewed();
    vi.mocked(api.post).mockRejectedValue({ response: { data: { error: { code: 'section_not_ready', message: "Can't verify identity yet: PAN card is pending. Approve it first" } } } });
    renderAt('/admin/applications?owner=o1');
    const panel = within(await screen.findByRole('dialog')).getByLabelText('Verification status');
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark identity verification' }));
    expect(await screen.findByText(/PAN card is pending/)).toBeInTheDocument();
  });

  it('the owner\'s status cards turn to Verified as each section is verified', async () => {
    user = OWNER;
    app = appData({ accountStatus: 'verification_pending', application: { reference: 'KOA-1', status: 'under_review', editable: false }, contact: { ...appData().contact, emailVerified: true }, missing: [],
      sections: { contact: 'verified', business: 'under_review', identity: 'verified' } });
    renderAt('/owner/application');
    const identity = (await screen.findByText('Identity verification')).closest('div')!;
    expect(within(identity).getByText('Verified')).toBeInTheDocument();
    const business = screen.getByText('Business verification').closest('div')!;
    expect(within(business).getByText('Under review')).toBeInTheDocument();
  });
});

describe('state → city dropdowns and required markers', () => {
  const onBusiness = (business: any = {}) => { app = appData({ contact: { ...appData().contact, emailVerified: true }, business: { type: 'sole_proprietorship', name: 'Mehta Sports', hasPan: true, panMasked: 'AB•••••4F', representativeName: 'Arjun Mehta', ...business }, missing: [{ type: 'field', key: 'state', message: 'x' }] }); renderAt('/owner/application'); };
  const cityOptions = () => within(screen.getByLabelText('City')).getAllByRole('option').map((o) => o.textContent);

  it('asks for the state first; the city list is empty until a state is chosen', async () => {
    onBusiness();
    const state = await screen.findByLabelText('State'); const city = screen.getByLabelText('City');
    const order = [state, city].map((el) => el.compareDocumentPosition(state));
    expect(order[1] & Node.DOCUMENT_POSITION_FOLLOWING || order[0] === 0).toBeTruthy(); // State comes before City in the page
    expect(city).toBeDisabled(); expect(cityOptions()).toEqual(['Select a state first']);
    expect(within(state).getAllByRole('option').length).toBeGreaterThan(30); // all states and union territories
  });

  it('shows only the cities of the selected state and clears the city when the state changes', async () => {
    onBusiness();
    await userEvent.selectOptions(await screen.findByLabelText('State'), 'Karnataka');
    expect(screen.getByLabelText('City')).toBeEnabled();
    expect(cityOptions()).toEqual(expect.arrayContaining(['Select city', 'Bengaluru', 'Mysuru', 'Mangaluru', 'Other (not listed)']));
    expect(cityOptions()).not.toContain('Mumbai');
    await userEvent.selectOptions(screen.getByLabelText('City'), 'Mysuru');
    expect(screen.getByLabelText('City')).toHaveValue('Mysuru');
    await userEvent.selectOptions(screen.getByLabelText('State'), 'Maharashtra');
    expect(screen.getByLabelText('City')).toHaveValue(''); // stale city from the old state is gone
    expect(cityOptions()).toEqual(expect.arrayContaining(['Mumbai', 'Pune'])); expect(cityOptions()).not.toContain('Bengaluru');
  });

  it('lets someone type a city that is not in the list', async () => {
    onBusiness();
    await userEvent.selectOptions(await screen.findByLabelText('State'), 'Goa');
    expect(screen.queryByLabelText('Your city')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('City'), 'Other (not listed)');
    await userEvent.type(await screen.findByLabelText('Your city'), 'Canacona');
    expect(screen.getByLabelText('Your city')).toHaveValue('Canacona');
  });

  it('opens with the saved state and city selected, including a saved city that is not in the list', async () => {
    onBusiness({ state: 'Tamil Nadu', city: 'Coimbatore', pincode: '641001' });
    expect(await screen.findByLabelText('State')).toHaveValue('Tamil Nadu'); expect(screen.getByLabelText('City')).toHaveValue('Coimbatore'); expect(screen.getByLabelText('PIN code')).toHaveValue('641001');
  });

  it('blocks saving without a state or city and tells you which one', async () => {
    onBusiness({ address: '12 Park Rd' });
    await userEvent.click(await screen.findByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByText('Select the state')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('State'), 'Kerala');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByText('Select the city')).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
  });

  it('marks required fields with a red * and leaves optional ones plain', async () => {
    onBusiness();
    const star = "after:content-['*']";
    for (const l of ['State', 'City', 'PIN code', 'Business or Trade Name', 'PAN Number', "Proprietor's Full Legal Name", 'Residential or Registered Business Address', 'Phone Number']) expect(await screen.findByText(l), l).toHaveClass(star);
    expect(screen.getByText('GST Number (optional)')).not.toHaveClass(star);
    expect(screen.getByLabelText('PAN Number')).toHaveAttribute('aria-required', 'true'); // assistive tech is told too, not just sighted users
    expect(screen.getByText('Select your account type')).toHaveClass(star);
    expect(screen.getByText(/Fields marked/)).toBeInTheDocument();
  });

  it('marks the signup and login fields', async () => {
    localStorage.clear(); sessionStorage.clear(); renderAt('/owner/register');
    const star = "after:content-['*']";
    for (const l of ['Full name', 'Mobile number', 'Email address', 'Password', 'Confirm password']) expect(await screen.findByText(l), l).toHaveClass(star);
  });
});

describe('personal details step', () => {
  const personalApp = (over: any = {}) => appData({ contact: { ...appData().contact, emailVerified: true }, personal: { done: false }, missing: [], ...over });
  it('opens right after the email is verified, starts from what we know, and the next steps pick up the answers', async () => {
    app = personalApp(); vi.mocked(api.put).mockResolvedValue({ saved: true });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
    expect((screen.getByLabelText('Legal full name') as HTMLInputElement).value).toBe('Arjun Mehta'); // from the account
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('+919800000000');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByText('Enter your date of birth')).toBeInTheDocument(); expect(screen.getByText('Enter the address')).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Date of birth/), { target: { value: '1990-05-17' } });
    await userEvent.type(screen.getByLabelText(/^Address line 1/), '12 Park Road, Indiranagar');
    await userEvent.selectOptions(screen.getByLabelText('State'), 'Karnataka'); await userEvent.selectOptions(screen.getByLabelText('City'), 'Bengaluru');
    await userEvent.type(screen.getByLabelText('PIN code'), '560038');
    // saving moves on to the business step, which now shows the saved answers
    app = personalApp({ personal: { done: true }, business: { type: null, name: 'Arjun Mehta', hasPan: false, panMasked: null, representativeName: 'Arjun Mehta', dob: '1990-05-17', phone: '+919800000000', address: '12 Park Road, Indiranagar', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', country: 'India' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/application/personal', expect.objectContaining({ legalName: 'Arjun Mehta', dob: '1990-05-17', addressLine1: '12 Park Road, Indiranagar', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', country: 'India' })));
    expect(await screen.findByRole('heading', { name: 'Business information' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /^Individual/ }));
    expect((screen.getByLabelText('Full Legal Name') as HTMLInputElement).value).toBe('Arjun Mehta');
    expect((screen.getByLabelText('Date of Birth') as HTMLInputElement).value).toBe('1990-05-17');
    expect((screen.getByLabelText('Residential Address') as HTMLTextAreaElement).value).toBe('12 Park Road, Indiranagar');
    expect((screen.getByLabelText('Phone Number') as HTMLInputElement).value).toBe('+919800000000');
  });
});

describe('the portal beside the application status', () => {
  const sent = (status: string, accountStatus = 'verification_pending') => appData({ accountStatus, application: { reference: 'KOA-1', status, submittedAt: '2030-12-01T10:00:00Z', editable: status !== 'under_review' && status !== 'submitted' }, contact: { ...appData().contact, emailVerified: true }, personal: { done: true }, missing: [],
    business: { type: 'sole_proprietorship', name: 'Mehta Sports' }, sections: { contact: 'verified', business: 'under_review', identity: 'under_review' }, events: [] });

  it.each([
    ['submitted', 'Waiting for admin approval', /waiting for admin approval/i],
    ['under_review', 'Waiting for admin approval', /waiting for admin approval/i],
    ['info_required', 'Update your application first', /asked for changes/i],
    ['resubmission_required', 'Update your application first', /asked for changes/i],
    ['rejected', 'Application not approved', /was not approved/i],
  ])('%s: the owner sees the status and the whole menu, and an add or change explains why it is closed', async (status, title, home) => {
    app = sent(status, status === 'rejected' ? 'rejected' : 'verification_pending');
    renderAt('/owner');
    expect(await screen.findByRole('heading', { level: 1, name: /^Welcome/ })).toBeInTheDocument();
    expect(screen.getByText(home)).toBeInTheDocument(); // the status text sits at the top of the portal home
    expect(screen.getByText('KOA-1')).toBeInTheDocument(); // and the application tracking is on the same page
    await refuseChange();
    expect(await screen.findByRole('dialog', { name: title })).toBeInTheDocument();
  });

  it('a submitted-but-unverified-mobile account is not sent back to the form either', async () => {
    app = sent('under_review', 'contact_verification_pending');
    renderAt('/owner');
    expect(await screen.findByRole('heading', { level: 1, name: /^Welcome/ })).toBeInTheDocument();
  });

  it('the application status page is the portal home: opening /owner/application shows the status with the menu beside it', async () => {
    app = sent('under_review');
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { level: 1, name: /^Welcome/ })).toBeInTheDocument();
    expect(screen.getByText('KOA-1')).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: /Turf Owner Portal navigation/i })[0]).toBeInTheDocument(); // the menu is there
  });
});

describe('Google accounts create a password in personal details', () => {
  it('asks for a password and its confirmation first; a form-made account is not asked', async () => {
    app = appData({ contact: { ...appData().contact, emailVerified: true }, personal: { done: false, passwordSet: false }, missing: [] });
    vi.mocked(api.put).mockResolvedValue({ saved: true }); vi.mocked(api.post).mockResolvedValue({ passwordSet: true });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
    expect(screen.getByText(/You signed up with Google/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByText(/Use at least 8 characters/)).toBeInTheDocument(); expect(screen.getByText('Confirm your password')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/^Password/), 'Passw0rdNew1'); await userEvent.type(screen.getByLabelText(/^Confirm password/), 'Different1');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/^Confirm password/)); await userEvent.type(screen.getByLabelText(/^Confirm password/), 'Passw0rdNew1');
    fireEvent.change(screen.getByLabelText(/^Date of birth/), { target: { value: '1990-05-17' } });
    await userEvent.type(screen.getByLabelText(/^Address line 1/), '12 Park Road, Indiranagar');
    await userEvent.selectOptions(screen.getByLabelText('State'), 'Karnataka'); await userEvent.selectOptions(screen.getByLabelText('City'), 'Bengaluru');
    await userEvent.type(screen.getByLabelText('PIN code'), '560038');
    await userEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/set-password', { newPassword: 'Passw0rdNew1', confirmPassword: 'Passw0rdNew1' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/application/personal', expect.objectContaining({ legalName: 'Arjun Mehta' })));
  });
  it('an account that already has a password is not asked for one', async () => {
    app = appData({ contact: { ...appData().contact, emailVerified: true }, personal: { done: false, passwordSet: true }, missing: [] });
    renderAt('/owner/application');
    expect(await screen.findByRole('heading', { name: 'Personal details' })).toBeInTheDocument();
    expect(screen.queryByText(/You signed up with Google/)).not.toBeInTheDocument();
  });
});

describe('the bank account pop-up after approval', () => {
  const approved = () => appData({ accountStatus: 'active', application: { reference: 'KOA-1', status: 'approved', editable: false }, contact: { ...appData().contact, emailVerified: true }, missing: [] });
  it('cannot be skipped: no close button, and the form saves the account, then the portal is open', async () => {
    app = approved(); routes['/owner/bank'] = { accountName: null, accountNumber: null, ifsc: null, upi: null, verified: false };
    routes['/owner/customers'] = { customers: [], summary: { customers: 0, repeat: 0, bookings: 0, cancellations: 0 } };
    vi.mocked(api.put).mockImplementation((async () => { routes['/owner/bank'] = { accountName: 'Mehta Sports', accountNumber: '••••••••9012', ifsc: 'HDFC0001234', upi: null, verified: false }; return { profile: {} }; }) as any);
    renderAt('/owner/customers');
    const dlg = await screen.findByRole('dialog', { name: 'Add your bank account details' });
    expect(within(dlg).getByText(/You need to do this to use the portal/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Add your bank account details' })).toBeInTheDocument(); // Escape does not skip it
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save bank details and continue' }));
    expect(await within(dlg).findByText("Enter the account holder's name")).toBeInTheDocument(); expect(within(dlg).getByText(/Enter the account number/)).toBeInTheDocument();
    expect(within(dlg).getByText(/valid IFSC code/)).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
    await userEvent.type(within(dlg).getByLabelText(/^Account holder name/), 'Mehta Sports'); await userEvent.type(within(dlg).getByLabelText(/^Account number/), '123456789012'); await userEvent.type(within(dlg).getByLabelText(/^IFSC code/), 'hdfc0001234');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save bank details and continue' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/owner/profile', { bankAccountName: 'Mehta Sports', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add your bank account details' })).not.toBeInTheDocument());
  });
  it('does not appear once a bank account is saved', async () => {
    app = approved(); routes['/owner/bank'] = { accountName: 'Mehta Sports', accountNumber: '••••••••9012', ifsc: 'HDFC0001234', upi: null, verified: true };
    routes['/owner/customers'] = { customers: [], summary: { customers: 0, repeat: 0, bookings: 0, cancellations: 0 } };
    renderAt('/owner/customers');
    await screen.findByRole('navigation', { name: /Turf Owner Portal navigation/i });
    expect(screen.queryByRole('dialog', { name: 'Add your bank account details' })).not.toBeInTheDocument();
  });
});
