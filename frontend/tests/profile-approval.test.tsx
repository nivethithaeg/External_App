import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../src/lib/api', async (orig) => {
  const real: any = await orig();
  return { ...real, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('../src/lib/socket', () => ({ useVenueRealtime: () => {}, useNotificationSocket: () => {}, getSocket: () => ({}) }));

import * as api from '../src/lib/api';
import { AuthProvider } from '../src/lib/auth';
import { ToastProvider } from '../src/lib/toast';
import App from '../src/App';

const OWNER = { id: 'o1', email: 'o@x.co', phone: null, fullName: 'Arjun Mehta', role: 'owner', adminRole: null, emailVerified: true, phoneVerified: false };
const ADMIN = { id: 'a1', email: 'admin@x.co', phone: null, fullName: 'Platform Admin', role: 'admin', adminRole: 'super_admin', emailVerified: true, phoneVerified: false };
const ACTIVE = { accountStatus: 'active', application: { status: 'approved', editable: false }, contact: { emailVerified: true }, business: {}, identity: {}, documents: [], requiredDocs: [], venues: [], sections: {}, missing: [], correction: null, events: [] };
const PROFILE = { business_name: 'Mehta Sports', gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', address: '12 Park Road', verification_status: 'verified', bank_account_name: 'Mehta', bank_account_number: '••••••••9012', bank_ifsc: 'HDFC0001234', upi_id: null, bank_verified: true };
const CHANGE = { id: 'c1', status: 'pending', requested_at: '2030-01-01T05:00:00Z', owner_id: 'o1', full_name: 'Arjun Mehta', email: 'o@x.co', phone: null, businessName: 'Mehta Sports',
  changes: [{ field: 'business_name', label: 'Business name', current: 'Mehta Sports', proposed: 'Mehta Sports Pvt Ltd' }, { field: 'bank_account_number', label: 'Account number', current: '••••••••9012', proposed: '••••••••3456' }] };

let me: any = OWNER; let profileData: any; let adminChanges: any[];
const calls: [string, string, any?][] = [];
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.setItem('kickoff_token', 't'); calls.length = 0; me = OWNER; adminChanges = [CHANGE];
  profileData = { user: OWNER, profile: PROFILE, pendingChange: null, lastDecision: null };
  vi.mocked(api.get).mockImplementation(async (url: string) => ({
    '/auth/me': { user: me }, '/owner/application': ACTIVE, '/me/notifications': { notifications: [], unread: 0 }, '/me/profile': profileData, '/owner/venues': { venues: [] },
    '/admin/profile-changes': { changes: adminChanges }, '/admin/dashboard': {}, '/owner/documents': { documents: [] }, '/sports': { sports: [] },
  } as Record<string, any>)[url] ?? {});
  vi.mocked(api.put).mockImplementation((async (url: string, body: any) => { calls.push(['PUT', url, body]); return { pending: true, profile: PROFILE }; }) as any);
  vi.mocked(api.post).mockImplementation((async (url: string, body: any) => { calls.push(['POST', url, body]); return {}; }) as any);
  vi.mocked(api.del).mockImplementation((async (url: string) => { calls.push(['DELETE', url]); return {}; }) as any);
});
const open = (path: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></ToastProvider></QueryClientProvider>);

describe('owner: editing business and bank details', () => {
  it('says the change goes to KickOff for approval and that the current details stay live', async () => {
    open('/owner/account/business');
    expect(await screen.findByText(/take effect only after an admin approves them/)).toBeInTheDocument();
    await userEvent.clear(await screen.findByLabelText(/Business legal name/)); await userEvent.type(screen.getByLabelText(/Business legal name/), 'Mehta Sports Pvt Ltd');
    await userEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() => expect(calls[0]).toEqual(['PUT', '/owner/profile', expect.objectContaining({ businessName: 'Mehta Sports Pvt Ltd' })]));
    expect(await screen.findByText(/Sent to KickOff for approval/)).toBeInTheDocument();
  });

  it('shows what is waiting (old value struck out, new value beside it) and lets the owner withdraw it', async () => {
    profileData = { ...profileData, pendingChange: { id: 'c1', requestedAt: '2030-01-01T05:00:00Z', changes: CHANGE.changes } };
    open('/owner/account/business');
    expect(await screen.findByText(/Waiting for KickOff approval/)).toBeInTheDocument();
    const note = screen.getByText(/Waiting for KickOff approval/).closest('div')!;
    expect(note).toHaveTextContent('Business name'); expect(note).toHaveTextContent('Mehta Sports Pvt Ltd');
    expect(note).not.toHaveTextContent('Account number'); // bank changes are listed on the bank page, not here
    expect(screen.getByLabelText(/Business legal name/)).toHaveValue('Mehta Sports'); // the form still shows the live value
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(calls).toContainEqual(['DELETE', '/owner/profile/change']));
  });

  it('shows the pending bank change on the bank page only, with the number masked', async () => {
    profileData = { ...profileData, pendingChange: { id: 'c1', requestedAt: '2030-01-01T05:00:00Z', changes: CHANGE.changes } };
    open('/owner/account/bank');
    expect(await screen.findByText(/Waiting for KickOff approval/)).toBeInTheDocument();
    const note = screen.getByText(/Waiting for KickOff approval/).closest('div')!;
    expect(note).toHaveTextContent('••••••••3456'); expect(note).not.toHaveTextContent('Business name');
  });

  it('explains a rejection with the admin\'s reason', async () => {
    profileData = { ...profileData, lastDecision: { status: 'rejected', note: 'GSTIN does not match the certificate', at: '2030-01-02T05:00:00Z', changes: [{ field: 'gstin', label: 'GSTIN', current: 'x', proposed: 'y' }] } };
    open('/owner/account/business');
    expect(await screen.findByText('Your last change was not approved')).toBeInTheDocument();
    expect(screen.getByText('GSTIN does not match the certificate')).toBeInTheDocument();
  });
});

