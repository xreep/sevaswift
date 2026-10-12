import { config } from '../../config/index';
import type { LatLng } from '../../common/geo/index';
import { estimateMinutes, haversineKm } from '../../common/geo/index';

export interface TravelEstimate {
  distanceKm: number;
  etaMinutes: number;
  source: 'road' | 'straight-line';
}

const ORS_MATRIX_URL = 'https://api.openrouteservice.org/v2/matrix/driving-car';
const ORS_TIMEOUT_MS = 2500;

function straightLine(from: LatLng, to: LatLng): TravelEstimate {
  const distanceKm = haversineKm(from, to);
  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    etaMinutes: estimateMinutes(distanceKm, config.dispatch.averageSpeedKmph),
    source: 'straight-line',
  };
}

async function roadMatrix(
  origins: LatLng[],
  destination: LatLng
): Promise<(TravelEstimate | null)[]> {
  const res = await fetch(ORS_MATRIX_URL, {
    method: 'POST',
    headers: { Authorization: config.orsApiKey as string, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [[destination.lng, destination.lat], ...origins.map(o => [o.lng, o.lat])],
      sources: origins.map((_, i) => i + 1),
      destinations: [0],
      metrics: ['distance', 'duration'],
      units: 'km',
    }),
    signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OpenRouteService responded ${res.status}`);
  }
  const body = (await res.json()) as {
    durations?: (number | null)[][];
    distances?: (number | null)[][];
  };
  return origins.map((_, i) => {
    const seconds = body.durations?.[i]?.[0];
    const km = body.distances?.[i]?.[0];
    if (seconds == null || km == null) return null;
    return {
      distanceKm: Math.round(km * 100) / 100,
      etaMinutes: Math.max(1, Math.ceil(seconds / 60)),
      source: 'road',
    };
  });
}

/**
 * Travel estimates from each origin to the destination, in the same order.
 * Uses OpenRouteService road times when a key is configured; any failure falls
 * back to a straight-line estimate so dispatch never blocks on the maps API.
 */
export async function estimateTravel(
  origins: LatLng[],
  destination: LatLng
): Promise<TravelEstimate[]> {
  if (origins.length === 0) return [];
  if (config.orsApiKey) {
    try {
      const road = await roadMatrix(origins, destination);
      return origins.map((o, i) => road[i] ?? straightLine(o, destination));
    } catch (err) {
      console.warn('[dispatch] Road travel times unavailable, using straight-line estimate:', err);
    }
  }
  return origins.map(o => straightLine(o, destination));
}
