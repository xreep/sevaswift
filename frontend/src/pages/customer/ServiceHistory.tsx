import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Job } from '../../types';
import { errorMessage, jobsApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import JobCard from '../../components/JobCard';
import { EmptyState, ErrorNotice, PageHeader, PageLoader, Stat, Tabs } from '../../components/ui';
import { OPEN_STATUSES, duration } from '../../lib/format';

type Filter = 'all' | 'open' | 'completed' | 'cancelled';

/** Every request the user has raised (customer) or worked (technician), newest first. */
export default function ServiceHistory() {
  const { user } = useAuth();
  const role = user?.role ?? 'CUSTOMER';
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      setJobs(await jobsApi.list({ limit: 100 }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const list = jobs ?? [];
    return {
      all: list,
      open: list.filter(j => OPEN_STATUSES.includes(j.status)),
      completed: list.filter(j => j.status === 'COMPLETED'),
      cancelled: list.filter(j => j.status === 'CANCELLED' || j.status === 'EXPIRED'),
    };
  }, [jobs]);

  if (error && !jobs) return <ErrorNotice message={error} onRetry={load} />;
  if (!jobs) return <PageLoader />;

  const responseTimes = jobs.map(j => j.responseTimeSecs).filter((s): s is number => s != null);
  const avgResponse = responseTimes.length
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null;
  const rated = jobs.filter(j => j.review);

  return (
    <div>
      <PageHeader
        title={role === 'TECHNICIAN' ? 'My jobs' : 'Service history'}
        subtitle={role === 'TECHNICIAN' ? 'Jobs you have been assigned.' : 'Every request you have raised.'}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Requests" value={jobs.length} />
        <Stat label="Completed" value={groups.completed.length} tone="go" />
        <Stat label="Average time to assign" value={duration(avgResponse)} />
        <Stat
          label={role === 'TECHNICIAN' ? 'Average rating received' : 'Average rating given'}
          value={rated.length ? (rated.reduce((a, j) => a + (j.review?.rating ?? 0), 0) / rated.length).toFixed(1) : '—'}
          tone="signal"
        />
      </div>
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All', count: groups.all.length },
          { value: 'open', label: 'Open', count: groups.open.length },
          { value: 'completed', label: 'Completed', count: groups.completed.length },
          { value: 'cancelled', label: 'Cancelled or unassigned', count: groups.cancelled.length },
        ]}
      />
      {groups[filter].length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <div className="grid gap-3">
          {groups[filter].map(job => (
            <JobCard key={job.id} job={job} role={role} />
          ))}
        </div>
      )}
    </div>
  );
}
