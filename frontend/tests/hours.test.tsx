import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/lib/api', async (orig) => ({ ...(await orig() as any), get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
import * as api from '../src/lib/api';
import { ToastProvider } from '../src/lib/toast';
import { ScheduleModal } from '../src/pages/owner/AreaSchedule';
import { scheduleStatus } from '../src/pages/owner/VenueEditor';

const SPORTS = [{ id: 1, name: 'Football' }, { id: 2, name: 'Cricket' }];
const days = (o = '06:00', c = '09:00', closed: number[] = []) => Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, openTime: o, closeTime: c, isClosed: closed.includes(d) }));
const area = (over: any = {}) => ({ id: 'a1', name: 'Turf A', slot_minutes: 60, sport_ids: [1, 2], availability: days(), pricing: [], ...over });
let saved: { url: string; body: any }[] = [];
const show = (a = area(), onSaved = () => {}) => render(<QueryClientProvider client={new QueryClient()}><ToastProvider><MemoryRouter><ScheduleModal area={a} sports={SPORTS} onClose={() => {}} onSaved={onSaved} /></MemoryRouter></ToastProvider></QueryClientProvider>);
const tab = (d: string) => screen.getByRole('tab', { name: new RegExp(d) });
const price = (t: string) => screen.getByLabelText(`${t} price`) as HTMLInputElement;
const slotTimes = (day: string) => within(screen.getByRole('list', { name: `${day} slots` })).getAllByRole('listitem').map((li) => li.querySelector('span')!.textContent);
const type = async (el: HTMLElement, v: string) => { await userEvent.clear(el); await userEvent.type(el, v); };

beforeEach(() => {
  vi.clearAllMocks(); saved = [];
  vi.mocked(api.put).mockImplementation((async (url: string, body: any) => { saved.push({ url, body }); return {}; }) as any);
});

describe('slots follow the opening and closing hours', () => {
  it('shows exactly the slots between opening and closing, one tile per slot, with a price box under each', async () => {
    show(area({ availability: days('06:00', '09:00') }));
    await userEvent.click(tab('Mon'));
    expect(slotTimes('Monday')).toEqual(['6:00 AM', '7:00 AM', '8:00 AM']);
    for (const t of ['6:00 AM', '7:00 AM', '8:00 AM']) expect(price(t)).toBeInTheDocument();
  });
  it('adds and removes slots when the closing or opening time changes', async () => {
    show(area({ availability: days('06:00', '08:00') }));
    await userEvent.click(tab('Mon'));
    expect(slotTimes('Monday')).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('Monday closes hour'), '11'); await userEvent.selectOptions(screen.getByLabelText('Monday closes AM or PM'), 'AM');
    expect(slotTimes('Monday')).toEqual(['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM']);
    await userEvent.selectOptions(screen.getByLabelText('Monday opens hour'), '8');
    expect(slotTimes('Monday')).toEqual(['8:00 AM', '9:00 AM', '10:00 AM']);
  });
  it('uses 30-minute tiles when the area has 30-minute slots, and prices each tile as half an hour', async () => {
    show(area({ slot_minutes: 30, availability: days('06:00', '07:30'), pricing: [{ sportId: null, dayType: 'all', dayOfWeek: null, startTime: '06:00', endTime: '07:30', pricePerHour: 800 }] }));
    await userEvent.click(tab('Mon'));
    expect(slotTimes('Monday')).toEqual(['6:00 AM', '6:30 AM', '7:00 AM']);
    expect(price('6:00 AM').value).toBe('400'); // ₹800 an hour = ₹400 for a half-hour slot
  });
  it('a closed day has no slots', async () => {
    show(area({ availability: days('06:00', '09:00', [2]) }));
    await userEvent.click(tab('Tue'));
    expect(screen.getByText(/Tuesday is closed, so it has no slots/)).toBeInTheDocument(); expect(screen.queryByRole('list', { name: 'Tuesday slots' })).toBeNull();
    await userEvent.click(screen.getByLabelText('Closed all day')); // open it again
    expect(slotTimes('Tuesday')).toHaveLength(3);
  });
});

