import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JUSGO_LOCKED_EVENT, JusgoLockedPopup } from '../src/components/JusgoLockedPopup';

describe('JusGo-linked venues', () => {
  it('a refused change opens a pop-up saying to make it in JusGo, and OK closes it', async () => {
    render(<JusgoLockedPopup />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { window.dispatchEvent(new Event(JUSGO_LOCKED_EVENT)); });
    const pop = await screen.findByRole('dialog', { name: 'Change this in JusGo' });
    expect(pop).toHaveTextContent(/only in the JusGo owner portal/);
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
