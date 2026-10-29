import type { LatLng } from '../types';

export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Moves `stepKm` from `from` straight towards `to`, stopping at `to`. */
export function stepTowards(from: LatLng, to: LatLng, stepKm: number): LatLng {
  const total = distanceKm(from, to);
  if (total <= stepKm || total === 0) return { ...to };
  const f = stepKm / total;
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
}

export const directionsUrl = (to: LatLng, from?: LatLng | null) =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lng}` : ''}&destination=${to.lat},${to.lng}&travelmode=driving`;

/** Default map centre (New Delhi) when nothing better is known. */
export const DEFAULT_CENTER: LatLng = { lat: 28.6139, lng: 77.209 };

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
}

/** Address search via OpenStreetMap Nominatim (free, rate-limited: call on submit only). */
export async function searchAddress(query: string): Promise<(LatLng & { label: string })[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=in&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Address search is unavailable right now');
  const places = (await res.json()) as NominatimPlace[];
  return places.map(p => ({ lat: Number(p.lat), lng: Number(p.lon), label: p.display_name }));
}

export async function reverseGeocode(point: LatLng): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${point.lat}&lon=${point.lng}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { display_name?: string };
    return body.display_name ?? null;
  } catch {
    return null;
  }
}

/** One-shot browser GPS fix. */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser cannot share its location'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Allow it in the browser, or set the location on the map.'
              : 'Could not get your location. Try again or set it on the map.'
          )
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}
