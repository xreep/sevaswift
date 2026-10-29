import type { Job, JobStatus, Role } from '../types';
import { formatTime, statusLabel } from '../lib/format';

const STOPS: { status: JobStatus; label: string }[] = [
  { status: 'ACCEPTED', label: 'Assigned' },
  { status: 'EN_ROUTE', label: 'On the way' },
  { status: 'ARRIVED', label: 'Arrived' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'COMPLETED', label: 'Completed' },
];
const ORDER: JobStatus[] = STOPS.map(s => s.status);

/** When each stop was reached, from the job's status history. */
function reachedAt(job: Job, status: JobStatus) {
  return job.timeline.find(t => t.to === status)?.at ?? null;
}

/**
 * The tracking page's centrepiece: a road with five stops. Stops behind the
 * current status are filled, the current one carries the live marker.
 */
export function RouteStrip({ job }: { job: Job }) {
  const current = ORDER.indexOf(job.status);
  const searching = job.status === 'CREATED' || job.status === 'MATCHED';
  const stopped = job.status === 'CANCELLED' || job.status === 'EXPIRED';

  return (
    <ol className="relative grid grid-cols-5 gap-0" aria-label="Job progress">
      <div className="absolute left-[10%] right-[10%] top-[13px] h-1.5 rounded-full bg-[repeating-linear-gradient(90deg,#DCE1E7_0_10px,transparent_10px_16px)]" aria-hidden />
      {current > 0 && (
        <div
          className="absolute left-[10%] top-[13px] h-1.5 rounded-full bg-ink transition-[width] duration-700"
          style={{ width: `${(current / (STOPS.length - 1)) * 80}%` }}
          aria-hidden
        />
      )}
      {STOPS.map((stop, i) => {
        const done = current >= 0 && i < current;
        const here = i === current;
        const at = reachedAt(job, stop.status);
        return (
          <li key={stop.status} className="relative flex flex-col items-center text-center">
            <span
              className={`num z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold ${
                here
                  ? job.status === 'COMPLETED'
                    ? 'border-go bg-go text-white'
                    : 'live-dot border-signal bg-signal text-ink'
                  : done
                    ? 'border-ink bg-ink text-white'
                    : 'border-line bg-white text-ink-muted'
              }`}
              aria-current={here ? 'step' : undefined}
            >
              {done || (here && job.status === 'COMPLETED') ? '✓' : i + 1}
            </span>
            <span className={`mt-2 text-xs font-semibold sm:text-sm ${here ? 'text-ink' : 'text-ink-muted'}`}>
              {stop.label}
            </span>
            <span className="num text-[11px] text-ink-muted">{at ? formatTime(at) : searching || stopped ? '' : '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Timeline({ job, role }: { job: Job; role: Role }) {
  return (
    <ol className="space-y-3">
      {[...job.timeline].reverse().map((entry, i) => (
        <li key={`${entry.at}-${i}`} className="flex gap-3">
          <span className="num w-16 shrink-0 pt-0.5 text-xs text-ink-muted">{formatTime(entry.at)}</span>
          <div>
            <p className="text-sm font-semibold">{statusLabel(entry.to, role)}</p>
            {entry.note && <p className="text-sm text-ink-muted">{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