describe('admin: profile changes', () => {
  beforeEach(() => { me = ADMIN; });
  it('lists the current and requested values side by side and approves with one click', async () => {
    open('/admin/profile-changes');
    const card = await screen.findByRole('region', { name: /Profile change from Arjun Mehta/ });
    expect(within(card).getByText('Mehta Sports Pvt Ltd')).toBeInTheDocument(); expect(within(card).getByText('••••••••3456')).toBeInTheDocument();
    expect(card).toHaveTextContent(/finance must still verify them/);
    await userEvent.click(within(card).getByRole('button', { name: 'Approve changes' }));
    await waitFor(() => expect(calls).toContainEqual(['POST', '/admin/profile-changes/c1/approve', undefined]));
  });
  it('will not reject without a reason, then sends the reason', async () => {
    open('/admin/profile-changes');
    const card = await screen.findByRole('region', { name: /Profile change from Arjun Mehta/ });
    await userEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(await within(card).findByText(/Enter a reason/)).toBeInTheDocument(); expect(calls).toEqual([]);
    await userEvent.type(within(card).getByLabelText(/Reason for rejecting/), 'Name does not match the certificate');
    await userEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(calls).toContainEqual(['POST', '/admin/profile-changes/c1/reject', { note: 'Name does not match the certificate' }]));
  });
  it('is in the admin menu and says so when nothing is waiting', async () => {
    adminChanges = [];
    open('/admin/profile-changes');
    expect(await screen.findByText('No profile changes waiting')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Profile changes/ }).some((l) => l.getAttribute('href') === '/admin/profile-changes')).toBe(true);
  });
});

