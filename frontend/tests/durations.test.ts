import { describe, expect, it } from 'vitest';
import { bookableDurations, DURATIONS } from '../src/lib/utils';

describe('booking lengths a customer can pick', () => {
  const area = (slot: number, min: number, max: number) => ({ slot_minutes: slot, min_duration_minutes: min, max_duration_minutes: max });
  it('are 30 minutes, then 1 to 5 hours', () => { expect([...DURATIONS]).toEqual([30, 60, 120, 180, 240, 300]); });
  it('an area with 30-minute slots up to 5 hours offers every standard length', () => { expect(bookableDurations(area(30, 30, 300))).toEqual([30, 60, 120, 180, 240, 300]); });
  it('never offers 1.5 hours, and stays within the area\'s shortest and longest booking', () => { expect(bookableDurations(area(30, 30, 180))).toEqual([30, 60, 120, 180]); });
  it('hourly slots start at 1 hour; 2-hour slots offer only whole 2-hour steps', () => {
    expect(bookableDurations(area(60, 60, 300))).toEqual([60, 120, 180, 240, 300]);
    expect(bookableDurations(area(120, 120, 300))).toEqual([120, 240]);
  });
  it('keeps an unusual older setup working', () => { expect(bookableDurations(area(30, 90, 90))).toEqual([90]); });
});
