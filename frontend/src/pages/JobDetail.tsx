import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Marker, Polyline, Popup } from 'react-leaflet';
import axios from 'axios';
import type { ApiError, AssignmentGuard, Candidate, DispatchAttempt, Job, Role } from '../types';
import { adminApi, errorCode, errorMessage, jobsApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useJobRoom, useSocketEvent } from '../contexts/SocketContext';
import { useOptionalTechnician } from '../contexts/TechnicianContext';
import { useToast } from '../contexts/ToastContext';
import { useNow } from '../hooks/useNow';
import { BaseMap, FitBounds, homeIcon, techIcon } from '../components/map/Map';
import { RouteStrip, Timeline } from '../components/JobProgress';
import LocationLine from '../components/LocationLine';
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
import { maxStep, searchSteps } from '../lib/radius';
import ServiceIcon from '../components/ServiceIcon';

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

  // An offer was made or closed, or the search widened.
  useSocketEvent<{ jobId: string }>('job:dispatch', e => {
    if (e.jobId === id) load();
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
            <ServiceIcon service={job.service} className="mr-2 inline h-9 w-9 align-[-5px]" />
            {job.service.name}
          </h1>
          <p className="text-sm text-ink-muted">
            Raised {formatDateTime(job.createdAt)}
            {role !== 'CUSTOMER' && <> by {job.customer.name}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CancelButton job={job} role={role} onDone={setJob} />
          {role === 'ADMIN' && <DeleteJobButton job={job} />}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <section className="panel p-5">
            {searching ? (
              <Searching job={job} role={role} />
            ) : job.status === 'EXPIRED' ? (
              <Unassigned
                role={role}
                radiusKm={job.dispatch.radiusKm}
                steps={job.dispatch.radiusStepsKm}
                asked={job.dispatch.offersMade}
              />
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
                <dd className="mt-1">
                  <LocationLine lat={job.location.lat} lng={job.location.lng} />
                </dd>
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

          {role === 'ADMIN' && <DispatchLogPanel job={job} />}
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
  const now = useNow(1000);
  const offer = job.dispatch.currentOffer;
  const left = offer ? Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - now) / 1000)) : 0;
  const waited = Math.max(0, Math.round((now - new Date(job.createdAt).getTime()) / 1000));
  const widened = job.dispatch.widened[job.dispatch.widened.length - 1];
  const furthest = maxStep(job.dispatch.radiusStepsKm);

  return (
    <div className="flex items-start gap-4">
      <span className="live-dot mt-1 h-4 w-4 shrink-0 rounded-full bg-signal" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-display text-3xl font-semibold">Finding the nearest technician</p>
        {offer ? (
          <p className="mt-1 text-ink-soft">
            Asked <span className="font-semibold text-ink">{offer.technicianName}</span>,{' '}
            <span className="num">{offer.distanceKm} km</span> away (about {offer.etaMinutes} min).
            Waiting for their answer:{' '}
            <span className="num font-semibold text-ink">0:{String(left).padStart(2, '0')}</span>
          </p>
        ) : (
          <p className="mt-1 text-ink-soft">Checking who is free near you.</p>
        )}
        <p className="mt-2 text-sm text-ink-muted">
          Searching within {job.dispatch.radiusKm} km
          {widened && <> (widened at {formatTime(widened.at)} because nobody closer was free)</>}
          {job.dispatch.radiusKm < furthest && <>; widens up to {furthest} km if nobody accepts</>}.
          {job.dispatch.offersMade > 0 && <> {job.dispatch.offersMade} {job.dispatch.offersMade === 1 ? 'technician' : 'technicians'} asked so far.</>}{' '}
          Waiting {duration(waited)}.
        </p>
        {offer && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <div
              className="h-full bg-signal transition-[width] duration-1000 ease-linear"
              style={{
                width: `${(left / Math.max(1, (new Date(offer.expiresAt).getTime() - new Date(offer.offeredAt).getTime()) / 1000)) * 100}%`,
              }}
            />
          </div>
        )}
        {role === 'ADMIN' && offer && (
          <p className="mt-2 text-xs text-ink-muted">
            If they do not answer in time, the next nearest free technician within {furthest} km is asked. If there is
            nobody within {furthest} km, the job comes back to the admin queue.
          </p>
        )}
      </div>
    </div>
  );
}

