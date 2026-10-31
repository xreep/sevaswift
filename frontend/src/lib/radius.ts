/** "15 km, then 25 km, then 40 km": the search steps, optionally only up to `upTo`. */
export function searchSteps(steps: number[], upTo?: number): string {
  const shown = upTo === undefined ? steps : steps.filter(km => km <= upTo);
  return (shown.length ? shown : steps).map(km => `${km} km`).join(', then ');
}

/** The furthest automatic dispatch looks; beyond it only an admin can assign. */
export function maxStep(steps: number[]): number {
  return steps[steps.length - 1];
}
