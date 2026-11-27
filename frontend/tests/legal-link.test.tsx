import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LegalLink } from '../src/components/LegalLink';

describe('terms and conditions shown in a pop-up', () => {
  it('opens the document right there, without a new tab, and closes again', async () => {
    render(<MemoryRouter><p>I agree to the <LegalLink doc="terms">Terms and Conditions</LegalLink></p></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'Terms and Conditions' });
    expect(screen.queryByRole('link', { name: 'Terms and Conditions' })).not.toBeInTheDocument(); // not a link that leaves the page
    await userEvent.click(trigger);
    const dlg = await screen.findByRole('dialog', { name: 'Terms and conditions' });
    expect(await within(dlg).findByText('Using PlaynX')).toBeInTheDocument();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Terms and conditions' })).not.toBeInTheDocument());
  });
  it('shows the privacy policy and the owner agreement the same way', async () => {
    render(<MemoryRouter><LegalLink doc="privacy">Privacy Policy</LegalLink><LegalLink doc="owner-agreement">Venue Owner Agreement</LegalLink></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));
    expect(await screen.findByRole('dialog', { name: 'Privacy policy' })).toBeInTheDocument();
  });
});
