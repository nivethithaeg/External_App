import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/lib/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), apiError: (e: any) => String(e?.message ?? e), api: {} }));
import * as api from '../src/lib/api';
import { AdminOwners } from '../src/pages/admin/AdminCore';
import { AdminAreaApprovals, AdminCustomers, AdminListingChanges, AdminReviews, AdminSports, AdminWallets } from '../src/pages/admin/AdminJusgo';

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((async (url: string) => ({
    '/admin/sports': { sports: [{ id: 1, name: 'Football', slug: 'football', isActive: true, venues: 3, areas: 5 }] },
    '/admin/listing-changes': { changes: [{ venueId: 'v1', venueName: 'Green Arena', ownerName: 'Asha Rao', updatedAt: '2030-01-02T00:00:00Z', fields: { name: 'Green Arena 2' }, facilitiesChanged: false, newMedia: 2, removedMedia: 0 }] },
    '/admin/areas': { areas: [{ id: 'a1', name: 'Court 2', approvalStatus: 'pending', approvalNote: null, venueId: 'v1', venueName: 'Green Arena', city: 'Erode', ownerName: 'Asha Rao', sports: ['Football'], capacity: 10, priceRules: 2 }] },
    '/admin/customers': { customers: [{ id: 'c1', full_name: 'Kavya Menon', email: 'k@x.co', phone: '+919876500000', city: 'Kochi', is_active: true, created_at: '2030-01-01T00:00:00Z', bookings: 4, cancelled: 1, spent: 3200, last_booking: '2030-02-01T05:30:00Z' }], summary: { customers: 1, active: 1, new_30d: 1, repeat: 1 } },
    '/admin/customers/c1': { customer: { id: 'c1', full_name: 'Kavya Menon', email: 'k@x.co', phone: '+919876500000', city: 'Kochi', is_active: true, email_verified: true, phone_verified: false, created_at: '2030-01-01T00:00:00Z', preferredSports: ['Football'] }, stats: { bookings: 4, cancelled: 1, spent: 3200, wallet: 150, refunded: 800, refunds: 1 }, bookings: [{ id: 'b1', reference: 'KO-1', status: 'completed', total: 800, starts_at: '2030-02-01T05:30:00Z', venue: 'Green Arena', area: 'Turf A', sport: 'Football' }], tickets: [{ id: 't1', subject: 'Refund late', status: 'open', created_at: '2030-02-02T00:00:00Z' }], reviews: [], logins: [] },
    '/admin/owners': { owners: [{ id: 'o1', business_name: 'Mehta Sports', full_name: 'Arjun Mehta', email: 'a@x.co', phone: null, verification_status: 'verified', application_status: 'approved', venues: 1, commission_override: null, bank_account_name: 'Mehta Sports', bank_account_masked: '••••••••9012', bank_ifsc: 'HDFC0001234', upi_id: null, bank_verified: false, pending_documents: 0 }] },
    '/admin/reviews': { reviews: [{ id: 'r1', rating: 2, comment: 'Floodlights were off', owner_reply: null, is_hidden: false, created_at: '2030-02-01T00:00:00Z', venue_name: 'Green Arena', customer_name: 'Kavya Menon', customer_email: 'k@x.co' }], summary: { total: 1, hidden: 0, average: 2 } },
    '/admin/wallets': { wallets: [{ id: 'c1', full_name: 'Kavya Menon', email: 'k@x.co', phone: null, balance: 250, next_expiry: '2031-01-01T00:00:00Z', last_credit: '2030-02-01T00:00:00Z' }], summary: { customers: 1, outstanding: 250, expiringSoon: 0 } },
  } as Record<string, any>)[url]) as any);
  vi.mocked(api.post).mockResolvedValue({}); vi.mocked(api.patch).mockResolvedValue({}); vi.mocked(api.put).mockResolvedValue({});
});