describe('owner: business contact numbers are editable, without approval', () => {
  const owner = { ...OWNER, phone: '+919800000001', phoneVerified: true };
  const setup = (extra: any = {}) => { me = owner; profileData = { user: owner, profile: { ...PROFILE, alternate_phone: null, ...extra }, pendingChange: null, lastDecision: null }; open('/owner/account/business'); };
  const form = async () => screen.findByRole('form', { name: 'Contact numbers' });

  it('shows the saved mobile number in a box that can be edited, not as plain text', async () => {
    setup();
    const f = await form();
    expect(within(f).getByLabelText('Mobile number')).toHaveValue('+919800000001');
    expect(f).toHaveTextContent('They update straight away, without approval');
    expect(within(f).queryByLabelText('Second phone number')).toBeNull();
  });

  it('adds a second phone number with a button and saves both, live at once (no approval request)', async () => {
    setup();
    const f = await form();
    await userEvent.click(within(f).getByRole('button', { name: '+ Add another phone number' }));
    await userEvent.type(within(f).getByLabelText('Second phone number'), '9899999999');
    await userEvent.click(within(f).getByRole('button', { name: 'Save contact numbers' }));
    await waitFor(() => expect(calls).toContainEqual(['PUT', '/me/profile', { alternatePhone: '+919899999999' }])); // only what changed; the main number was not touched
    expect(await screen.findByText(/Contact numbers saved. They are live now/)).toBeInTheDocument();
    expect(screen.queryByText(/sent to KickOff for approval/i)).toBeNull();
  });

  it('changes the main number and says it needs verifying again', async () => {
    setup();
    const f = await form();
    await userEvent.clear(within(f).getByLabelText('Mobile number')); await userEvent.type(within(f).getByLabelText('Mobile number'), '9123456789');
    expect(within(f).getByText(/needs to be verified again/)).toBeInTheDocument();
    await userEvent.click(within(f).getByRole('button', { name: 'Save contact numbers' }));
    await waitFor(() => expect(calls).toContainEqual(['PUT', '/me/profile', { phone: '9123456789' }]));
    expect(await screen.findByText(/Verify your new mobile number from My profile/)).toBeInTheDocument();
  });

  it('shows a saved second number, and Remove clears it', async () => {
    setup({ alternate_phone: '+919899999999' });
    const f = await form();
    expect(within(f).getByLabelText('Second phone number')).toHaveValue('+919899999999');
    await userEvent.click(within(f).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Save contact numbers' }));
    await waitFor(() => expect(calls).toContainEqual(['PUT', '/me/profile', { alternatePhone: '' }]));
  });

  it('checks the numbers before sending: invalid, or the same as the main number', async () => {
    setup();
    const f = await form();
    await userEvent.click(within(f).getByRole('button', { name: '+ Add another phone number' }));
    await userEvent.type(within(f).getByLabelText('Second phone number'), '12345');
    await userEvent.click(within(f).getByRole('button', { name: 'Save contact numbers' }));
    expect(await within(f).findByText('Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210')).toBeInTheDocument();
    await userEvent.clear(within(f).getByLabelText('Second phone number')); await userEvent.type(within(f).getByLabelText('Second phone number'), '9800000001'); // same as the main number, written without +91
    await userEvent.click(within(f).getByRole('button', { name: 'Save contact numbers' }));
    expect(await within(f).findByText('Use a different number from your main mobile number')).toBeInTheDocument();
    expect(calls.filter((c) => c[1] === '/me/profile')).toEqual([]);
  });

  it('does nothing when nothing changed', async () => {
    setup();
    const f = await form();
    await userEvent.click(within(f).getByRole('button', { name: 'Save contact numbers' }));
    expect(await screen.findByText('No changes to save')).toBeInTheDocument(); expect(calls.filter((c) => c[1] === '/me/profile')).toEqual([]);
  });
});

describe('My profile page: second phone number', () => {
  const owner = { ...OWNER, phone: '+919800000001', phoneVerified: true };
  const customer = { ...OWNER, id: 'c1', role: 'customer', phone: '+919800000001', phoneVerified: true };
  const show = async (user: any, extra: any = {}) => { me = user; profileData = { user, profile: { ...(user.role === 'owner' ? PROFILE : {}), alternate_phone: null, ...extra }, pendingChange: null, lastDecision: null }; open(user.role === 'owner' ? '/owner/account/business' : '/profile'); return user.role === 'owner' ? screen.findByRole('heading', { name: 'Contact numbers' }) : screen.findByRole('heading', { name: 'Details' }); };

  it('a turf owner sees "+ Add another phone number" right under the mobile number', async () => {
    await show(owner);
    expect(await screen.findByLabelText('Mobile number')).toHaveValue('+919800000001');
    expect(screen.getByRole('button', { name: '+ Add another phone number' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Second phone number')).toBeNull();
  });

  it('adds the number and saves it live, sending only the second number that changed', async () => {
    await show(owner);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add another phone number' }));
    await userEvent.type(screen.getByLabelText('Second phone number'), '9899999999');
    expect(screen.getByText('Change these any time. They update straight away, without approval.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save contact numbers' }));
    await waitFor(() => expect(calls.find((c) => c[1] === '/me/profile')?.[2]).toMatchObject({ alternatePhone: '+919899999999' }));
    expect(calls.find((c) => c[1] === '/me/profile')?.[2]).not.toHaveProperty('phone'); // the main number was not touched
  });

  it('shows a saved second number, and Remove sends an empty one so it is deleted', async () => {
    await show(owner, { alternate_phone: '+919899999999' });
    expect(await screen.findByLabelText('Second phone number')).toHaveValue('+919899999999');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save contact numbers' }));
    await waitFor(() => expect(calls.find((c) => c[1] === '/me/profile')?.[2]).toMatchObject({ alternatePhone: '' }));
  });

  it('refuses an invalid second number, or the same as the main one, before sending', async () => {
    await show(owner);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add another phone number' }));
    await userEvent.type(screen.getByLabelText('Second phone number'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact numbers' }));
    expect(await screen.findByText('Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9, e.g. 9876543210')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Second phone number')); await userEvent.type(screen.getByLabelText('Second phone number'), '9800000001');
    await userEvent.click(screen.getByRole('button', { name: 'Save contact numbers' }));
    expect(await screen.findByText('Use a different number from your main mobile number')).toBeInTheDocument();
    expect(calls.filter((c) => c[1] === '/me/profile')).toEqual([]);
  });

  it('customers do not get the option at all', async () => {
    await show(customer);
    expect(await screen.findByLabelText('Mobile number')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add another phone number' })).toBeNull(); expect(screen.queryByLabelText('Second phone number')).toBeNull();
  });
  it('the owner Profile page is read only: contact details, verification and account type, with links to where they are changed', async () => {
    me = owner; profileData = { user: owner, profile: PROFILE, pendingChange: null, lastDecision: null };
    open('/owner/account/profile');
    expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    for (const t of ['Contact details', 'Verification', 'Account type']) expect(screen.getByRole('heading', { name: t })).toBeInTheDocument();
    expect(screen.queryByLabelText('Mobile number')).toBeNull(); // nothing to type into here
    expect(screen.getAllByRole('link', { name: 'Business information' })[0]).toHaveAttribute('href', '/owner/account/business');
  });
});
