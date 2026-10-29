import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Job, Service } from '../../types';
import { availabilityApi, errorMessage, jobsApi, servicesApi, type Availability } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useSocketEvent } from '../../contexts/SocketContext';
import JobCard from '../../components/JobCard';
import { HERO_PHOTO, servicePhoto } from '../../lib/images';
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
      <section className="grid items-center gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
        <div className="order-2 lg:order-1">
          <p className="text-ink-muted">Hello {firstName}</p>
          <h1 className="mt-1 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
            Something broken at home? Help is a tap away.
          </h1>
          <p className="mt-4 max-w-md text-lg text-ink-soft">
            Tell us what happened and where. The nearest free, verified technician with the right
            skill is assigned automatically, usually within a minute.
          </p>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
            <Link to="/customer/request" className="btn-signal px-7 py-4 text-lg">
              Request help now
            </Link>
            {fleet && fleet.onDuty > 0 && (
              <p className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="live-dot h-2.5 w-2.5 rounded-full bg-go" aria-hidden />
                <span>
                  <span className="num font-semibold text-ink">{fleet.available}</span> technicians free right now
                </span>
              </p>
            )}
          </div>
        </div>
        <div className="order-1 -mx-4 overflow-hidden sm:mx-0 sm:rounded-2xl lg:order-2">
          <img
            src={HERO_PHOTO.src}
            srcSet={`${HERO_PHOTO.small} 720w, ${HERO_PHOTO.src} 1220w`}
            sizes="(min-width: 1024px) 55vw, 100vw"
            alt="A technician with a tool bag arriving at a customer's apartment door"
            className="aspect-[16/10] w-full object-cover object-[70%_center]"
            fetchPriority="high"
          />
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
          <p className="text-sm text-ink-muted">Pick one to start. The visit fee is paid to the technician.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {services.map(s => {
            const photo = servicePhoto(s.id);
            return (
              <Link key={s.id} to={`/customer/request?service=${s.id}`} className="group block">
                <span className="block overflow-hidden rounded-xl bg-paper">
                  {photo ? (
                    <img
                      src={photo}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={800}
                      height={600}
                      className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="flex aspect-[4/3] w-full items-center justify-center text-ink-soft">
                      <ServiceIcon service={s} className="h-10 w-10" />
                    </span>
                  )}
                </span>
                <span className="mt-2 block font-semibold leading-tight group-hover:underline">{s.name}</span>
                <span className="text-sm text-ink-muted">Visit fee {rupees(s.baseFee)}</span>
              </Link>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-ink-muted">Photos are illustrative.</p>
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
