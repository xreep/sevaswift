import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleMarker, Marker, Popup } from 'react-leaflet';
import type { AdminOverview as Overview, JobStatus, LiveJob, LiveTechnician } from '../../types';
import { adminApi, errorMessage } from '../../services/api';
import { useSocketEvent } from '../../contexts/SocketContext';
import { useNow } from '../../hooks/useNow';
import { BaseMap, FitBounds, homeIcon, techIcon } from '../../components/map/Map';
import { ErrorNotice, PageHeader, PageLoader, PriorityTag, Stat, StatusBadge } from '../../components/ui';
import { DEFAULT_CENTER } from '../../lib/geo';
import { ACTIVE_STATUSES, duration, formatTime, statusLabel, timeAgo } from '../../lib/format';

interface FeedItem {
  key: string;
  jobId: string;
  to: JobStatus;
  at: string;
}

type Layer = 'all' | 'available' | 'busy' | 'offline';

/** The operations room: fleet and demand on one live map, with what needs attention. */
export default function AdminOverview() {
  const now = useNow(15000);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [technicians, setTechnicians] = useState<LiveTechnician[]>([]);
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>('all');
  const pending = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, live] = await Promise.all([adminApi.overview(), adminApi.live()]);
      setOverview(o);
      setTechnicians(live.technicians);
      setJobs(live.jobs);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  /** Coalesces bursts of events into one refetch. */
  const scheduleLoad = useCallback(() => {
    if (pending.current) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      load();
    }, 800);
  }, [load]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60000);
    return () => {
      window.clearInterval(id);
      if (pending.current) window.clearTimeout(pending.current);
    };
  }, [load]);

  useSocketEvent<{ jobId: string; from: JobStatus | null; to: JobStatus; at: string }>('job:status', e => {
    setFeed(f => [{ key: `${e.jobId}-${e.to}-${e.at}`, jobId: e.jobId, to: e.to, at: e.at }, ...f].slice(0, 30));
    scheduleLoad();
  });

  useSocketEvent<{ technicianId: string; lat: number; lng: number; at: string }>('technician:location', e => {
    setTechnicians(list => {
      if (!list.some(t => t.id === e.technicianId)) {
        scheduleLoad();
        return list;
      }
      return list.map(t => (t.id === e.technicianId ? { ...t, lat: e.lat, lng: e.lng, locationUpdatedAt: e.at } : t));
    });
  });

  useSocketEvent<{ technicianId: string; isOnline: boolean }>('technician:availability', e => {
    setTechnicians(list => list.map(t => (t.id === e.technicianId ? { ...t, isOnline: e.isOnline } : t)));
    scheduleLoad();
  });

  if (error && !overview) return <ErrorNotice message={error} onRetry={load} />;
  if (!overview) return <PageLoader />;

  const stateOf = (t: LiveTechnician) => (!t.isOnline ? 'offline' : t.activeJobId ? 'busy' : 'available');
  const shownTechs = technicians.filter(t => layer === 'all' || stateOf(t) === layer);
  const openJobs = jobs.filter(j => j.status !== 'EXPIRED');
  const needsAssignment = jobs.filter(j => j.status === 'EXPIRED');
  const jobName = (id: string) => jobs.find(j => j.id === id)?.service.name ?? 'Job';
  const points = [...shownTechs, ...jobs];

  return (
    <div className="space-y-6">
      <PageHeader title="Live operations" subtitle="Technicians and open requests update in real time." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Technicians available" value={overview.technicians.available} hint={`${overview.technicians.online} online`} tone="go" />
        <Stat label="On a job" value={overview.technicians.busy} tone="signal" />
        <Stat label="Open requests" value={overview.jobs.open} />
        <Stat
          label="Need assignment"
          value={overview.jobs.awaitingAssignment}
          tone={overview.jobs.awaitingAssignment > 0 ? 'alert' : 'default'}
          hint={overview.jobs.awaitingAssignment > 0 ? <Link className="font-semibold text-alert underline" to="/admin/jobs?tab=EXPIRED">Assign now</Link> : 'All covered'}
        />
        <Stat label="Avg time to assign, 24 h" value={duration(overview.jobs.avgResponseSecsLast24h)} hint={`${overview.jobs.last24h} requests, ${overview.jobs.completedLast24h} completed`} />
        <Stat
          label="Pending verification"
          value={overview.technicians.pendingVerification}
          hint={overview.technicians.pendingVerification > 0 ? <Link className="font-semibold text-route underline" to="/admin/technicians">Review</Link> : `${overview.technicians.verified} verified`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <section className="panel p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <Legend color="#1E8E5A" label={`Available (${technicians.filter(t => stateOf(t) === 'available').length})`} />
              <Legend color="#FFB000" label={`On a job (${technicians.filter(t => stateOf(t) === 'busy').length})`} />
              <Legend color="#9AA4B2" label={`Offline (${technicians.filter(t => stateOf(t) === 'offline').length})`} />
              <Legend color="#17202B" square label={`Requests (${jobs.length})`} />
            </div>
            <label className="text-sm">
              <span className="sr-only">Show technicians</span>
              <select className="field py-1" value={layer} onChange={e => setLayer(e.target.value as Layer)}>
                <option value="all">All technicians</option>
                <option value="available">Available only</option>
                <option value="busy">On a job only</option>
                <option value="offline">Offline only</option>
              </select>
            </label>
          </div>
          <BaseMap center={DEFAULT_CENTER} zoom={11} className="h-[30rem]">
            <FitBounds points={points.length ? points : [DEFAULT_CENTER]} maxZoom={13} />
            {shownTechs.map(t => (
              <Marker key={t.id} position={[t.lat, t.lng]} icon={techIcon(stateOf(t))}>
                <Popup>
                  <p className="font-semibold">{t.name}</p>
                  <p>{t.skills.join(', ')}</p>
                  <p>★ {t.ratingAvg.toFixed(1)}, seen {timeAgo(t.locationUpdatedAt, now)}</p>
                  {t.activeJobId && <Link to={`/jobs/${t.activeJobId}`}>Open current job</Link>}
                </Popup>
              </Marker>
            ))}
            {jobs.map(j => (
              <Marker key={j.id} position={[j.lat, j.lng]} icon={homeIcon(j.priority === 'URGENT' || j.status === 'EXPIRED')}>
                <Popup>
                  <p className="font-semibold">{j.service.icon} {j.service.name}</p>
                  <p>{statusLabel(j.status, 'ADMIN')}, {j.customerName}</p>
                  <Link to={`/jobs/${j.id}`}>Open job</Link>
                </Popup>
              </Marker>
            ))}
            {jobs
              .filter(j => j.status === 'CREATED' || j.status === 'MATCHED')
              .map(j => (
                <CircleMarker key={`r-${j.id}`} center={[j.lat, j.lng]} radius={22} pathOptions={{ color: '#FFB000', weight: 2, fillOpacity: 0.08 }} />
              ))}
          </BaseMap>
        </section>

        <div className="space-y-5">
          <section className="panel p-4">
            <h2 className="font-display text-xl font-semibold">Needs attention</h2>
            {needsAssignment.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Every request has a technician or is being dispatched.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {needsAssignment.map(j => (
                  <li key={j.id} className="py-2">
                    <Link to={`/jobs/${j.id}`} className="block hover:underline">
                      <span className="font-semibold">{j.service.name}</span>{' '}
                      <PriorityTag priority={j.priority} />
                      <span className="block text-xs text-ink-muted">{j.customerName}, raised {timeAgo(j.createdAt, now)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel p-4">
            <h2 className="font-display text-xl font-semibold">Open requests</h2>
            {openJobs.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No open requests right now.</p>
            ) : (
              <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto">
                {openJobs.map(j => (
                  <li key={j.id} className="flex items-center justify-between gap-2 py-2">
                    <Link to={`/jobs/${j.id}`} className="min-w-0 hover:underline">
                      <span className="block truncate text-sm font-semibold">{j.service.icon} {j.service.name}</span>
                      <span className="block text-xs text-ink-muted">{timeAgo(j.createdAt, now)}</span>
                    </Link>
                    <StatusBadge status={j.status} role="ADMIN" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel p-4">
            <h2 className="font-display text-xl font-semibold">Live feed</h2>
            {feed.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Status changes appear here as they happen.</p>
            ) : (
              <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                {feed.map(f => (
                  <li key={f.key} className="flex gap-3 text-sm">
                    <span className="num w-16 shrink-0 text-xs text-ink-muted">{formatTime(f.at)}</span>
                    <Link to={`/jobs/${f.jobId}`} className="hover:underline">
                      {jobName(f.jobId)}:{' '}
                      <span className={ACTIVE_STATUSES.includes(f.to) || f.to === 'COMPLETED' ? 'font-semibold' : f.to === 'EXPIRED' ? 'font-semibold text-alert' : ''}>
                        {statusLabel(f.to, 'ADMIN')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 ${square ? 'rounded-sm' : 'rounded-full'}`} style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
