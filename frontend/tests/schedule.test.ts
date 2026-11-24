import { describe, expect, it } from 'vitest';
import { buildPrices, fmtSlot, rateFor, slotStarts, toRules, unpricedCount, type Day, type Rule } from '../src/lib/schedule';

const day = (dayOfWeek: number, openTime = '06:00', closeTime = '10:00', isClosed = false): Day => ({ dayOfWeek, openTime, closeTime, isClosed });
const week = (o = '06:00', c = '10:00') => Array.from({ length: 7 }, (_, d) => day(d, o, c));
const rule = (o: Partial<Rule>): Rule => ({ sportId: null, dayType: 'all', dayOfWeek: null, startTime: '06:00', endTime: '10:00', pricePerHour: 800, ...o });

describe('slots between opening and closing', () => {
  it('lists every whole slot from opening to closing, and none for a closed day', () => {
    expect(slotStarts(day(1, '06:00', '09:00'), 60)).toEqual([360, 420, 480]);
    expect(slotStarts(day(1, '06:00', '08:00'), 30)).toEqual([360, 390, 420, 450]);
    expect(slotStarts(day(1, '06:00', '08:30'), 60)).toEqual([360, 420]); // a half slot at the end is not a slot
    expect(slotStarts(day(1, '06:00', '09:00', true), 60)).toEqual([]);
  });
  it('writes times in 12-hour form', () => { expect(fmtSlot(360)).toBe('6:00 AM'); expect(fmtSlot(720)).toBe('12:00 PM'); expect(fmtSlot(0)).toBe('12:00 AM'); expect(fmtSlot(23 * 60 + 30)).toBe('11:30 PM'); });
});

describe('saved rules to the slot grid', () => {
  it('turns an hourly rate into the price of one slot (a 30-minute slot costs half the hourly rate)', () => {
    const p = buildPrices([rule({ pricePerHour: 800 })], week('06:00', '08:00'), ['all'], 30);
    expect(p.all[1]).toEqual({ 360: 400, 390: 400, 420: 400, 450: 400 });
    expect(buildPrices([rule({ pricePerHour: 800 })], week('06:00', '08:00'), ['all'], 60).all[1]).toEqual({ 360: 800, 420: 800 });
  });
  it('gives the most specific rule: one weekday beats weekday/weekend beats every day', () => {
    const rules = [rule({ pricePerHour: 100 }), rule({ dayType: 'weekday', pricePerHour: 200 }), rule({ dayOfWeek: 1, pricePerHour: 300 })];
    const p = buildPrices(rules, week('06:00', '07:00'), ['all'], 60).all;
    expect(p[1][360]).toBe(300); expect(p[2][360]).toBe(200); expect(p[0][360]).toBe(100);
  });
  it('leaves slots without a matching rule unpriced, and keeps each sport\'s own prices apart', () => {
    const rules = [rule({ startTime: '06:00', endTime: '08:00', pricePerHour: 500 }), rule({ sportId: 5, pricePerHour: 900 })];
    const p = buildPrices(rules, week('06:00', '10:00'), ['all', 5], 60);
    expect(p.all[1]).toEqual({ 360: 500, 420: 500 }); // 8 to 10 has no price
    expect(p['5'][1]).toEqual({ 360: 900, 420: 900, 480: 900, 540: 900 });
    expect(rateFor(rules, 'all', 1, 8 * 60)).toBeNull();
    expect(unpricedCount(p, week('06:00', '10:00'), 60)).toBe(7 * 2); // two unpriced slots on each of the 7 days
  });
});

describe('the slot grid back to rules', () => {
  it('joins neighbouring slots with the same price into one rule, and starts a new rule when the price changes', () => {
    const prices = { all: { 1: { 360: 500, 420: 500, 480: 700, 540: 700 } } };
    expect(toRules(prices, [day(1)], 60)).toEqual([
      { sportId: null, dayType: 'all', dayOfWeek: 1, startTime: '06:00', endTime: '08:00', pricePerHour: 500 },
      { sportId: null, dayType: 'all', dayOfWeek: 1, startTime: '08:00', endTime: '10:00', pricePerHour: 700 }]);
  });
  it('skips slots with no price, so there is a gap in the rules and the slot stays unpriced', () => {
    const rules = toRules({ all: { 1: { 360: 500, 480: 500 } } }, [day(1)], 60);
    expect(rules.map((r) => [r.startTime, r.endTime])).toEqual([['06:00', '07:00'], ['08:00', '09:00']]);
  });
  it('turns a slot price back into an hourly rate', () => {
    expect(toRules({ all: { 1: { 360: 400, 390: 400 } } }, [day(1, '06:00', '07:00')], 30)[0]).toMatchObject({ startTime: '06:00', endTime: '07:00', pricePerHour: 800 });
  });
  it('writes nothing for closed days or for slots outside the opening hours', () => {
    const rules = toRules({ all: { 1: { 360: 500, 1200: 900 }, 2: { 360: 500 } } }, [day(1, '06:00', '07:00'), day(2, '06:00', '07:00', true)], 60);
    expect(rules).toHaveLength(1); expect(rules[0].dayOfWeek).toBe(1);
  });
  it('is lossless: saved rules to a grid and back give the same prices for every slot', () => {
    const rules = [rule({ startTime: '06:00', endTime: '08:00', pricePerHour: 500 }), rule({ startTime: '08:00', endTime: '10:00', dayType: 'weekend', pricePerHour: 700 }), rule({ sportId: 5, dayOfWeek: 3, pricePerHour: 1000 })];
    const days = week('06:00', '10:00'); const back = toRules(buildPrices(rules, days, ['all', 5], 60), days, 60);
    for (const sc of ['all', 5] as const) for (let d = 0; d < 7; d++) for (const m of [360, 420, 480, 540]) expect(rateFor(back, sc, d, m)).toBe(rateFor(rules, sc, d, m));
  });
});
