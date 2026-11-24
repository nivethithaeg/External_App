import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TimeInput } from '../src/components/ui';

function Host({ start, spy }: { start: string; spy: (v: string) => void }) {
  const [v, setV] = useState(start);
  return <><TimeInput label="From" value={v} onChange={(x) => { setV(x); spy(x); }} /><p data-testid="v">{v}</p></>;
}
describe('TimeInput', () => {
  it('shows 24-hour values as 12-hour with AM/PM', () => {
    render(<Host start="18:30" spy={() => {}} />);
    expect(screen.getByLabelText('From hour')).toHaveValue('6');
    expect(screen.getByLabelText('From minutes')).toHaveValue('30');
    expect(screen.getByLabelText('From AM or PM')).toHaveValue('PM');
  });
  it('handles midnight and noon correctly', () => {
    const { unmount } = render(<Host start="00:00" spy={() => {}} />);
    expect(screen.getByLabelText('From hour')).toHaveValue('12'); expect(screen.getByLabelText('From AM or PM')).toHaveValue('AM'); unmount();
    render(<Host start="12:00" spy={() => {}} />);
    expect(screen.getByLabelText('From hour')).toHaveValue('12'); expect(screen.getByLabelText('From AM or PM')).toHaveValue('PM');
  });
  it('emits the 24-hour HH:mm string the API expects', async () => {
    const spy = vi.fn();
    render(<Host start="06:00" spy={spy} />);
    await userEvent.selectOptions(screen.getByLabelText('From AM or PM'), 'PM');
    expect(spy).toHaveBeenLastCalledWith('18:00');
    await userEvent.selectOptions(screen.getByLabelText('From hour'), '11');
    await userEvent.selectOptions(screen.getByLabelText('From minutes'), '45');
    expect(screen.getByTestId('v')).toHaveTextContent('23:45');
    await userEvent.selectOptions(screen.getByLabelText('From AM or PM'), 'AM');
    await userEvent.selectOptions(screen.getByLabelText('From hour'), '12');
    expect(screen.getByTestId('v')).toHaveTextContent('00:45');
  });
  it('keeps odd saved minutes such as 23:59', () => {
    render(<Host start="23:59" spy={() => {}} />);
    expect(screen.getByLabelText('From minutes')).toHaveValue('59');
  });
});
