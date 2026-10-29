import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Marker, Polyline, Popup } from 'react-leaflet';
import type { Candidate, Job, Role } from '../types';
import { adminApi, errorMessage, jobsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useJobRoom, useSocketEvent } from '../contexts/SocketContext';
import { useOptionalTechnician } from '../contexts/TechnicianContext';
import { useToast } from '../contexts/ToastContext';
import { useNow } from '../hooks/useNow';
import { BaseMap, FitBounds, homeIcon, techIcon } from '../components/map/Map';
import { RouteStrip, Timeline } from '../components/JobProgress';
import {
  ErrorNotice,
  Modal,
  PageLoader,
  PriorityTag,
  Spinner,
  StarInput,
  Stars,
  StatusBadge,
} from '../components/ui';
import {
  CANCELLABLE,
  duration,
  formatDateTime,
  formatTime,
  rating,
  rupees,
  statusLabel,
  timeAgo,
} from '../lib/format';
import { directionsUrl } from '../lib/geo';

type NextStatus = 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED';
const NEXT_STEP: Partial<Record<Job['status'], { to: NextStatus; label: string }>> = {
  ACCEPTED: { to: 'EN_ROUTE', label: 'Start driving to customer' },
  EN_ROUTE: { to: 'ARRIVED', label: 'I have arrived' },
  ARRIVED: { to: 'IN_PROGRESS', label: 'Start the work' },
  IN_PROGRESS: { to: 'COMPLETED', label: 'Mark job completed' },
};

