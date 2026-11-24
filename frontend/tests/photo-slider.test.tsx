import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoSlider } from '../src/components/PhotoSlider';

const photos = [{ id: 'a', url: '/a.jpg' }, { id: 'b', url: '/b.jpg' }, { id: 'c', url: '/c.jpg' }];
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('photo slider', () => {
  it('moves through the photos by itself and starts again from the first', () => {
    render(<PhotoSlider photos={photos} alt="Green Arena" ms={1000} />);
    const shown = () => screen.getByAltText(/photo \d of 3/).getAttribute('src');
    expect(shown()).toBe('/a.jpg');
    act(() => { vi.advanceTimersByTime(1000); }); expect(shown()).toBe('/b.jpg');
    act(() => { vi.advanceTimersByTime(1000); }); expect(shown()).toBe('/c.jpg');
    act(() => { vi.advanceTimersByTime(1000); }); expect(shown()).toBe('/a.jpg');
  });
  it('waits while the pointer is over it, and a dot jumps to that photo', async () => {
    render(<PhotoSlider photos={photos} alt="Green Arena" ms={1000} />);
    const box = screen.getByRole('group', { name: 'Green Arena photos' }).parentElement!;
    await userEvent.hover(box);
    act(() => { vi.advanceTimersByTime(5000); }); expect(screen.getByAltText(/photo 1 of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show photo 3' }));
    expect(screen.getByAltText(/photo 3 of 3/)).toBeInTheDocument();
  });
  it('a single photo just shows, with no dots', () => {
    render(<PhotoSlider photos={[photos[0]]} alt="Court" />);
    expect(screen.getByAltText(/Court photo 1 of 1/)).toBeInTheDocument(); expect(screen.queryByRole('group')).toBeNull();
  });
  it('shows the fallback when there are no photos', () => {
    render(<PhotoSlider photos={[]} alt="Court" fallback={<p>No photo</p>} />);
    expect(screen.getByText('No photo')).toBeInTheDocument();
  });
});
