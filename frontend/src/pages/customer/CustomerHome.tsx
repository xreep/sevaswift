import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Job, Service } from '../../types';
import { availabilityApi, errorMessage, jobsApi, servicesApi, type Availability } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSocketEvent } from '../../contexts/SocketContext';
import JobCard from '../../components/JobCard';
import RouteMotif from '../../components/RouteMotif';
import ServiceIcon from '../../components/ServiceIcon';
import { ErrorNotice, PageLoader } from '../../components/ui';
import { rupees } from '../../lib/format';

export default function CustomerHome() {
  const { user } = useAuth();
  const [active, setActive] = useState<Job[] | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [fleet, setFleet] = useState<Availability | null>(null);
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
    // The fleet count is a nice-to-have; the page works without it.
    availabilityApi.get().then(setFleet).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent('job:status', () => load());

  if (error && !active) return <ErrorNotice message={error} onRetry={load} />;
  if (!active) return <PageLoader />;

  const firstName = user?.name.split(' ')[0];

  return (
    <div className="space-y-10">
      <section className="relative -mx-4 -mt-6 overflow-hidden bg-ink text-white sm:mx-0 sm:mt-0 sm:rounded-[10px]">
        <div className="grid items-center gap-6 p-6 sm:p-10 lg:grid-cols-[1.15fr_1fr]">
          <div className="relative z-10">
            <p className="text-white/60">Hello {firstName}</p>
            <h1 className="mt-2 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl">
              Something broken
              <br />
              at home?
            </h1>
            <p className="mt-4 max-w-md text-lg text-white/75">
              Tell us what happened and where. The nearest free technician with the right skill is
              assigned automatically, usually within a minute.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <Link to="/customer/request" className="btn-signal px-7 py-4 text-lg">
                Request emergency help
              </Link>
              {fleet && fleet.onDuty > 0 && (
                <p className="flex items-center gap-2 text-sm text-white/80">
                  <span className="live-dot h-2.5 w-2.5 rounded-full bg-signal" aria-hidden />
                  <span>
                    <span className="num font-semibold text-white">{fleet.onDuty}</span> technicians on duty,{' '}
                    <span className="num font-semibold text-white">{fleet.available}</span> free right now
                  </span>
                </p>
              )}
            </div>
          </div>
          <RouteMotif className="pointer-events-none mx-auto hidden w-full max-w-md lg:block" />
        </div>
      </section>

      {active.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl font-semibold">Happening now</h2>
          <div className="grid gap-3">
            {active.map(job => (
              <JobCard key={job.id} job={job} role="CUSTOMER" />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-semibold">What we fix</h2>
          <p className="text-sm text-ink-muted">Pick one to start a request. Visit fee is paid to the technician.</p>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
          {services.map(s => (
            <Link
              key={s.id}
              to={`/customer/request?service=${s.id}`}
              className="group flex flex-col gap-3 bg-white p-4 transition-colors hover:bg-signal-soft sm:p-5"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-paper text-ink transition-colors group-hover:bg-signal">
                <ServiceIcon service={s} />
              </span>
              <span>
                <span className="block font-semibold leading-tight">{s.name}</span>
                <span className="text-sm text-ink-muted">from {rupees(s.baseFee)}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { n: 1, t: 'Tell us the problem', b: 'Choose the service, drop a pin and add a photo if it helps.' },
          { n: 2, t: 'We dispatch instantly', b: 'The closest free, verified technician gets it. If they can’t, the next one does.' },
          { n: 3, t: 'Track to your door', b: 'Watch them on the map with a live ETA, then rate the job.' },
        ].map(step => (
          <div key={step.n} className="flex gap-4">
            <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink font-display text-lg font-bold">
              {step.n}
            </span>
            <div>
              <p className="font-semibold">{step.t}</p>
              <p className="text-sm text-ink-muted">{step.b}</p>
            </div>
          </div>
        ))}
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