function Unassigned({
  role,
  radiusKm,
  steps,
  asked,
}: {
  role: Role;
  radiusKm: number;
  steps: number[];
  asked: number;
}) {
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
      <p className="mt-2 text-sm text-ink-muted">
        We searched within {searchSteps(steps, radiusKm)}
        {asked > 0 ? ` and asked ${asked} ${asked === 1 ? 'technician' : 'technicians'}` : ''}.
        {role === 'ADMIN' && ` Auto-dispatch never offers a job beyond ${maxStep(steps)} km.`}
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
      {tech?.location && (
        <div className="mt-4 border-t border-line pt-3">
          <LocationLine
            lat={tech.location.lat}
            lng={tech.location.lng}
            updatedAt={tech.location.updatedAt}
            label={role === 'TECHNICIAN' ? 'Your location' : "Technician's location"}
          />
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

const DELETABLE: Job['status'][] = ['COMPLETED', 'CANCELLED', 'EXPIRED'];

function DeleteJobButton({ job }: { job: Job }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!DELETABLE.includes(job.status)) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await adminApi.deleteJob(job.id);
      toast('Job deleted.', 'info');
      navigate('/admin/jobs');
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        Delete job
      </button>
      <Modal open={open} title="Delete this job permanently?" onClose={() => setOpen(false)}>
        <p className="text-sm text-ink-soft">
          The request, its status log, dispatch log and any rating are removed for everyone. The technician's
          completed-job count and rating are recalculated. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            Keep job
          </button>
          <button className="btn-danger" onClick={confirm} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Delete job'}
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
  // Set when the server says "arrived" is far from the customer's pin: km, or null if unknown.
  const [farArrival, setFarArrival] = useState<{ distanceKm: number | null } | null>(null);
  const step = NEXT_STEP[job.status];
  const travelling = job.status === 'ACCEPTED' || job.status === 'EN_ROUTE';

  const advance = async (to: NextStatus, confirmFar?: boolean) => {
    setBusy(true);
    try {
      const updated = await jobsApi.setStatus(job.id, to, confirmFar);
      onChange(updated);
      setFarArrival(null);
      if (to === 'ARRIVED') tech?.stopDrive();
      if (to === 'COMPLETED') {
        toast('Job completed. You are free for the next one.', 'success');
        tech?.reload();
      }
    } catch (err) {
      if (errorCode(err) === 'ARRIVAL_CONFIRMATION_REQUIRED') {
        const details = axios.isAxiosError(err)
          ? (err.response?.data as ApiError | undefined)?.details
          : undefined;
        setFarArrival({ distanceKm: details?.distanceKm ?? null });
      } else {
        toast(errorMessage(err), 'error');
      }
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
      <Modal open={!!farArrival} title="Are you at the customer?" onClose={() => setFarArrival(null)}>
        <p className="text-sm text-ink-soft">
          {farArrival?.distanceKm != null ? (
            <>
              Your last shared location is <span className="num font-semibold text-ink">{farArrival.distanceKm} km</span>{' '}
              from the customer's pin.
            </>
          ) : (
            'We do not have your current location.'
          )}{' '}
          Only mark arrived if you are at the door. If you confirm, the status log will record the distance.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setFarArrival(null)}>
            Not yet
          </button>
          <button className="btn-primary" onClick={() => advance('ARRIVED', true)} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'I am here, mark arrived'}
          </button>
        </div>
      </Modal>
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

const OUTCOME_LABEL: Record<DispatchAttempt['outcome'], string> = {
  OFFERED: 'Offer sent',
  NO_CANDIDATES: 'Nobody free',
  RADIUS_EXPANDED: 'Search widened',
  EXHAUSTED: 'Sent to admin queue',
  MANUAL_OFFER: 'Admin sent offer',
  MANUAL_ASSIGN: 'Admin assigned',
};

/** Every dispatch decision with the technicians considered and why each was passed over. */
function DispatchLogPanel({ job }: { job: Job }) {
  const [open, setOpen] = useState<number | null>(null);
  const attempts = job.dispatchAttempts ?? [];
  const offers = job.dispatchLog ?? [];

  return (
    <section className="panel p-5">
      <h2 className="font-display text-xl font-semibold">Dispatch log</h2>
      <p className="text-sm text-ink-muted">
        {job.dispatchRounds} {job.dispatchRounds === 1 ? 'offer' : 'offers'} made; current radius {job.dispatch.radiusKm} km.
      </p>
      {attempts.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No dispatch attempts recorded for this job.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {attempts.map((a, i) => (
            <li key={`${a.at}-${i}`} className="rounded-panel border border-line p-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="font-semibold">{OUTCOME_LABEL[a.outcome]}</span>{' '}
                  <span className="text-ink-muted">within {a.radiusKm} km</span>
                </p>
                <span className="num text-xs text-ink-muted">{formatTime(a.at)}</span>
              </div>
              {a.note && <p className="text-ink-soft">{a.note}</p>}
              {a.candidates.length > 0 && (
                <>
                  <button className="mt-1 text-xs font-semibold text-route hover:underline" onClick={() => setOpen(open === i ? null : i)}>
                    {open === i ? 'Hide' : 'Show'} {a.candidates.length} technicians considered
                  </button>
                  {open === i && (
                    <table className="data-table mt-1 text-xs">
                      <tbody>
                        {a.candidates.map(c => (
                          <tr key={c.technicianId}>
                            <td>{c.name}</td>
                            <td className="num">{c.distanceKm} km</td>
                            <td className="num">~{c.etaMinutes} min</td>
                            <td className={c.reason ? 'text-ink-muted' : 'font-semibold text-go'}>{c.reason ?? 'eligible'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {offers.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Offers</h3>
          <table className="data-table mt-1">
            <thead>
              <tr>
                <th>Round</th>
                <th>Technician</th>
                <th>Distance</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {offers.map(o => (
                <tr key={`${o.round}-${o.offeredAt}`}>
                  <td className="num">{o.round}<span className="block text-xs text-ink-muted">{o.radiusKm} km</span></td>
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
        </>
      )}
    </section>
  );
}

type ManualAction = 'offer' | 'assign';

function AssignPanel({ job, onAssigned }: { job: Job; onAssigned: (j: Job) => void }) {
  const toast = useToast();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<{ c: Candidate; action: ManualAction; guard: AssignmentGuard } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [showFar, setShowFar] = useState(false);

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

  const open = (c: Candidate, action: ManualAction) => {
    setPick({ c, action, guard: c.guard });
    setAcknowledged(false);
    setTyped('');
  };

  const confirm = async () => {
    if (!pick) return;
    setBusy(true);
    const confirmation = { acknowledgeWarning: acknowledged, confirmText: typed };
    try {
      const updated =
        pick.action === 'offer'
          ? await adminApi.offer(job.id, pick.c.id, confirmation)
          : await adminApi.assign(job.id, pick.c.id, confirmation);
      onAssigned(updated);
      toast(pick.action === 'offer' ? `Offer sent to ${pick.c.name}.` : `Assigned to ${pick.c.name}.`, 'success');
      setPick(null);
    } catch (err) {
      // The server re-checks the guard; show its latest figures if they changed.
      const guard = axios.isAxiosError(err) ? (err.response?.data as ApiError | undefined)?.details?.guard : undefined;
      if (guard) setPick(p => (p ? { ...p, guard } : p));
      toast(errorMessage(err), 'error');
      load();
    } finally {
      setBusy(false);
    }
  };

  const needsAck = pick && pick.guard.level !== 'ok';
  const needsTyped = pick?.guard.level === 'confirm';
  const ready = pick && (!needsAck || acknowledged) && (!needsTyped || typed.trim().toUpperCase() === 'ASSIGN');
  // Beyond the hard emergency limits (40 km or 90 min): hidden until asked for, and badged.
  const within = candidates?.filter(c => c.guard.level !== 'confirm') ?? [];
  const far = candidates?.filter(c => c.guard.level === 'confirm') ?? [];
  const rows = showFar ? [...within, ...far] : within;

  return (
    <section className="panel p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-semibold">Assign manually</h2>
        <button className="text-sm font-semibold text-route hover:underline" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Verified technicians with this skill, nearest first. <strong>Send offer</strong> gives them the usual
        60-second offer; <strong>Assign directly</strong> is for someone you have already spoken to.
        {job.status === 'MATCHED' && ' Either one withdraws the open offer.'}
      </p>
      {error && <div className="mt-3"><ErrorNotice message={error} onRetry={load} /></div>}
      {!candidates ? (
        <div className="py-6 text-center"><Spinner /></div>
      ) : candidates.length === 0 ? (
        <p className="mt-3 text-sm">No verified technician has this skill yet.</p>
      ) : (
        <>
          {within.length === 0 && !showFar && (
            <p className="mt-3 rounded-panel border border-alert/40 bg-alert-soft px-3 py-2 text-sm">
              No technician with this skill is within emergency limits (40 km or 90 min). Ask the customer whether they
              can wait, or cancel the request.
            </p>
          )}
          {rows.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="data-table min-w-[620px]">
                <thead>
                  <tr>
                    <th>Technician</th>
                    <th>Distance and ETA</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(c => (
                    <tr key={c.id} className={c.guard.level === 'confirm' ? 'bg-alert-soft/50' : undefined}>
                      <td>
                        <p className="font-semibold">{c.name}</p>
                        {c.guard.level === 'confirm' ? (
                          <span className="mt-0.5 inline-block rounded bg-alert px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            Beyond emergency limit
                          </span>
                        ) : c.guard.level === 'warn' ? (
                          <span className="mt-0.5 inline-block rounded bg-signal-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-deep">
                            Outside 15 km / 45 min
                          </span>
                        ) : null}
                        <p className="num text-xs text-ink-muted">
                          {c.location.lat.toFixed(5)}, {c.location.lng.toFixed(5)}
                        </p>
                      </td>
                      <td className="num">
                        <span className={c.guard.level === 'confirm' ? 'font-semibold text-alert' : c.guard.level === 'warn' ? 'font-semibold text-signal-deep' : ''}>
                          {c.distanceKm} km, ~{c.etaMinutes} min
                        </span>
                        {c.guard.locationAgeMins != null && c.guard.locationAgeMins > 10 && (
                          <span className="block text-xs text-alert">location {c.guard.locationAgeMins} min old</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {c.busy ? 'On a job' : c.hasOtherOffer ? 'Answering an offer' : c.isOnline ? 'Online, free' : 'Offline'}
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <button className="btn-primary px-3 py-1.5" disabled={!c.offerable || busy} onClick={() => open(c, 'offer')}>
                            Send offer
                          </button>
                          <button className="btn-secondary px-3 py-1.5" disabled={!c.assignable || busy} onClick={() => open(c, 'assign')}>
                            Assign directly
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {far.length > 0 && (
            <button className="mt-3 text-sm font-semibold text-route hover:underline" onClick={() => setShowFar(v => !v)}>
              {showFar
                ? `Hide the ${far.length} beyond the emergency limit`
                : `Show ${far.length} ${far.length === 1 ? 'technician' : 'technicians'} beyond the emergency limit (over 40 km or 90 min)`}
            </button>
          )}
        </>
      )}

      <Modal
        open={!!pick}
        title={pick ? `${pick.action === 'offer' ? 'Send offer to' : 'Assign directly to'} ${pick.c.name}?` : ''}
        onClose={() => setPick(null)}
      >
        {pick && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-panel bg-paper px-3 py-2">
                <dt className="text-xs text-ink-muted">Distance</dt>
                <dd className="num font-display text-2xl font-semibold">{pick.guard.distanceKm} km</dd>
              </div>
              <div className="rounded-panel bg-paper px-3 py-2">
                <dt className="text-xs text-ink-muted">Time to arrive</dt>
                <dd className="num font-display text-2xl font-semibold">~{pick.guard.etaMinutes} min</dd>
              </div>
            </dl>
            <LocationLine lat={pick.c.location.lat} lng={pick.c.location.lng} updatedAt={pick.c.location.updatedAt} label="Technician's last location" />
            {pick.guard.level !== 'ok' && (
              <div className={`rounded-panel border px-3 py-2 ${pick.guard.level === 'confirm' ? 'border-alert/40 bg-alert-soft' : 'border-signal bg-signal-soft'}`} role="alert">
                <p className="font-semibold">
                  {pick.guard.level === 'confirm' ? 'Far outside emergency limits' : 'Outside emergency limits'}
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {pick.guard.reasons.map(r => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="h-4 w-4 accent-ink" />
                  I understand and still want to continue
                </label>
                {pick.guard.level === 'confirm' && (
                  <div className="mt-2">
                    <label htmlFor="typed-confirm" className="label">Type ASSIGN to confirm</label>
                    <input id="typed-confirm" className="field" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPick(null)}>
                Back
              </button>
              <button className="btn-primary" disabled={!ready || busy} onClick={confirm}>
                {busy ? <Spinner className="h-4 w-4" /> : pick.action === 'offer' ? 'Send offer' : 'Assign directly'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