describe('a price under each slot', () => {
  it('shows the saved prices under the right slots, and saves what the owner types as rules', async () => {
    const onSaved = vi.fn();
    show(area({ pricing: [{ sportId: null, dayType: 'all', dayOfWeek: null, startTime: '06:00', endTime: '08:00', pricePerHour: 500 }] }), onSaved);
    await userEvent.click(tab('Mon'));
    expect(price('6:00 AM').value).toBe('500'); expect(price('7:00 AM').value).toBe('500'); expect(price('8:00 AM').value).toBe('');
    await type(price('8:00 AM'), '700');
    await userEvent.click(screen.getByRole('button', { name: 'Save hours & prices' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].url).toBe('/owner/areas/a1/schedule');
    const mon = saved[0].body.rules.filter((r: any) => r.dayOfWeek === 1);
    expect(mon).toEqual([{ sportId: null, dayType: 'all', dayOfWeek: 1, startTime: '06:00', endTime: '08:00', pricePerHour: 500 }, { sportId: null, dayType: 'all', dayOfWeek: 1, startTime: '08:00', endTime: '09:00', pricePerHour: 700 }]);
    expect(saved[0].body.days).toHaveLength(7); expect(saved[0].body.days[1]).toEqual({ dayOfWeek: 1, openTime: '06:00', closeTime: '09:00', isClosed: false });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
  it('warns about open slots that have no price and counts them', async () => {
    show(area({ availability: days('06:00', '08:00') })); // 2 slots x 7 days, none priced
    expect(await screen.findByText(/14 open slots have no price/)).toBeInTheDocument();
    await userEvent.click(tab('Mon')); await userEvent.type(screen.getByLabelText('Price for every slot'), '500'); await userEvent.click(screen.getByLabelText('every open day')); await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByText(/open slots? ha(s|ve) no price/)).toBeNull());
  });
  it('with a default price every slot is filled with it, one slot can be changed, and only changed slots are saved as their own price', async () => {
    const DEF = { sportId: null, dayType: 'all', dayOfWeek: null, startTime: '00:00', endTime: '24:00', pricePerHour: 900 };
    const OWN = { sportId: null, dayType: 'all', dayOfWeek: 1, startTime: '06:00', endTime: '07:00', pricePerHour: 1300 };
    show(area({ availability: days('06:00', '08:00'), pricing: [DEF, OWN] }));
    await userEvent.click(tab('Mon'));
    expect(screen.queryByText(/open slots? ha(s|ve) no price/)).toBeNull();
    expect(price('6:00 AM')).toHaveValue(1300); // its own price
    expect(price('7:00 AM')).toHaveValue(900); // filled with the default price
    await type(price('7:00 AM'), '1100'); // the owner changes just this slot
    expect(scheduleStatus(area({ availability: days('06:00', '08:00'), pricing: [DEF] })).warn).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Save hours & prices' }));
    await waitFor(() => expect(saved[0]?.body.rules).toEqual(expect.arrayContaining([expect.objectContaining({ dayOfWeek: 1, startTime: '06:00', endTime: '07:00', pricePerHour: 1300 }), expect.objectContaining({ dayOfWeek: 1, startTime: '07:00', endTime: '08:00', pricePerHour: 1100 }), expect.objectContaining({ dayOfWeek: null, startTime: '00:00', endTime: '24:00', pricePerHour: 900 })])));
    expect(saved[0].body.rules.filter((r: any) => r.pricePerHour === 900 && r.dayOfWeek !== null)).toHaveLength(0); // the default is not copied into every slot
  });
  it('slots added by longer opening hours are filled with the default price too', async () => {
    const DEF = { sportId: null, dayType: 'all', dayOfWeek: null, startTime: '00:00', endTime: '24:00', pricePerHour: 900 };
    show(area({ availability: days('06:00', '08:00'), pricing: [DEF] }));
    await userEvent.click(tab('Mon'));
    expect(screen.queryByLabelText('9:00 AM price')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Monday closes hour'), '10'); await userEvent.selectOptions(screen.getByLabelText('Monday closes AM or PM'), 'AM');
    expect(price('8:00 AM')).toHaveValue(900); expect(price('9:00 AM')).toHaveValue(900); // the new slots
    expect(screen.queryByText(/open slots? ha(s|ve) no price/)).toBeNull();
  });
  it('"Set every slot to" fills one day, or every open day', async () => {
    show(area());
    await userEvent.click(tab('Mon'));
    await userEvent.type(screen.getByLabelText('Price for every slot'), '600'); await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(['6:00 AM', '7:00 AM', '8:00 AM'].map((t) => price(t).value)).toEqual(['600', '600', '600']);
    await userEvent.click(tab('Tue')); expect(price('6:00 AM').value).toBe(''); // only Monday was filled
  });
  it('refuses a closing time that is not after the opening time, and sends nothing', async () => {
    show(area());
    await userEvent.click(tab('Mon'));
    await userEvent.selectOptions(screen.getByLabelText('Monday closes hour'), '5'); // 5 AM, before the 6 AM opening
    await userEvent.click(screen.getByRole('button', { name: 'Save hours & prices' }));
    expect(await screen.findByText(/Monday: closing time must be after opening time/)).toBeInTheDocument(); expect(saved).toEqual([]);
  });
  it('keeps each sport\'s own prices; an empty sport slot shows the all-sports price as a hint', async () => {
    show(area({ pricing: [{ sportId: null, dayType: 'all', dayOfWeek: null, startTime: '06:00', endTime: '09:00', pricePerHour: 500 }] }));
    await userEvent.click(tab('Mon'));
    await userEvent.selectOptions(screen.getByLabelText('Prices for'), '2');
    expect(price('6:00 AM').value).toBe(''); expect(price('6:00 AM').placeholder).toBe('500');
    await type(price('7:00 AM'), '900');
    await userEvent.click(screen.getByRole('button', { name: 'Save hours & prices' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].body.rules.filter((r: any) => r.sportId === 2)).toEqual([{ sportId: 2, dayType: 'all', dayOfWeek: 1, startTime: '07:00', endTime: '08:00', pricePerHour: 900 }]);
    expect(saved[0].body.rules.some((r: any) => r.sportId === null && r.dayOfWeek === 1 && r.pricePerHour === 500)).toBe(true); // the all-sports price is unchanged
  });
});

describe('copying a price', () => {
  it('copy one slot\'s price, then Paste it on another slot', async () => {
    show(area({ availability: days('06:00', '10:00') }));
    await userEvent.click(tab('Mon'));
    await type(price('6:00 AM'), '450');
    await userEvent.click(screen.getByRole('button', { name: 'Copy 6:00 AM price' }));
    expect(screen.getByRole('group', { name: 'Copy price' })).toHaveTextContent('Copied ₹450 from 6:00 AM');
    expect(within(screen.getByRole('list', { name: 'Monday slots' })).getByText('Copied')).toBeInTheDocument(); // the source slot is marked
    await userEvent.click(screen.getByRole('button', { name: 'Paste on 8:00 AM' }));
    expect(['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM'].map((t) => price(t).value)).toEqual(['450', '', '450', '']); // only the slot that was pasted on
    await userEvent.click(screen.getByRole('button', { name: 'Paste on 9:00 AM' })); // the copied price stays ready for more slots
    expect(price('9:00 AM').value).toBe('450');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('group', { name: 'Copy price' })).toBeNull(); expect(screen.queryByRole('button', { name: /^Paste on/ })).toBeNull();
  });
  it('a pasted price is saved with the area', async () => {
    show(area({ availability: days('06:00', '09:00') }));
    await userEvent.click(tab('Mon')); await type(price('6:00 AM'), '450');
    await userEvent.click(screen.getByRole('button', { name: 'Copy 6:00 AM price' })); await userEvent.click(screen.getByRole('button', { name: 'Paste on 7:00 AM' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save hours & prices' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].body.rules.filter((r: any) => r.dayOfWeek === 1)).toEqual([{ sportId: null, dayType: 'all', dayOfWeek: 1, startTime: '06:00', endTime: '08:00', pricePerHour: 450 }]);
  });
  it('"Paste on all slots this day" and "Paste on the slots after it" are shortcuts', async () => {
    show(area({ availability: days('06:00', '10:00') }));
    await userEvent.click(tab('Mon')); await type(price('7:00 AM'), '300');
    await userEvent.click(screen.getByRole('button', { name: 'Copy 7:00 AM price' })); await userEvent.click(screen.getByRole('button', { name: 'Paste on the slots after it' }));
    expect(['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM'].map((t) => price(t).value)).toEqual(['', '300', '300', '300']);
    await userEvent.click(screen.getByRole('button', { name: 'Paste on all slots this day' }));
    expect(['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM'].map((t) => price(t).value)).toEqual(['300', '300', '300', '300']);
  });
  it('can paste the price on the same time on other days', async () => {
    show(area({ availability: days('06:00', '09:00') }));
    await userEvent.click(tab('Mon')); await type(price('7:00 AM'), '350');
    await userEvent.click(screen.getByRole('button', { name: 'Copy 7:00 AM price' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Paste on Wednesday' })); await userEvent.click(screen.getByRole('checkbox', { name: 'Paste on Friday' })); expect(screen.getByRole('checkbox', { name: 'Paste on Friday' })).toBeChecked(); await userEvent.click(screen.getByRole('button', { name: 'Paste on selected days' }));
    for (const d of ['Wed', 'Fri']) { await userEvent.click(tab(d)); expect(price('7:00 AM').value).toBe('350'); expect(price('6:00 AM').value).toBe(''); }
    await userEvent.click(tab('Tue')); expect(price('7:00 AM').value).toBe(''); // only the days that were chosen
  });
  it('the copied price can be pasted onto a slot of another day after switching the tab', async () => {
    show(area({ availability: days('06:00', '09:00') }));
    await userEvent.click(tab('Mon')); await type(price('6:00 AM'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Copy 6:00 AM price' }));
    await userEvent.click(tab('Thu'));
    expect(screen.getByRole('group', { name: 'Copy price' })).toHaveTextContent('from 6:00 AM (Monday)');
    await userEvent.click(screen.getByRole('button', { name: 'Paste on 8:00 AM' }));
    expect(price('8:00 AM').value).toBe('500'); expect(price('6:00 AM').value).toBe('');
  });
  it('a slot with no price cannot be copied yet', async () => {
    show(area());
    await userEvent.click(tab('Mon'));
    expect(screen.getByRole('button', { name: 'Copy 6:00 AM price' })).toBeDisabled();
  });
  it('copies a whole day (opening hours and every price) to other days', async () => {
    show(area({ availability: days('06:00', '09:00') }));
    await userEvent.click(tab('Mon'));
    await userEvent.selectOptions(screen.getByLabelText('Monday closes hour'), '10'); await userEvent.selectOptions(screen.getByLabelText('Monday closes AM or PM'), 'AM');
    await userEvent.type(screen.getByLabelText('Price for every slot'), '400'); await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.click(screen.getByRole('button', { name: /Copy this day to/ }));
    const panel = screen.getByRole('group', { name: 'Copy Monday to' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Weekdays' })); await userEvent.click(within(panel).getByRole('button', { name: 'Copy day' }));
    await userEvent.click(tab('Thu'));
    expect(slotTimes('Thursday')).toEqual(['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM']); // Thursday now closes at 10 like Monday
    expect(['6:00 AM', '9:00 AM'].map((t) => price(t).value)).toEqual(['400', '400']);
    await userEvent.click(tab('Sat')); expect(slotTimes('Saturday')).toHaveLength(3); // weekend untouched
  });
});

describe('the Hours & pricing button label', () => {
  it('says how many days are open and how many slots still need a price', () => {
    expect(scheduleStatus(area({ pricing: [] }))).toEqual({ label: 'Hours & pricing (7 days open, 21 slots unpriced)', warn: true });
    expect(scheduleStatus(area({ pricing: [{ sportId: null, dayType: 'all', dayOfWeek: null, startTime: '06:00', endTime: '09:00', pricePerHour: 500 }] }))).toEqual({ label: 'Hours & pricing (7 days open)', warn: false });
    expect(scheduleStatus(area({ availability: [], pricing: [] }))).toEqual({ label: 'Hours & pricing (not set)', warn: true });
    expect(scheduleStatus(area({ availability: days('06:00', '09:00', [0, 6]), pricing: [{ sportId: null, dayType: 'weekday', dayOfWeek: null, startTime: '06:00', endTime: '09:00', pricePerHour: 500 }] })).label).toBe('Hours & pricing (5 days open)');
  });
});
