import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Job } from '../types';
import { errorMessage, jobsApi, technicianApi } from '../services/api';
import { useSocketEvent } from '../contexts/SocketContext';
import { useTechnician } from '../contexts/TechnicianContext';
import { useToast } from '../contexts/ToastContext';
import { useNow } from '../hooks/useNow';
import { rupees } from '../lib/format';
import { PriorityTag, Spinner } from './ui';
import ServiceIcon from './ServiceIcon';

function chime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio may be blocked until the user interacts with the page.
  }
}

const CLOSED_MESSAGES: Record<string, string> = {
  EXPIRED: 'The offer timed out and went to the next technician.',
  CANCELLED: 'The customer cancelled that request.',
};

/**
 * Incoming job offers for technicians, on every technician page: arrives over
 * the socket (with a polling fallback), shows a countdown and lets them accept
 * or decline before the offer moves on to the next-nearest technician.
 */
export default function OfferAlert() {
  const { profile } = useTechnician();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow(500);
  const [offers, setOffers] = useState<Job[]>([]);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  const load = useCallback(async () => {
    try {
      setOffers(await technicianApi.offers());
    } catch {
      // Polling retries shortly.
    }
  }, []);

  useEffect(() => {
    if (!profile?.isOnline) {
      setOffers([]);
      return;
    }
    load();
    const id = window.setInterval(load, 20000);
    return () => window.clearInterval(id);
  }, [profile?.isOnline, load]);

  useSocketEvent<{ jobId: string }>('offer:new', () => {
    chime();
    load();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('New emergency job', { body: 'Open SevaSwift to accept it.' });
    }
  });

  useSocketEvent<{ jobId: string; reason: string }>('offer:closed', ({ jobId, reason }) => {
    setOffers(list => list.filter(o => o.id !== jobId));
    if (CLOSED_MESSAGES[reason]) toast(CLOSED_MESSAGES[reason], 'info');
  });

  const offer = offers.find(o => o.offer && new Date(o.offer.expiresAt).getTime() > now);
  if (!offer || !offer.offer) return null;

  const total = new Date(offer.offer.expiresAt).getTime() - new Date(offer.offer.offeredAt).getTime();
  const left = Math.max(0, new Date(offer.offer.expiresAt).getTime() - now);
  const secs = Math.ceil(left / 1000);

  const accept = async () => {
    setBusy('accept');
    try {
      await jobsApi.accept(offer.id);
      setOffers([]);
      toast('Job accepted. Head to the customer.', 'success');
      navigate(`/jobs/${offer.id}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
      load();
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy('reject');
    try {
      await jobsApi.reject(offer.id);
      setOffers(list => list.filter(o => o.id !== offer.id));
    } catch (err) {
      toast(errorMessage(err), 'error');
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[950] flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="offer-title"
        className="w-full max-w-md overflow-hidden rounded-t-panel bg-white sm:rounded-panel"
      >
        <div className="h-2 bg-line" aria-hidden>
          <div
            className={`h-full ${secs <= 10 ? 'bg-alert' : 'bg-signal'}`}
            style={{ width: `${(left / total) * 100}%`, transition: 'width 0.5s linear' }}
          />
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-signal-deep">New job offer</p>
              <h2 id="offer-title" className="font-display text-3xl font-semibold">
                <ServiceIcon service={offer.service} className="mr-2 inline h-8 w-8 align-[-4px]" />
                {offer.service.name}
              </h2>
            </div>
            <div className="text-right">
              <p className="num font-display text-4xl font-bold leading-none">{secs}s</p>
              <p className="text-xs text-ink-muted">to respond</p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PriorityTag priority={offer.priority} />
            <span className="text-sm text-ink-muted">Visit fee {rupees(offer.service.baseFee)}</span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-panel bg-paper px-3 py-2">
              <dt className="text-xs text-ink-muted">Distance</dt>
              <dd className="num font-display text-2xl font-semibold">{offer.offer.distanceKm} km</dd>
            </div>
            <div className="rounded-panel bg-paper px-3 py-2">
              <dt className="text-xs text-ink-muted">Drive time</dt>
              <dd className="num font-display text-2xl font-semibold">~{offer.offer.etaMinutes} min</dd>
            </div>
          </dl>

          <p className="mt-4 text-sm">
            <span className="font-semibold">{offer.customer.name}</span> · {offer.location.address}
          </p>
          {offer.description && <p className="mt-2 text-sm text-ink-soft">“{offer.description}”</p>}
          {offer.photoUrls.length > 0 && (
            <div className="mt-3 flex gap-2">
              {offer.photoUrls.map(url => (
                <img key={url} src={url} alt="Issue photo" className="h-16 w-16 rounded-panel object-cover" />
              ))}
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button className="btn-secondary py-3" onClick={decline} disabled={!!busy}>
              {busy === 'reject' ? <Spinner className="h-4 w-4" /> : 'Decline'}
            </button>
            <button className="btn-go py-3 text-base" onClick={accept} disabled={!!busy}>
              {busy === 'accept' ? <Spinner className="h-4 w-4" /> : 'Accept job'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
