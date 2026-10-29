import { useEffect, useState } from 'react';
import { reverseGeocode } from '../lib/geo';

// Shared across the app: Nominatim asks for at most one request per second.
const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

function lookup(lat: number, lng: number): Promise<string | null> {
  // ~110 m cells: close enough for a place name, and repeat positions hit the cache.
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = queue.then(() => reverseGeocode({ lat, lng }));
    queue = hit.then(() => new Promise(r => setTimeout(r, 1100)));
    cache.set(key, hit);
  }
  return hit;
}

/** Short place name ("Connaught Place, New Delhi") for a coordinate; null while unknown. */
export function usePlaceName(lat: number | null | undefined, lng: number | null | undefined) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (lat == null || lng == null) {
      setName(null);
      return;
    }
    let alive = true;
    lookup(lat, lng).then(full => {
      if (!alive) return;
      // Keep the most specific two or three parts of Nominatim's long label.
      setName(full ? full.split(',').slice(0, 3).map(p => p.trim()).join(', ') : null);
    });
    return () => {
      alive = false;
    };
  }, [lat == null ? null : lat.toFixed(3), lng == null ? null : lng.toFixed(3)]); // eslint-disable-line react-hooks/exhaustive-deps
  return name;
}
