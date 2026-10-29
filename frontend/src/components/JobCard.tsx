import { Link } from 'react-router-dom';
import type { Job, Role } from '../types';
import { duration, formatDateTime } from '../lib/format';
import { PriorityTag, StatusBadge, Stars } from './ui';
import ServiceIcon from './ServiceIcon';

// The left edge shows where a job stands at a glance: amber while help is on its way.
const stripe: Record<Job['status'], string> = {
  CREATED: 'border-l-signal',
  MATCHED: 'border-l-signal',
  ACCEPTED: 'border-l-signal',
  EN_ROUTE: 'border-l-signal',
  ARRIVED: 'border-l-route',
  IN_PROGRESS: 'border-l-route',
  COMPLETED: 'border-l-go',
  CANCELLED: 'border-l-line',
  EXPIRED: 'border-l-alert',
};

/** One request in a list: what, where, when and where it stands. */
export default function JobCard({ job, role }: { job: Job; role: Role }) {
  const counterpart =
    role === 'TECHNICIAN' ? job.customer.name : job.technician ? job.technician.name : null;
  return (
    <Link
      to={`/jobs/${job.id}`}
      className={`panel flex flex-col gap-3 border-l-4 p-4 transition-colors hover:border-ink-muted sm:flex-row sm:items-center ${stripe[job.status]}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-panel bg-paper text-ink" aria-hidden>
        <ServiceIcon service={job.service} />
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
