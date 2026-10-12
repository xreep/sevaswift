export interface RankableCandidate {
  technicianId: string;
  /** Straight-line distance from the job, used for the dispatch radius. */
  straightKm: number;
  /** Travel distance and time (by road when available, otherwise straight-line estimate). */
  distanceKm: number;
  etaMinutes: number;
  ratingAvg: number;
}

/**
 * Orders candidates for an offer: fastest arrival first, then higher rating,
 * then shorter distance, then id for a stable, deterministic result.
 * Candidates outside the radius are dropped.
 */
export function rankCandidates<T extends RankableCandidate>(
  candidates: T[],
  radiusKm: number
): T[] {
  return candidates
    .filter(c => c.straightKm <= radiusKm)
    .sort(
      (a, b) =>
        a.etaMinutes - b.etaMinutes ||
        b.ratingAvg - a.ratingAvg ||
        a.distanceKm - b.distanceKm ||
        a.technicianId.localeCompare(b.technicianId)
    );
}
