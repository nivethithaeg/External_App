import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/lib/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), apiError: (e: any) => String(e), api: {} }));
import * as api from '../src/lib/api';
import { OwnerCustomersPage } from '../src/pages/owner/OwnerCustomers';

const customers = [
  { key: 'u1', name: 'Asha Rao', mobile: '+919876543210', email: 'asha@x.co', city: 'Chennai', bookings: 3, cancelled: 1, spent: 2400, last_booking: '2030-01-01T05:30:00.000Z' },
  { key: 'manual:m1', manual_id: 'm1', source: 'manual', name: 'Priya Nair', mobile: '+919876544444', email: null, city: 'Kochi', bookings: 0, cancelled: 0, spent: 0, last_booking: null },
  { key: 'walkin:999', name: 'Walk In Ravi', mobile: '999', email: null, city: null, bookings: 1, cancelled: 0, spent: 800, last_booking: '2030-01-02T05:30:00.000Z' },
];
beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (url: string, params?: any) => {
    if (url === '/owner/customers/history') return { bookings: [{ id: 'b1', reference: 'KO-1', status: 'completed', total: 800, starts_at: '2030-01-01T05:30:00.000Z', venue: 'Green Arena', area: 'Turf A' }] };
    const list = params?.search ? customers.filter((c) => c.name.toLowerCase().includes(params.search.toLowerCase())) : customers;
    return { customers: list, summary: { customers: 3, repeat: 1, bookings: 4, cancellations: 1 } };
  });
});
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><OwnerCustomersPage /></MemoryRouter></QueryClientProvider>);

describe('Owner customers page', () => {
  it('shows summary, repeat customers, filters by search and opens a customer\'s history', async () => {
    wrap();
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument(); expect(screen.getByText('Walk In Ravi')).toBeInTheDocument();
    expect(screen.getByText('Repeat customers')).toBeInTheDocument(); expect(screen.getByText('Repeat')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search'), 'asha');
    await waitFor(() => expect(screen.queryByText('Walk In Ravi')).not.toBeInTheDocument(), { timeout: 3000 });
    await userEvent.click(screen.getByText('Asha Rao'));
    expect(await screen.findByText(/Green Arena · Turf A/)).toBeInTheDocument();
  });

  it('has no Add customer button; Edit / Delete stay only for customers added by hand earlier', async () => {
    wrap();
    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add customer/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1); // Asha and Ravi come from bookings: no Edit
  });
});
