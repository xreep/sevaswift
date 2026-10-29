import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Job, JobStatus } from '../../types';
import { errorMessage, jobsApi } from '../../services/api';
import { useSocketEvent } from '../../contexts/SocketContext';
import { EmptyState, ErrorNotice, PageHeader, PriorityTag, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { duration, formatDateTime } from '../../lib/format';

type Tab = 'OPEN' | 'EXPIRED' | 'COMPLETED' | 'CANCELLED' | 'ALL';
const TABS: { value: Tab; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'EXPIRED', label: 'Needs assignment' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All recent' },
];

export default function AdminJobs() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = (TABS.find(t => t.value === params.get('tab'))?.value ?? 'OPEN') as Tab;
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const query =
        tab === 'OPEN' ? { active: true } : tab === 'ALL' ? {} : { status: tab as JobStatus };
      setJobs(await jobsApi.list({ ...query, limit: 100 }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tab]);

  useEffect(() => {
    setJobs(null);
    load();
  }, [load]);

  useSocketEvent('job:status', () => load());

  const needle = q.trim().toLowerCase();
  const shown = (jobs ?? []).filter(
    j =>
      !needle ||
      [j.service.name, j.customer.name, j.technician?.name ?? '', j.location.address, j.id]
        .join(' ')
        .toLowerCase()
        .includes(needle)
  );

  return (
    <div>
      <PageHeader title="Jobs" subtitle="Every request, its dispatch outcome and timings." />
      <Tabs<Tab> value={tab} onChange={v => setParams({ tab: v })} options={TABS} />
      <div className="mb-4 max-w-sm">
        <label htmlFor="job-search" className="sr-only">Search jobs</label>
        <input id="job-search" className="field" placeholder="Search customer, technician, address" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {error && <ErrorNotice message={error} onRetry={load} />}
      {!jobs ? (
        <div className="py-12 text-center"><Spinner /></div>
      ) : shown.length === 0 ? (
        <EmptyState title={tab === 'EXPIRED' ? 'Nothing waiting for assignment' : 'No jobs here'} />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>Request</th>
                <th>Customer</th>
                <th>Technician</th>
                <th>Status</th>
                <th>Raised</th>
                <th>Time to assign</th>
                <th>Rounds</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(j => (
                <tr key={j.id} className="cursor-pointer hover:bg-paper" onClick={() => navigate(`/jobs/${j.id}`)}>
                  <td>
                    <Link to={`/jobs/${j.id}`} className="font-semibold hover:underline" onClick={e => e.stopPropagation()}>
                      {j.service.icon} {j.service.name}
                    </Link>{' '}
                    <PriorityTag priority={j.priority} />
                    <span className="block max-w-[16rem] truncate text-xs text-ink-muted">{j.location.address}</span>
                  </td>
                  <td>{j.customer.name}</td>
                  <td>{j.technician?.name ?? <span className="text-ink-muted">—</span>}</td>
                  <td><StatusBadge status={j.status} role="ADMIN" /></td>
                  <td className="num whitespace-nowrap">{formatDateTime(j.createdAt)}</td>
                  <td className="num">{duration(j.responseTimeSecs)}</td>
                  <td className="num">{j.dispatchRounds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