/** The live-tracking page, shared by the customer, the technician and admins. */
export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const role: Role = user?.role ?? 'CUSTOMER';
  const toast = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setJob(await jobsApi.get(id));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load this job'));
    }
  }, [id]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 30000);
    return () => window.clearInterval(poll);
  }, [load]);

  useJobRoom(id);

  useSocketEvent<{ jobId: string; to: Job['status'] }>('job:status', e => {
    if (e.jobId !== id) return;
    if (role === 'CUSTOMER') {
      const messages: Partial<Record<Job['status'], string>> = {
        ACCEPTED: 'A technician accepted your request.',
        EN_ROUTE: 'Your technician is on the way.',
        ARRIVED: 'Your technician has arrived.',
        COMPLETED: 'Job completed. Please rate the service.',
        EXPIRED: 'No technician accepted yet. Our team will assign one.',
      };
      if (messages[e.to]) toast(messages[e.to] as string, e.to === 'EXPIRED' ? 'error' : 'success');
    }
    load();
  });

  useSocketEvent<{ jobId: string; lat: number; lng: number; at: string; eta: Job['eta'] }>(
    'job:location',
    e => {
      if (e.jobId !== id) return;
      setJob(j =>
        j && j.technician
          ? {
              ...j,
              eta: e.eta,
              technician: {
                ...j.technician,
                location: { lat: e.lat, lng: e.lng, updatedAt: e.at },
              },
            }
          : j
      );
    }
  );

  if (error && !job) {
    return (
      <div className="space-y-4">
        <ErrorNotice message={error} onRetry={load} />
        <Link to="/" className="btn-secondary">Back home</Link>
      </div>
    );
  }
  if (!job) return <PageLoader />;

  const searching = job.status === 'CREATED' || job.status === 'MATCHED';
  const techPos = job.technician?.location ?? null;
  const points = [job.location, ...(techPos ? [techPos] : [])];
  const isAssignedTech = role === 'TECHNICIAN' && job.technician?.id === user?.id;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} role={role} />
            <PriorityTag priority={job.priority} />
          </div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            {job.service.icon} {job.service.name}
          </h1>
          <p className="text-sm text-ink-muted">
            Raised {formatDateTime(job.createdAt)}
            {role !== 'CUSTOMER' && <> by {job.customer.name}</>}
          </p>
        </div>
        <CancelButton job={job} role={role} onDone={setJob} />
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <section className="panel p-5">
            {searching ? (
              <Searching job={job} role={role} />
            ) : job.status === 'EXPIRED' ? (
              <Unassigned role={role} />
            ) : job.status === 'CANCELLED' ? (
              <p className="text-ink-soft">
                This request was cancelled{job.cancelledAt && <> at {formatTime(job.cancelledAt)}</>}.
              </p>
            ) : (
              <>
                <EtaReadout job={job} />
                <div className="mt-6">
                  <RouteStrip job={job} />
                </div>
              </>
            )}
          </section>

          <BaseMap center={job.location} className="h-[22rem] lg:h-[26rem]">
            <FitBounds points={points} />
            <Marker position={[job.location.lat, job.location.lng]} icon={homeIcon(job.priority === 'URGENT')}>
              <Popup>{job.location.address}</Popup>
            </Marker>
            {techPos && (
              <>
                <Marker position={[techPos.lat, techPos.lng]} icon={techIcon(isAssignedTech ? 'self' : 'busy')}>
                  <Popup>{job.technician?.name}</Popup>
                </Marker>
                {(job.status === 'ACCEPTED' || job.status === 'EN_ROUTE') && (
                  <Polyline
                    positions={[
                      [techPos.lat, techPos.lng],
                      [job.location.lat, job.location.lng],
                    ]}
                    pathOptions={{ color: '#17202B', weight: 3, dashArray: '6 8' }}
                  />
                )}
              </>
            )}
          </BaseMap>

          {isAssignedTech && <TechnicianActions job={job} onChange={setJob} />}
          {role === 'ADMIN' && (job.status === 'EXPIRED' || job.status === 'MATCHED') && (
            <AssignPanel job={job} onAssigned={setJob} />
          )}
          {role === 'CUSTOMER' && job.status === 'COMPLETED' && !job.review && (
            <ReviewForm job={job} onDone={setJob} />
          )}
        </div>

        <aside className="space-y-5">
          <PeoplePanel job={job} role={role} />

          <section className="panel p-5">
            <h2 className="font-display text-xl font-semibold">Request details</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-ink-muted">Address</dt>
                <dd>{job.location.address}</dd>
              </div>
              {job.description && (
                <div>
                  <dt className="text-ink-muted">Problem</dt>
                  <dd className="whitespace-pre-line">{job.description}</dd>
                </div>
              )}
              <div className="flex gap-6">
                <div>
                  <dt className="text-ink-muted">Visit fee</dt>
                  <dd>{rupees(job.service.baseFee)}</dd>
                </div>
                {job.responseTimeSecs != null && (
                  <div>
                    <dt className="text-ink-muted">Assigned in</dt>
                    <dd className="num">{duration(job.responseTimeSecs)}</dd>
                  </div>
                )}
              </div>
            </dl>
            {job.photoUrls.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {job.photoUrls.map(url => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="Issue photo" className="h-20 w-20 rounded-panel border border-line object-cover" />
                  </a>
                ))}
              </div>
            )}
            {job.review && (
              <div className="mt-4 border-t border-line pt-3 text-sm">
                <p className="text-ink-muted">Customer rating</p>
                <Stars value={job.review.rating} />
                {job.review.comment && <p className="mt-1">“{job.review.comment}”</p>}
              </div>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="mb-3 font-display text-xl font-semibold">Status log</h2>
            <Timeline job={job} role={role} />
          </section>

          {role === 'ADMIN' && job.dispatchLog && job.dispatchLog.length > 0 && (
            <section className="panel p-5">
              <h2 className="mb-3 font-display text-xl font-semibold">Dispatch log</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Technician</th>
                    <th>Distance</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {job.dispatchLog.map(o => (
                    <tr key={`${o.round}-${o.offeredAt}`}>
                      <td className="num">{o.round}</td>
                      <td>{o.technicianName}</td>
                      <td className="num">{o.distanceKm} km, ~{o.etaMinutes} min</td>
                      <td>
                        {o.status.charAt(0) + o.status.slice(1).toLowerCase()}
                        {o.respondedAt && (
                          <span className="block text-xs text-ink-muted">
                            after {duration((new Date(o.respondedAt).getTime() - new Date(o.offeredAt).getTime()) / 1000)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function EtaReadout({ job }: { job: Job }) {
  const now = useNow(15000);
  const travelling = job.status === 'ACCEPTED' || job.status === 'EN_ROUTE';
  if (job.status === 'COMPLETED') {
    return (
      <div>
        <p className="text-sm text-ink-muted">Completed at {formatTime(job.completedAt)}</p>
        <p className="font-display text-5xl font-bold text-go">Done</p>
      </div>
    );
  }
  if (!travelling) {
    return (
      <div>
        <p className="text-sm text-ink-muted">Technician on site</p>
        <p className="font-display text-5xl font-bold">{statusLabel(job.status)}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm text-ink-muted">Estimated arrival</p>
        <p className="num font-display text-7xl font-bold leading-none tracking-tight">
          {job.eta ? job.eta.minutes : '—'}
          <span className="ml-1 text-3xl font-semibold">min</span>
        </p>
      </div>
      <div className="text-right text-sm text-ink-muted">
        {job.eta && <p className="num">{job.eta.distanceKm} km away</p>}
        <p>Location updated {timeAgo(job.technician?.location?.updatedAt, now)}</p>
      </div>
    </div>
  );
}

function Searching({ job, role }: { job: Job; role: Role }) {
  return (
    <div className="flex items-start gap-4">
      <span className="live-dot mt-1 h-4 w-4 shrink-0 rounded-full bg-signal" aria-hidden />
      <div>
        <p className="font-display text-3xl font-semibold">Finding the nearest technician</p>
        <p className="mt-1 text-ink-soft">
          {job.dispatchRounds > 0
            ? `Offer ${job.dispatchRounds} sent to the closest available technician. If they don't accept within a minute, the next closest gets it.`
            : 'Checking who is available near you.'}
        </p>
        {role === 'ADMIN' && job.offer && (
          <p className="mt-2 text-sm text-ink-muted">
            Current offer expires {formatTime(job.offer.expiresAt)} ({job.offer.distanceKm} km away).
          </p>
        )}
      </div>
    </div>
  );
}

function Unassigned({ role }: { role: Role }) {
  return (
    <div>
      <p className="font-display text-3xl font-semibold text-alert">
        {role === 'ADMIN' ? 'Needs manual assignment' : 'No technician has accepted yet'}
      </p>
      <p className="mt-1 text-ink-soft">
        {role === 'ADMIN'
          ? 'Auto-dispatch ran out of available technicians. Pick one below.'
          : 'Everyone nearby is busy right now. Our operations team has been alerted and will assign a technician manually. You can also cancel.'}
      </p>
    </div>
  );
}

function PeoplePanel({ job, role }: { job: Job; role: Role }) {
  const tech = job.technician;
  return (
    <section className="panel p-5">
      {role !== 'TECHNICIAN' && (
        <div>
          <h2 className="font-display text-xl font-semibold">Your technician</h2>
          {tech ? (
            <div className="mt-3 flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink font-display text-xl font-semibold text-white">
                {tech.name.charAt(0)}
              </span>
              <div className="flex-1">
                <p className="font-semibold">{tech.name}</p>
                <p className="text-sm text-ink-muted">
                  <span className="text-signal">★</span> {rating(tech.ratingAvg)} ({tech.ratingCount} ratings),{' '}
                  {tech.completedJobs} {tech.completedJobs === 1 ? 'job' : 'jobs'} done
                </p>
              </div>
              {tech.phone && (
                <a href={`tel:${tech.phone}`} className="btn-secondary">
                  Call
                </a>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Assigned automatically once someone accepts.</p>
          )}
        </div>
      )}
      {role !== 'CUSTOMER' && (
        <div className={role === 'ADMIN' ? 'mt-5 border-t border-line pt-4' : ''}>
          <h2 className="font-display text-xl font-semibold">Customer</h2>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-semibold">{job.customer.name}</p>
            {job.customer.phone && (
              <a href={`tel:${job.customer.phone}`} className="btn-secondary">
                Call
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function CancelButton({ job, role, onDone }: { job: Job; role: Role; onDone: (j: Job) => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (role === 'TECHNICIAN' || !CANCELLABLE.includes(job.status)) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      onDone(await jobsApi.cancel(job.id, reason.trim() || undefined));
      toast('Request cancelled.', 'info');
      setOpen(false);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-danger" onClick={() => setOpen(true)}>
        Cancel request
      </button>
      <Modal open={open} title="Cancel this request?" onClose={() => setOpen(false)}>
        <p className="text-sm text-ink-soft">
          {job.technician
            ? `${job.technician.name} will be told to stop. You can raise a new request any time.`
            : 'We will stop looking for a technician.'}
        </p>
        <label htmlFor="cancel-reason" className="label mt-4">Reason (optional)</label>
        <input
          id="cancel-reason"
          className="field"
          maxLength={300}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Fixed it myself"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            Keep request
          </button>
          <button className="btn-danger" onClick={confirm} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Cancel request'}
          </button>
        </div>
      </Modal>
    </>
  );
}

function TechnicianActions({ job, onChange }: { job: Job; onChange: (j: Job) => void }) {
  const toast = useToast();
  const tech = useOptionalTechnician();
  const [busy, setBusy] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const step = NEXT_STEP[job.status];
  const travelling = job.status === 'ACCEPTED' || job.status === 'EN_ROUTE';

  const advance = async (to: NextStatus) => {
    setBusy(true);
    try {
      const updated = await jobsApi.setStatus(job.id, to);
      onChange(updated);
      if (to === 'ARRIVED') tech?.stopDrive();
      if (to === 'COMPLETED') {
        toast('Job completed. You are free for the next one.', 'success');
        tech?.reload();
      }
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
      setConfirmDone(false);
    }
  };

  if (!step) return null;

  return (
    <section className="panel border-l-4 border-l-signal p-5">
      <h2 className="font-display text-2xl font-semibold">Next step</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className={`${step.to === 'COMPLETED' ? 'btn-go' : 'btn-primary'} px-6 py-3 text-base`}
          disabled={busy}
          onClick={() => (step.to === 'COMPLETED' ? setConfirmDone(true) : advance(step.to))}
        >
          {busy ? <Spinner className="h-4 w-4" /> : step.label}
        </button>
        {travelling && (
          <a
            className="btn-secondary px-5 py-3"
            href={directionsUrl(job.location, tech?.position)}
            target="_blank"
            rel="noreferrer"
          >
            Open navigation
          </a>
        )}
      </div>
      {travelling && tech && (
        <div className="mt-4 rounded-panel bg-paper p-3 text-sm">
          <p className="font-semibold">Demo: simulate the drive</p>
          <p className="text-ink-muted">
            Moves your position towards the customer every 2 seconds (sped up), so the customer's
            live map and ETA update as if you were driving.
          </p>
          <button
            className="btn-secondary mt-2"
            onClick={() => (tech.simulating ? tech.stopDrive() : tech.startDrive(job.location))}
          >
            {tech.simulating ? 'Stop simulated drive' : 'Simulate drive to customer'}
          </button>
        </div>
      )}
      <Modal open={confirmDone} title="Mark the job completed?" onClose={() => setConfirmDone(false)}>
        <p className="text-sm text-ink-soft">
          Confirm the issue is fixed and the customer is satisfied. The customer will be asked to rate the service.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setConfirmDone(false)}>
            Not yet
          </button>
          <button className="btn-go" onClick={() => advance('COMPLETED')} disabled={busy}>
            Mark completed
          </button>
        </div>
      </Modal>
    </section>
  );
}

function ReviewForm({ job, onDone }: { job: Job; onDone: (j: Job) => void }) {
  const toast = useToast();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stars) {
      toast('Choose a rating from 1 to 5 stars.', 'error');
      return;
    }
    setBusy(true);
    try {
      onDone(await jobsApi.review(job.id, { rating: stars, comment: comment.trim() || undefined }));
      toast('Thanks for the feedback.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel border-l-4 border-l-signal p-5">
      <h2 className="font-display text-2xl font-semibold">How did {job.technician?.name ?? 'it'} do?</h2>
      <div className="mt-3">
        <StarInput value={stars} onChange={setStars} />
      </div>
      <label htmlFor="review-comment" className="label mt-4">Comment (optional)</label>
      <textarea
        id="review-comment"
        rows={2}
        maxLength={1000}
        className="field"
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="What went well, what could be better?"
      />
      <button className="btn-primary mt-3" disabled={busy}>
        {busy ? <Spinner className="h-4 w-4" /> : 'Submit rating'}
      </button>
    </form>
  );
}

function AssignPanel({ job, onAssigned }: { job: Job; onAssigned: (j: Job) => void }) {
  const toast = useToast();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCandidates(await adminApi.candidates(job.id));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [job.id]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async (c: Candidate) => {
    setBusyId(c.id);
    try {
      onAssigned(await adminApi.assign(job.id, c.id));
      toast(`Assigned to ${c.name}.`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
      load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="panel p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-semibold">Assign manually</h2>
        <button className="text-sm font-semibold text-route hover:underline" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Verified technicians with this skill, nearest first.
        {job.status === 'MATCHED' && ' Assigning withdraws the open offer.'}
      </p>
      {error && <div className="mt-3"><ErrorNotice message={error} onRetry={load} /></div>}
      {!candidates ? (
        <div className="py-6 text-center"><Spinner /></div>
      ) : candidates.length === 0 ? (
        <p className="mt-3 text-sm">No verified technician has this skill yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Distance</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c.id}>
                  <td>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-xs text-ink-muted">
                      ★ {rating(c.ratingAvg)}, {c.completedJobs} {c.completedJobs === 1 ? 'job' : 'jobs'} done
                    </p>
                  </td>
                  <td className="num">{c.distanceKm} km<span className="block text-xs text-ink-muted">~{c.etaMinutes} min</span></td>
                  <td className="text-xs">
                    {c.busy ? 'On a job' : c.hasOtherOffer ? 'Answering an offer' : c.isOnline ? 'Online, free' : 'Offline'}
                  </td>
                  <td className="text-right">
                    <button
                      className="btn-primary px-3 py-1.5"
                      disabled={!c.assignable || !!busyId}
                      onClick={() => assign(c)}
                    >
                      {busyId === c.id ? <Spinner className="h-4 w-4" /> : 'Assign'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
