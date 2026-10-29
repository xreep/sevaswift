import { Link } from 'react-router-dom';
import type { Job, Role } from '../types';
import { duration, formatDateTime } from '../lib/format';
import { PriorityTag, StatusBadge, Stars } from './ui';

/** One request in a list: what, where, when and where it stands. */
export default function JobCard({ job, role }: { job: Job; role: Role }) {
  const counterpart =
    role === 'TECHNICIAN' ? job.customer.name : job.technician ? job.technician.name : null;
  return (
    <Link
      to={`/jobs/${job.id}`}
      className="panel flex flex-col gap-3 p-4 hover:border-ink-muted sm:flex-row sm:items-center"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-panel bg-paper text-2xl" aria-hidden>
        {job.service.icon ?? '🛠'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{job.service.name}</p>
          <PriorityTag priority={job.priority} />
        </div>
        <p className="truncate text-sm text-ink-muted">{job.location.address}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {formatDateTime(job.createdAt)}
          {counterpart && <> — {role === 'TECHNICIAN' ? 'for' : 'with'} {counterpart}</>}
          {job.responseTimeSecs != null && <> — assigned in {duration(job.responseTimeSecs)}</>}
        </p>
      </div>
      <div className="flex items-center gap-3 sm:flex-col sm:items-end">
        <StatusBadge status={job.status} role={role} />
        {job.review && <Stars value={job.review.rating} />}
      </div>
    </Link>
  );
}
