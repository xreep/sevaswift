import { describe, expect, it } from 'vitest';
import { directionsUrl, distanceKm, stepTowards } from './geo';

const CP = { lat: 28.6315, lng: 77.2167 };
const INDIA_GATE = { lat: 28.6129, lng: 77.2295 };

describe('geo helpers', () => {
  it('measures great-circle distance', () => {
    expect(distanceKm(CP, CP)).toBe(0);
    expect(distanceKm(CP, INDIA_GATE)).toBeCloseTo(2.4, 1);
  });

  it('steps towards a target without overshooting', () => {
    const next = stepTowards(CP, INDIA_GATE, 0.5);
    expect(distanceKm(CP, next)).toBeCloseTo(0.5, 2);
    expect(distanceKm(next, INDIA_GATE)).toBeLessThan(distanceKm(CP, INDIA_GATE));
    expect(stepTowards(CP, INDIA_GATE, 10)).toEqual(INDIA_GATE);
  });

  it('builds a driving directions link', () => {
    expect(directionsUrl(INDIA_GATE, CP)).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=28.6315,77.2167&destination=28.6129,77.2295&travelmode=driving'
    );
    expect(directionsUrl(INDIA_GATE)).not.toContain('origin=');
  });
});
