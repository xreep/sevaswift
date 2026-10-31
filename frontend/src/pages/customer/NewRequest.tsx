import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Marker } from 'react-leaflet';
import type { JobPriority, LatLng, Service, Upload } from '../../types';
import { availabilityApi, errorMessage, jobsApi, servicesApi, uploadsApi, type Availability } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { BaseMap, ClickToPick, Recenter, homeIcon } from '../../components/map/Map';
import { ErrorNotice, PageHeader, PageLoader, Spinner } from '../../components/ui';
import EmailVerifyNotice from '../../components/EmailVerifyNotice';
import { useAuth } from '../../contexts/AuthContext';
import { searchSteps } from '../../lib/radius';
import { DEFAULT_CENTER, currentPosition, reverseGeocode, searchAddress } from '../../lib/geo';
import { rupees } from '../../lib/format';
import ServiceIcon from '../../components/ServiceIcon';

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type PlaceResult = LatLng & { label: string };

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-3 font-display text-2xl font-semibold">
        <span className="num flex h-8 w-8 items-center justify-center rounded-full bg-ink text-base text-white">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function NewRequest() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [services, setServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState(params.get('service') ?? '');
  const [priority, setPriority] = useState<JobPriority>('URGENT');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [coverage, setCoverage] = useState<Availability | null>(null);
  const { user } = useAuth();
  const unverified = user?.role === 'CUSTOMER' && !user.emailVerified;

  useEffect(() => {
    servicesApi
      .list()
      .then(setServices)
      .catch(err => setLoadError(errorMessage(err)));
  }, []);

  // Show who could take the job before it is sent, for the chosen place and service.
  useEffect(() => {
    if (!point || !serviceId) {
      setCoverage(null);
      return;
    }
    let stale = false;
    const id = window.setTimeout(() => {
      availabilityApi
        .get({ lat: point.lat, lng: point.lng, serviceId })
        .then(a => !stale && setCoverage(a))
        .catch(() => !stale && setCoverage(null));
    }, 300);
    return () => {
      stale = true;
      window.clearTimeout(id);
    };
  }, [point, serviceId]);

  const pick = async (p: LatLng, label?: string) => {
    setPoint(p);
    setErrors(e => ({ ...e, location: '' }));
    if (label) {
      setAddress(label);
      return;
    }
    const found = await reverseGeocode(p);
    if (found) setAddress(found);
  };

  const locate = async () => {
    setLocating(true);
    try {
      await pick(await currentPosition());
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLocating(false);
    }
  };

  const search = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      setResults(await searchAddress(query.trim()));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSearching(false);
    }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    const chosen = Array.from(files).slice(0, room);
    for (const f of chosen) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
        toast(`${f.name} is not a JPEG, PNG or WebP image.`, 'error');
        return;
      }
      if (f.size > MAX_PHOTO_BYTES) {
        toast(`${f.name} is larger than 5 MB.`, 'error');
        return;
      }
    }
    setUploading(true);
    try {
      for (const f of chosen) {
        const uploaded = await uploadsApi.image(f);
        setPhotos(p => [...p, uploaded]);
      }
    } catch (err) {
      toast(errorMessage(err, 'Photo upload failed'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!serviceId) next.service = 'Choose what needs fixing.';
    if (!point) next.location = 'Set the location: use GPS, search an address, or tap the map.';
    if (address.trim().length < 3) next.address = 'Enter the address the technician should come to.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !point) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const job = await jobsApi.create({
        serviceId,
        lat: point.lat,
        lng: point.lng,
        address: address.trim(),
        description: description.trim() || undefined,
        priority,
        photoUrls: photos.map(p => p.url),
      });
      navigate(`/jobs/${job.id}`, { replace: true });
    } catch (err) {
      setSubmitError(errorMessage(err, 'Could not raise the request.'));
      setSubmitting(false);
    }
  };

  if (loadError) return <ErrorNotice message={loadError} />;
  if (!services) return <PageLoader />;

  const selected = services.find(s => s.id === serviceId);

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-5" noValidate>
      <PageHeader
        title="Request help"
        subtitle="Three quick steps. We start looking for a technician the moment you send it."
      />
      <EmailVerifyNotice />

      <Section step={1} title="What needs fixing?">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5" role="radiogroup" aria-label="Service">
          {services.map(s => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={serviceId === s.id}
              aria-label={s.name}
              onClick={() => {
                setServiceId(s.id);
                setErrors(e => ({ ...e, service: '' }));
              }}
              className={`rounded-panel border-2 p-3 text-left ${
                serviceId === s.id ? 'border-ink bg-white' : 'border-line bg-paper hover:border-ink-muted'
              }`}
            >
              <ServiceIcon service={s} className="h-7 w-7" />
              <span className="mt-1 block text-sm font-semibold leading-tight">{s.name}</span>
            </button>
          ))}
        </div>
        {errors.service && <p className="mt-2 text-sm text-alert">{errors.service}</p>}
        {selected && (
          <p className="mt-3 text-sm text-ink-muted">
            {selected.description}. Visit fee {rupees(selected.baseFee)}, paid to the technician.
          </p>
        )}

        <fieldset className="mt-5">
          <legend className="label">How urgent is it?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { v: 'URGENT', t: 'Emergency', b: 'Water, sparks, gas smell, no power or no cooling right now.' },
                { v: 'NORMAL', t: 'Standard', b: 'Needs fixing soon but nothing is at risk.' },
              ] as const
            ).map(o => (
              <label
                key={o.v}
                className={`cursor-pointer rounded-panel border-2 p-3 ${
                  priority === o.v ? (o.v === 'URGENT' ? 'border-alert bg-alert-soft' : 'border-ink') : 'border-line'
                }`}
              >
                <input
                  type="radio"
                  name="priority"
                  value={o.v}
                  checked={priority === o.v}
                  onChange={() => setPriority(o.v)}
                  className="sr-only"
                />
                <span className="block font-semibold">{o.t}</span>
                <span className="block text-sm text-ink-muted">{o.b}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section step={2} title="Where are you?">
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={locate} disabled={locating} className="btn-primary sm:w-auto">
            {locating ? <Spinner className="h-4 w-4" /> : null}
            Use my current location
          </button>
          <div className="flex flex-1 gap-2" role="search">
            <label htmlFor="place-search" className="sr-only">Search for an address</label>
            <input
              id="place-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') search(e);
              }}
              placeholder="Or search: area, street, landmark"
              className="field"
            />
            <button type="button" onClick={() => search()} className="btn-secondary" disabled={searching}>
              {searching ? <Spinner className="h-4 w-4" /> : 'Search'}
            </button>
          </div>
        </div>
        {results && (
          <ul className="mt-2 divide-y divide-line rounded-panel border border-line">
            {results.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No matches. Try a nearby landmark.</li>}
            {results.map(r => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-paper"
                  onClick={() => {
                    pick(r, r.label);
                    setResults(null);
                  }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-sm text-ink-muted">Tap the map to place the pin exactly at your door.</p>
        <BaseMap center={point ?? DEFAULT_CENTER} zoom={point ? 16 : 11} className="mt-2 h-72">
          <ClickToPick onPick={p => pick(p)} />
          <Recenter point={point} zoom={16} />
          {point && <Marker position={[point.lat, point.lng]} icon={homeIcon(priority === 'URGENT')} />}
        </BaseMap>
        {errors.location && <p className="mt-2 text-sm text-alert">{errors.location}</p>}
        {coverage && <CoverageNote coverage={coverage} />}

        <div className="mt-4">
          <label htmlFor="address" className="label">Address for the technician</label>
          <textarea
            id="address"
            rows={2}
            maxLength={300}
            value={address}
            onChange={e => {
              setAddress(e.target.value);
              setErrors(er => ({ ...er, address: '' }));
            }}
            placeholder="Flat or house number, building, street, area"
            className={`field ${errors.address ? 'field-error' : ''}`}
          />
          {errors.address && <p className="mt-1 text-sm text-alert">{errors.address}</p>}
        </div>
      </Section>

      <Section step={3} title="Tell us what happened">
        <label htmlFor="description" className="label">Describe the problem (optional)</label>
        <textarea
          id="description"
          rows={3}
          maxLength={1000}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="e.g. Pipe under the kitchen sink burst, water is spreading. Main valve is closed."
          className="field"
        />
        <p className="mt-1 text-right text-xs text-ink-muted">{description.length}/1000</p>

        <p className="label mt-3">Photos (up to {MAX_PHOTOS})</p>
        <div className="flex flex-wrap gap-3">
          {photos.map(p => (
            <div key={p.id} className="relative">
              <img src={p.url} alt="Uploaded issue" className="h-24 w-24 rounded-panel border border-line object-cover" />
              <button
                type="button"
                onClick={() => setPhotos(list => list.filter(x => x.id !== p.id))}
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white"
                aria-label="Remove photo"
              >
                ✕
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-panel border-2 border-dashed border-line text-sm text-ink-muted hover:border-ink-muted">
              {uploading ? <Spinner /> : <><span className="text-2xl">+</span>Add photo</>}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                disabled={uploading}
                onChange={e => {
                  addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </Section>

      {submitError && <ErrorNotice message={submitError} />}

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <button type="submit" disabled={submitting || uploading || unverified} className="btn-signal w-full py-4 text-lg">
          {submitting ? <><Spinner className="h-5 w-5" /> Finding the nearest technician…</> : 'Send request'}
        </button>
      </div>
    </form>
  );
}

function CoverageNote({ coverage }: { coverage: Availability }) {
  const { available, onDuty, nearestEtaMins, nearestKm, radiusKm } = coverage;
  const tone =
    available > 0
      ? 'border-go/40 bg-go-soft'
      : onDuty > 0
        ? 'border-signal bg-signal-soft'
        : 'border-alert/40 bg-alert-soft';
  return (
    <div className={`mt-3 flex items-start gap-3 rounded-panel border px-4 py-3 text-sm ${tone}`} role="status">
      <span
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${available > 0 ? 'live-dot bg-go' : onDuty > 0 ? 'bg-signal' : 'bg-alert'}`}
        aria-hidden
      />
      {available > 0 ? (
        <p>
          <span className="font-semibold">
            {available} technician{available > 1 ? 's' : ''} free within {radiusKm} km.
          </span>{' '}
          The nearest is {nearestKm} km away, roughly {nearestEtaMins} min to reach you.
          <SearchNote steps={coverage.radiusStepsKm} />
        </p>
      ) : onDuty > 0 ? (
        <p>
          <span className="font-semibold">Everyone within {radiusKm} km is on a job right now.</span> Send the request
          anyway and we will keep looking.
          <SearchNote steps={coverage.radiusStepsKm} />
        </p>
      ) : (
        <p>
          <span className="font-semibold">No technician with this skill is on duty within {radiusKm} km.</span> You can
          still send it.
          <SearchNote steps={coverage.radiusStepsKm} />
        </p>
      )}
    </div>
  );
}

/** How far the search goes, so nobody reads the first radius as the whole promise. */
function SearchNote({ steps }: { steps: number[] }) {
  if (steps.length < 2) return null;
  return (
    <span className="mt-1 block text-ink-soft">
      We ask the nearest first, searching {searchSteps(steps)}. Beyond {steps[steps.length - 1]} km our operations
      team assigns someone.
    </span>
  );
}
