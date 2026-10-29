import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Marker } from 'react-leaflet';
import type { Job, Service, TechnicianStats } from '../../types';
import { errorMessage, jobsApi, servicesApi, technicianApi } from '../../services/api';
import { useTechnician } from '../../contexts/TechnicianContext';
import { useSocketEvent } from '../../contexts/SocketContext';
import { useToast } from '../../contexts/ToastContext';
import { useNow } from '../../hooks/useNow';
import { BaseMap, ClickToPick, Recenter, homeIcon, techIcon } from '../../components/map/Map';
import { ErrorNotice, PageHeader, PageLoader, PriorityTag, Spinner, Stat, StatusBadge } from '../../components/ui';
import { DEFAULT_CENTER } from '../../lib/geo';
import { duration, minutes, percent, rating, timeAgo } from '../../lib/format';
import ServiceIcon from '../../components/ServiceIcon';

export default function TechnicianDashboard() {
  const tech = useTechnician();
  const { profile, loadError, reload } = tech;
  const toast = useToast();
  const now = useNow(15000);
  const [stats, setStats] = useState<TechnicianStats | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [savingSkills, setSavingSkills] = useState(false);
  const [toggling, setToggling] = useState(false);

  const loadWork = useCallback(async () => {
    try {
      const s = await technicianApi.stats();
      setStats(s);
      setActiveJob(s.activeJobId ? await jobsApi.get(s.activeJobId) : null);
    } catch {
      // Shown as missing numbers; the profile error covers real outages.
    }
  }, []);

  useEffect(() => {
    loadWork();
    servicesApi.list().then(setServices).catch(() => undefined);
  }, [loadWork]);

  useEffect(() => {
    if (profile) setSkillIds(profile.skills.map(s => s.id));
  }, [profile]);

  useSocketEvent('job:status', () => loadWork());

  if (loadError && !profile) return <ErrorNotice message={loadError} onRetry={reload} />;
  if (!profile) return <PageLoader />;

  const verified = profile.verificationStatus === 'VERIFIED';
  const hasSkills = profile.skills.length > 0;
  const position = tech.position ?? profile.location;

  const toggle = async () => {
    setToggling(true);
    try {
      const next = await technicianApi.setAvailability(!profile.isOnline);
      tech.setProfile(next);
      if (next.isOnline && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => undefined);
      }
      toast(next.isOnline ? 'You are online. New jobs nearby will pop up here.' : 'You are offline.', next.isOnline ? 'success' : 'info');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setToggling(false);
    }
  };

  const saveSkills = async () => {
    setSavingSkills(true);
    try {
      tech.setProfile(await technicianApi.setSkills(skillIds));
      toast('Skills saved.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSavingSkills(false);
    }
  };

  const perf = stats?.last30Days;
  const skillsChanged =
    skillIds.length !== profile.skills.length || skillIds.some(id => !profile.skills.find(s => s.id === id));

  return (
    <div className="space-y-6">
      <PageHeader title={`Hi ${profile.user.name.split(' ')[0]}`} subtitle="Stay online to receive emergency jobs near you." />

      {profile.verificationStatus === 'PENDING' && (
        <div className="rounded-panel border border-signal bg-signal-soft px-4 py-3 text-sm">
          <p className="font-semibold">Waiting for verification</p>
          <p>An admin reviews new technicians before they can receive jobs. Add your skills below in the meantime.</p>
        </div>
      )}
      {profile.verificationStatus === 'REJECTED' && (
        <div className="rounded-panel border border-alert/40 bg-alert-soft px-4 py-3 text-sm">
          <p className="font-semibold">Verification was not approved</p>
          <p>{profile.rejectionReason ?? 'Contact support for details.'}</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <section
          className={`rounded-[10px] border p-5 transition-colors ${
            profile.isOnline ? 'border-ink bg-ink text-white' : 'border-line bg-white'
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={`text-sm ${profile.isOnline ? 'text-white/60' : 'text-ink-muted'}`}>Availability</p>
              <p className="flex items-center gap-3 font-display text-4xl font-bold">
                {profile.isOnline && <span className="live-dot h-3 w-3 rounded-full bg-signal" aria-hidden />}
                {profile.isOnline ? 'On duty' : 'Off duty'}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={profile.isOnline}
              aria-label="Receive jobs"
              disabled={toggling || (!verified && !profile.isOnline)}
              onClick={toggle}
              className={`relative h-11 w-[5.5rem] rounded-full transition-colors ${
                profile.isOnline ? 'bg-go' : 'bg-line'
              } disabled:opacity-50`}
            >
              <span
                className={`absolute top-1 h-9 w-9 rounded-full bg-white shadow transition-all ${
                  profile.isOnline ? 'left-[3.25rem]' : 'left-1'
                }`}
              />
            </button>
          </div>
          <p className={`mt-2 text-sm ${profile.isOnline ? 'text-white/70' : 'text-ink-muted'}`}>
            {profile.isOnline
              ? activeJob
                ? 'You will not get new offers until the current job is complete.'
                : 'New jobs nearby pop up here with a sound. Keep this tab open.'
              : verified
                ? 'Switch on to start receiving emergency jobs near you.'
                : 'You can go on duty once an admin verifies your account.'}
          </p>
          <ul className={`mt-4 grid gap-1.5 border-t pt-4 text-sm ${profile.isOnline ? 'border-white/10' : 'border-line'}`}>
            <Check ok={verified} dark={profile.isOnline}>{verified ? 'Verified by admin' : 'Not verified yet'}</Check>
            <Check ok={hasSkills} dark={profile.isOnline}>
              {hasSkills ? `${profile.skills.length} skill${profile.skills.length > 1 ? 's' : ''} selected` : 'Add at least one skill'}
            </Check>
            <Check ok={!!position} dark={profile.isOnline}>
              {tech.position
                ? 'Location shared'
                : position
                  ? `Last location ${timeAgo(profile.location?.updatedAt ?? null, now)}`
                  : 'Share your location'}
            </Check>
          </ul>
        </section>

        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">Your location</h2>
            <div className="flex rounded-panel border border-line p-0.5 text-sm" role="radiogroup" aria-label="Location source">
              {(['gps', 'manual'] as const).map(m => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={tech.mode === m}
                  onClick={() => tech.setMode(m)}
                  className={`rounded px-3 py-1 font-semibold ${tech.mode === m ? 'bg-ink text-white' : 'text-ink-soft'}`}
                >
                  {m === 'gps' ? 'Device GPS' : 'Set on map'}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {tech.mode === 'gps'
              ? profile.isOnline
                ? tech.gpsError ?? 'Streaming your GPS position while you are online.'
                : 'Your GPS position is shared once you go online.'
              : 'Tap the map to set where you are. Useful for demos or when GPS is unavailable.'}
            {tech.simulating && ' Simulated drive in progress.'}
          </p>
          <BaseMap center={position ?? DEFAULT_CENTER} zoom={position ? 14 : 11} className="mt-3 h-60">
            {tech.mode === 'manual' && <ClickToPick onPick={p => tech.placeAt(p)} />}
            <Recenter point={tech.position} />
            {position && <Marker position={[position.lat, position.lng]} icon={techIcon('self')} />}
            {activeJob && <Marker position={[activeJob.location.lat, activeJob.location.lng]} icon={homeIcon(activeJob.priority === 'URGENT')} />}
          </BaseMap>
        </section>
      </div>

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">Current job</h2>
        {activeJob ? (
          <Link to={`/jobs/${activeJob.id}`} className="panel flex flex-wrap items-center gap-4 border-l-4 border-l-signal p-5 hover:border-ink-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-panel bg-signal-soft text-ink"><ServiceIcon service={activeJob.service} className="h-7 w-7" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{activeJob.service.name}</p>
                <PriorityTag priority={activeJob.priority} />
                <StatusBadge status={activeJob.status} role="TECHNICIAN" />
              </div>
              <p className="truncate text-sm text-ink-muted">{activeJob.customer.name}, {activeJob.location.address}</p>
            </div>
            <span className="btn-primary">Open job</span>
          </Link>
        ) : (
          <div className="panel px-5 py-6 text-sm text-ink-muted">
            {profile.isOnline
              ? 'No active job. Keep this page open; offers appear here with a sound.'
              : 'Go online to start receiving jobs.'}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl font-semibold">Last 30 days</h2>
        {perf ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Jobs completed" value={perf.completedJobs} tone="go" />
            <Stat label="Offers accepted" value={percent(perf.acceptanceRate)} hint={`${perf.offersAccepted} of ${perf.offersAnswered}`} />
            <Stat label="Time to accept" value={duration(perf.avgAcceptSecs)} />
            <Stat label="Time to reach customer" value={minutes(perf.avgArrivalMins)} />
            <Stat label="Rating" value={rating(perf.avgRating ?? profile.ratingAvg)} hint={`${profile.ratingCount} ratings overall`} tone="signal" />
          </div>
        ) : (
          <div className="py-6 text-center"><Spinner /></div>
        )}
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">Skills</h2>
            <p className="text-sm text-ink-muted">You only receive jobs for services you select.</p>
          </div>
          <button className="btn-primary" disabled={!skillsChanged || savingSkills} onClick={saveSkills}>
            {savingSkills ? <Spinner className="h-4 w-4" /> : 'Save skills'}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {services.map(s => {
            const on = skillIds.includes(s.id);
            return (
              <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded-panel border-2 p-3 text-sm ${on ? 'border-ink' : 'border-line'}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setSkillIds(ids => (on ? ids.filter(i => i !== s.id) : [...ids, s.id]))}
                  className="h-4 w-4 accent-ink"
                />
                <ServiceIcon service={s} className="h-5 w-5 shrink-0" />
                <span className="font-semibold leading-tight">{s.name}</span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Check({ ok, dark, children }: { ok: boolean; dark: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
          ok ? 'bg-go text-white' : 'bg-alert text-white'
        }`}
        aria-hidden
      >
        {ok ? '✓' : '!'}
      </span>
      <span className={dark ? 'text-white/85' : ''}>{children}</span>
    </li>
  );
}
