import { usePlaceName } from '../hooks/usePlaceName';
import { useNow } from '../hooks/useNow';
import { timeAgo } from '../lib/format';

/** Locations older than this are shown as stale (matches the server's dispatch rule). */
export const STALE_MS = 10 * 60_000;

/**
 * A position everyone can check: place name, exact coordinates and, for a
 * technician, how fresh it is. Hidden coordinates made the 29 Oct dispatch
 * failure impossible to debug.
 */
export default function LocationLine({
  lat,
  lng,
  updatedAt,
  label,
}: {
  lat: number;
  lng: number;
  updatedAt?: string | null;
  label?: string;
}) {
  const place = usePlaceName(lat, lng);
  const now = useNow(30000);
  const age = updatedAt ? now - new Date(updatedAt).getTime() : null;
  const stale = updatedAt !== undefined && (age === null || age > STALE_MS);

  return (
    <div className="text-sm">
      {label && <p className="text-ink-muted">{label}</p>}
      <p className="font-medium">{place ?? 'Looking up place…'}</p>
      <p className="num text-xs text-ink-muted">
        {lat.toFixed(5)}, {lng.toFixed(5)}
        {updatedAt !== undefined && (
          <span className={stale ? 'ml-1 font-semibold text-alert' : 'ml-1'}>
            — {stale ? 'stale, ' : ''}updated {timeAgo(updatedAt ?? null, now)}
          </span>
        )}
      </p>
    </div>
  );
}
