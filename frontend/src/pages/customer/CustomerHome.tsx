import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Job, Service } from '../../types';
import { errorMessage, jobsApi, servicesApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSocketEvent } from '../../contexts/SocketContext';
import JobCard from '../../components/JobCard';
import { EmptyState, ErrorNotice, PageLoader } from '../../components/ui';
import { rupees } from '../../lib/format';

export default function CustomerHome() {
  const { user } = useAuth();
  const [active, setActive] = useState<Job[] | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [open, past, catalog] = await Promise.all([
        jobsApi.list({ active: true }),
        jobsApi.list({ active: false, limit: 3 }),
        servicesApi.list(),
      ]);
      setActive(open);
      setRecent(past);
      setServices(catalog);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent('job:status', () => load());

  if (error && !active) return <ErrorNotice message={error} onRetry={load} />;
  if (!active) return <PageLoader />;

  const firstName = user?.name.split(' ')[0];

  return (
    <div className="space-y-8">
      <section className="panel overflow-hidden">
        <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-ink-muted">Hello {firstName}</p>
            <h1 className="mt-1 font-display text-4xl font-semibold leading-tight sm:text-5xl">
              Something broken at home?
            </h1>
            <p className="mt-2 max-w-xl text-ink-soft">
              Tell us what happened and where. The nearest available technician with the right
              skills is assigned automatically, usually within a minute.
            </p>
          </div>
          <Link to="/customer/request" className="btn-signal px-6 py-4 text-lg">
            Request emergency help
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">Happening now</h2>
        {active.length === 0 ? (
          <EmptyState
            title="No open requests"
            body="When you raise a request it appears here with live status and the technician's location."
          />
        ) : (
          <div className="grid gap-3">
            {active.map(job => (
              <JobCard key={job.id} job={job} role="CUSTOMER" />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">What we fix</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {services.map(s => (
            <Link
              key={s.id}
              to={`/customer/request?service=${s.id}`}
              className="panel p-4 hover:border-ink-muted"
            >
              <span className="text-2xl" aria-hidden>{s.icon}</span>
              <p className="mt-2 font-semibold leading-tight">{s.name}</p>
              <p className="text-sm text-ink-muted">Visit from {rupees(s.baseFee)}</p>
            </Link>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-semibold">Recent</h2>
            <Link to="/customer/history" className="text-sm font-semibold text-route hover:underline">
              Full history
            </Link>
          </div>
          <div className="grid gap-3">
            {recent.map(job => (
              <JobCard key={job.id} job={job} role="CUSTOMER" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
