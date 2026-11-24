import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input, PasswordInput } from '../src/components/ui';
import { FILTERS } from '../src/lib/inputFilters';

function Box({ filter, label = 'Box', password = false }: { filter: any; label?: string; password?: boolean }) {
  const [v, setV] = useState('');
  return password ? <PasswordInput label={label} filter={filter} value={v} onChange={(e) => setV(e.target.value)} /> : <Input label={label} filter={filter} value={v} onChange={(e) => setV(e.target.value)} />;
}

describe('typing filters', () => {
  it('a name does not take digits or symbols, and says why under the box', async () => {
    render(<Box filter={FILTERS.personName} label="Name" />);
    const box = screen.getByLabelText('Name') as HTMLInputElement;
    await userEvent.type(box, 'Asha Rao7');
    expect(box.value).toBe('Asha Rao');
    expect(await screen.findByText(/Only letters, spaces, apostrophes/)).toBeInTheDocument();
  });
  it('the reason goes away once a good character is typed, and when leaving the box', async () => {
    render(<Box filter={FILTERS.mobile} label="Mobile" />);
    const box = screen.getByLabelText('Mobile') as HTMLInputElement;
    await userEvent.type(box, 'a'); expect(box.value).toBe(''); expect(screen.getByText(/can only have digits/)).toBeInTheDocument();
    await userEvent.type(box, '9'); expect(screen.queryByText(/can only have digits/)).not.toBeInTheDocument();
    await userEvent.type(box, 'x'); expect(screen.getByText(/can only have digits/)).toBeInTheDocument();
    await userEvent.tab(); expect(screen.queryByText(/can only have digits/)).not.toBeInTheDocument();
    expect(box.value).toBe('9');
  });
  it('stops at the maximum length and tells the person', async () => {
    render(<Box filter={FILTERS.pincode} label="PIN" />);
    const box = screen.getByLabelText('PIN') as HTMLInputElement;
    await userEvent.type(box, '5600381234');
    expect(box.value).toBe('560038'); expect(screen.getByText(/At most 6 characters/)).toBeInTheDocument();
  });
  it('capitalises a PAN and keeps symbols out; a password cannot have spaces', async () => {
    const { unmount } = render(<Box filter={FILTERS.pan} label="PAN" />);
    const pan = screen.getByLabelText('PAN') as HTMLInputElement;
    await userEvent.type(pan, 'abcde1234f-'); expect(pan.value).toBe('ABCDE1234F'); expect(screen.getByText(/A PAN has only letters and digits/)).toBeInTheDocument();
    unmount();
    render(<Box filter={FILTERS.password} label="Password" password />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    await userEvent.type(pw, 'password1 '); expect(pw.value).toBe('password1');
    expect(screen.getByText('A password cannot have spaces.')).toBeInTheDocument();
  });
});

function Plain({ label, mandatory, placeholder, onBlur, type }: { label: string; mandatory?: boolean; placeholder?: string; onBlur?: () => void; type?: string }) {
  const [v, setV] = useState('');
  return <Input label={label} mandatory={mandatory} placeholder={placeholder} onBlur={onBlur} type={type} value={v} onChange={(e) => setV(e.target.value)} />;
}

describe('every box shows an example and checks itself when you leave it', () => {
  it('shows an example inside the box, taken from its label', () => {
    render(<><Plain label="Email" /><Plain label="Mobile number" /><Plain label="PAN Number" /><Plain label="IFSC" /><Plain label="PIN code" /><Plain label="Amount ₹" /><Plain label="Customer name" /></>);
    expect(screen.getByLabelText('Email')).toHaveAttribute('placeholder', 'e.g. name@example.com');
    expect(screen.getByLabelText('Mobile number')).toHaveAttribute('placeholder', 'e.g. 9876543210');
    expect(screen.getByLabelText('PAN Number')).toHaveAttribute('placeholder', 'e.g. ABCDE1234F');
    expect(screen.getByLabelText('IFSC')).toHaveAttribute('placeholder', 'e.g. HDFC0001234');
    expect(screen.getByLabelText('PIN code')).toHaveAttribute('placeholder', 'e.g. 560038');
    expect(screen.getByLabelText('Amount ₹')).toHaveAttribute('placeholder', 'e.g. 800');
    expect(screen.getByLabelText('Customer name')).toHaveAttribute('placeholder', 'e.g. Ravi Kumar');
  });
  it("a form's own placeholder wins, and its own blur handler still runs exactly once", async () => {
    let blurs = 0;
    render(<Plain label="Email" placeholder="you@club.in" onBlur={() => { blurs += 1; }} />);
    const box = screen.getByLabelText('Email');
    expect(box).toHaveAttribute('placeholder', 'you@club.in');
    await userEvent.click(box); await userEvent.tab();
    expect(blurs).toBe(1);
  });
  it('says what is wrong once the box is left, and stops saying it once it is fixed', async () => {
    render(<Plain label="Email" mandatory />);
    const box = screen.getByLabelText(/^Email/) as HTMLInputElement;
    await userEvent.click(box); await userEvent.tab();
    expect(screen.getByText('This field is required.')).toBeInTheDocument();
    await userEvent.type(box, 'nope'); expect(screen.getByText(/Enter a valid email address/)).toBeInTheDocument();
    await userEvent.type(box, '@club.in'); expect(screen.queryByText(/Enter a valid email address/)).not.toBeInTheDocument();
  });
  it('checks the formats: mobile, PAN, IFSC, PIN code and account number', async () => {
    render(<><Plain label="Mobile number" /><Plain label="PAN Number" /><Plain label="IFSC" /><Plain label="PIN code" /><Plain label="Account number" /></>);
    const cases: [string, string, RegExp][] = [['Mobile number', '12345', /valid 10-digit mobile number/], ['PAN Number', 'ABC', /A PAN looks like/], ['IFSC', 'HDFC12', /An IFSC looks like/], ['PIN code', '1234', /PIN code has 6 digits/], ['Account number', '123', /6 to 20 digits/]];
    for (const [label, bad, msg] of cases) { await userEvent.type(screen.getByLabelText(label), bad); await userEvent.tab(); expect(screen.getByText(msg)).toBeInTheDocument(); }
    await userEvent.clear(screen.getByLabelText('Mobile number')); await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210'); expect(screen.queryByText(/valid 10-digit mobile number/)).not.toBeInTheDocument();
  });
});
