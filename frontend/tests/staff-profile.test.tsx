import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { StaffProfile } from '../src/pages/staff/StaffPortal';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 's1', role: 'staff', fullName: 'Ravi Kumar', email: 'ravi@example.com' } }) }));

describe('Staff profile', () => {
  it('shows the account, what the owner allows, and a change-password form', async () => {
    vi.mocked(api.get).mockResolvedValue({ business: 'Green Arena', permissions: ['CHECK_IN', 'BOOKING_VIEW'] } as any);
    render(<QueryClientProvider client={new QueryClient()}><ToastProvider><MemoryRouter><StaffProfile /></MemoryRouter></ToastProvider></QueryClientProvider>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument(); expect(screen.getByText('ravi@example.com')).toBeInTheDocument();
    expect(await screen.findByText('Check In')).toBeInTheDocument(); expect(screen.getByText('Booking View')).toBeInTheDocument();
    expect(screen.getByLabelText(/Current password/)).toBeInTheDocument();
  });
});
