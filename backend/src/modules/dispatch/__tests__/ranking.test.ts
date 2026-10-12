import { rankCandidates } from '../ranking';
import { estimateMinutes, haversineKm } from '@/common/geo/index';

const base = { straightKm: 1, distanceKm: 1, etaMinutes: 5, ratingAvg: 4 };

describe('rankCandidates', () => {
  it('puts the fastest arrival first', () => {
    const ranked = rankCandidates(
      [
        { ...base, technicianId: 'slow', etaMinutes: 12 },
        { ...base, technicianId: 'fast', etaMinutes: 4 },
      ],
      15
    );
    expect(ranked.map(c => c.technicianId)).toEqual(['fast', 'slow']);
  });

  it('breaks ETA ties by rating, then distance, then id', () => {
    const ranked = rankCandidates(
      [
        { ...base, technicianId: 'c', ratingAvg: 4.0, distanceKm: 2 },
        { ...base, technicianId: 'b', ratingAvg: 4.0, distanceKm: 1 },
        { ...base, technicianId: 'a', ratingAvg: 4.8, distanceKm: 3 },
        { ...base, technicianId: 'd', ratingAvg: 4.0, distanceKm: 1 },
      ],
      15
    );
    expect(ranked.map(c => c.technicianId)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('drops technicians outside the radius', () => {
    const ranked = rankCandidates(
      [
        { ...base, technicianId: 'in', straightKm: 14.9 },
        { ...base, technicianId: 'out', straightKm: 15.1 },
      ],
      15
    );
    expect(ranked.map(c => c.technicianId)).toEqual(['in']);
  });
});

describe('geo helpers', () => {
  it('computes known distances', () => {
    // Connaught Place to India Gate, Delhi: ~2.4 km.
    const km = haversineKm({ lat: 28.6315, lng: 77.2167 }, { lat: 28.6129, lng: 77.2295 });
    expect(km).toBeGreaterThan(2.2);
    expect(km).toBeLessThan(2.6);
  });

  it('estimates whole minutes with a 1 minute floor', () => {
    expect(estimateMinutes(10, 25)).toBe(24);
    expect(estimateMinutes(0.01, 25)).toBe(1);
  });
});
