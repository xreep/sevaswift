import { describe, expect, it } from 'vitest';
import { duration, homeFor, minutes, percent, rupees, statusLabel, timeAgo } from './format';

describe('format helpers', () => {
  it('formats durations compactly', () => {
    expect(duration(null)).toBe('—');
    expect(duration(42)).toBe('42s');
    expect(duration(60)).toBe('1m');
    expect(duration(106)).toBe('1m 46s');
    expect(duration(3 * 3600 + 5 * 60)).toBe('3h 5m');
  });

  it('formats minutes, percentages and paise', () => {
    expect(minutes(7.4)).toBe('7 min');
    expect(minutes(90)).toBe('1h 30m');
    expect(percent(0.813)).toBe('81%');
    expect(percent(null)).toBe('—');
    expect(rupees(49900)).toBe('₹499');
  });

  it('names statuses the way each role talks about them', () => {
    expect(statusLabel('ACCEPTED')).toBe('Assigned');
    expect(statusLabel('EN_ROUTE')).toBe('On the way');
    expect(statusLabel('EXPIRED', 'CUSTOMER')).toBe('No technician available');
    expect(statusLabel('EXPIRED', 'ADMIN')).toBe('Needs assignment');
    expect(statusLabel('MATCHED', 'TECHNICIAN')).toBe('New offer');
  });

  it('sends every role to its own home', () => {
    expect(homeFor('CUSTOMER')).toBe('/customer');
    expect(homeFor('TECHNICIAN')).toBe('/technician');
    expect(homeFor('ADMIN')).toBe('/admin');
    expect(homeFor(undefined)).toBe('/customer');
  });

  it('describes recency', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-10-29T09:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-29T09:50:00Z', now)).toBe('10 min ago');
  });
});