describe('JusGo admin pages', () => {
  it('sports: lists with counts, adds, switches off', async () => {
    wrap(<AdminSports />);
    expect(await screen.findByText('Football')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Add a sport'), 'Padel'); await userEvent.click(screen.getByRole('button', { name: 'Add sport' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/sports', { name: 'Padel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/sports/1', { isActive: false }));
  });
  it('listing changes: approve, and reject needs a reason', async () => {
    wrap(<AdminListingChanges />);
    expect(await screen.findByText('Green Arena')).toBeInTheDocument(); expect(screen.getByText('Green Arena 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/venues/v1/changes', { decision: 'approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('button', { name: 'Reject changes' })).toBeDisabled();
  });
  it('playing area approvals: approve at once, reject needs a reason', async () => {
    wrap(<AdminAreaApprovals />);
    expect(await screen.findByText('Court 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/areas/a1/decision', { decision: 'approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('button', { name: 'Reject area' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason/), 'Add photos'); await userEvent.click(screen.getByRole('button', { name: 'Reject area' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/areas/a1/decision', { decision: 'reject', note: 'Add photos' }));
  });
});

import { canSeeAdminPage } from '../src/components/Layouts';
describe('admin pages follow the admin\'s permissions', () => {
  it('hides pages that need a permission the admin does not have', () => {
    expect(canSeeAdminPage(['*'], '/admin/payments')).toBe(true);
    expect(canSeeAdminPage(['reports'], '/admin/revenue')).toBe(true);
    expect(canSeeAdminPage(['reports'], '/admin/payments')).toBe(false);
    expect(canSeeAdminPage(['users:read'], '/admin/users')).toBe(true);
    expect(canSeeAdminPage([], '/admin')).toBe(true); // the dashboard and notifications are open to every admin
    expect(canSeeAdminPage(undefined, '/admin/team')).toBe(true); // older sessions without the list are not locked out
  });
});

import { adminGroups } from '../src/components/Layouts';
describe('admin sidebar groups (like JusGo)', () => {
  it('has the JusGo groups, every page exactly once, and Dashboard first', () => {
    expect(adminGroups.map((g) => g.label)).toEqual(['Dashboard', 'Venue Owner Approvals', 'Venues & Owners', 'Customers', 'Logs & Reports', 'System']);
    const all = adminGroups.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(all).size).toBe(all.length);
    expect(adminGroups[1].items.map((i) => i.label)).toEqual(['Owner applications', 'Profile changes', 'Business type changes', 'Venue approvals', 'Playing area approvals', 'Listing changes']);
    expect(adminGroups[3].items.map((i) => i.label)).toEqual(['Customers', 'Bookings', 'Payments', 'Refunds', 'Wallets', 'Reviews', 'Complaints', 'Coupons']);
    expect(all).toEqual(expect.arrayContaining(['/admin/sports', '/admin/revenue', '/admin/team', '/admin/audit']));
  });
});

describe('admin customers page', () => {
  it('lists customers with activity and opens the full profile', async () => {
    wrap(<AdminCustomers />);
    expect(await screen.findByText('Kavya Menon')).toBeInTheDocument(); expect(screen.getByText('Repeat customers')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Kavya Menon'));
    expect(await screen.findByText(/Green Arena · Turf A/)).toBeInTheDocument(); expect(screen.getByText('Refund late')).toBeInTheDocument(); expect(screen.getByText(/Refunded so far/)).toBeInTheDocument();
  });
});

describe('customer reviews and wallets', () => {
  it('reviews: shows the comment and hides it', async () => {
    wrap(<AdminReviews />);
    expect(await screen.findByText('Floodlights were off')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/reviews/r1', { isHidden: true }));
  });
  it('wallets: shows who holds credit and the total', async () => {
    wrap(<AdminWallets />);
    expect(await screen.findByText('Kavya Menon')).toBeInTheDocument(); expect(screen.getByText('Total outstanding')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open customer' })).toHaveAttribute('href', '/admin/customers?open=c1');
  });
});

describe('admin verifies the bank account', () => {
  it('shows the account in the owner details and verifies it with one click', async () => {
    wrap(<AdminOwners />);
    expect(await screen.findByText('To verify')).toBeInTheDocument(); // the list says which owners still need it
    await userEvent.click(screen.getByText('Mehta Sports'));
    const box = await screen.findByRole('region', { name: 'Bank account' });
    expect(box).toHaveTextContent('••••••••9012'); expect(box).toHaveTextContent('HDFC0001234'); expect(box).toHaveTextContent('Waiting for verification');
    await userEvent.click(within(box).getByRole('button', { name: 'Verify bank account' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/owners/o1/bank-verification', { verified: true }));
    expect(await within(box).findByText('Verified')).toBeInTheDocument();
  });
});

describe('playing area delete requests', () => {
  it('lists requests with the reason and bookings, approves after a confirm, and turning down needs a reason', async () => {
    vi.mocked(api.get).mockImplementation((async (url: string, params?: any) => url === '/admin/areas' && params?.deletion === 'pending'
      ? { areas: [{ id: 'a9', name: 'Court 3', approvalStatus: 'approved', venueId: 'v1', venueName: 'Green Arena', city: 'Erode', ownerName: 'Asha Rao', sports: [], capacity: null, priceRules: 1,
          deletionStatus: 'pending', deletionReason: 'Turning it into parking', deletionRequestedAt: '2030-01-02T00:00:00Z', upcomingBookings: 2, totalBookings: 9 }] }
      : { areas: [] }) as any);
    wrap(<AdminAreaApprovals />);
    await userEvent.selectOptions(await screen.findByLabelText('Show'), 'del:pending');
    expect(await screen.findByText('Court 3')).toBeInTheDocument();
    expect(screen.getByText("Owner's reason: Turning it into parking")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('2 upcoming bookings are still booked here');
    window.confirm = () => { throw new Error('no browser confirm box'); };
    await userEvent.click(screen.getByRole('button', { name: 'Approve delete' }));
    const dlg = await screen.findByRole('dialog', { name: 'Delete Court 3?' });
    expect(within(dlg).getByText('No one can book this area anymore.')).toBeInTheDocument(); expect(within(dlg).getByText('Its booking history is kept.')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete playing area' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/areas/a9/deletion', { decision: 'approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject request' }));
    const rej = await screen.findByRole('dialog', { name: 'Reject the delete request for Court 3?' });
    expect(within(rej).getByText(/not deleted/)).toBeInTheDocument();
    expect(within(rej).getByRole('button', { name: 'Reject request' })).toBeDisabled();
    await userEvent.type(within(rej).getByLabelText(/Reason/), 'Has bookings next week');
    await userEvent.click(within(rej).getByRole('button', { name: 'Reject request' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/areas/a9/deletion', { decision: 'reject', note: 'Has bookings next week' }));
  });
});

describe('business type changes', () => {
  it('shows the old and new type with the details, approves in a pop-up, and rejecting needs a reason', async () => {
    const { AdminBusinessChanges } = await import('../src/pages/admin/AdminJusgo');
    vi.mocked(api.get).mockImplementation((async (url: string) => url === '/admin/business-changes'
      ? { changes: [{ id: 'c1', status: 'pending', fromType: 'individual', toType: 'partnership_pvt_ltd', reason: 'We formed a partnership', ownerId: 'o1', ownerName: 'Arun Kumar', ownerEmail: 'a@x.co', ownerCode: 'VO000012', currentBusinessName: 'Arun Kumar',
          details: { businessName: 'Arun Sports LLP', pan: 'ABCDE1234F', city: 'Erode', partners: [{ name: 'Meena Ravi', pan: 'BCDEF2345G', aadhaarLast4: '1234', phone: '9876543211' }] } }] }
      : {}) as any);
    wrap(<AdminBusinessChanges />);
    expect(await screen.findByText('Arun Kumar')).toBeInTheDocument();
    expect(screen.getByText('Partnership / Private Limited Company')).toBeInTheDocument();
    expect(screen.getByText(/Meena Ravi \(PAN BCDEF2345G, Aadhaar ••••1234/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve change' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/business-changes/c1/decision', { decision: 'approve' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('button', { name: 'Reject change' })).toBeDisabled();
    await userEvent.type(within(dlg).getByLabelText(/Reason/), 'Upload the deed');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reject change' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/business-changes/c1/decision', { decision: 'reject', note: 'Upload the deed' }));
  });
});
