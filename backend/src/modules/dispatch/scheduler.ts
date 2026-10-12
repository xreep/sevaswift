import { config } from '../../config/index';
import { getClock } from '../../common/utils/clock';

/**
 * In-process timers that fire when a job offer's accept window closes.
 * Timers are lost on restart, so recoverDispatchState() re-arms them from the
 * database at startup. Disabled under test, where expiry is driven explicitly.
 */
const timers = new Map<string, NodeJS.Timeout>();
let enabled = config.nodeEnv !== 'test';

// Small grace period so the timer never fires a hair before expiresAt.
const GRACE_MS = 250;

export function scheduleOfferExpiry(
  offerId: string,
  expiresAt: Date,
  onExpire: () => Promise<unknown>
) {
  if (!enabled) return;
  cancelOfferExpiry(offerId);
  const delay = Math.max(0, expiresAt.getTime() - getClock().now()) + GRACE_MS;
  const timer = setTimeout(() => {
    timers.delete(offerId);
    onExpire().catch(err => console.error(`[dispatch] Failed to expire offer ${offerId}:`, err));
  }, delay);
  timer.unref();
  timers.set(offerId, timer);
}

export function cancelOfferExpiry(offerId: string) {
  const timer = timers.get(offerId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(offerId);
  }
}

export function setSchedulerEnabled(value: boolean) {
  enabled = value;
  if (!value) {
    for (const id of [...timers.keys()]) cancelOfferExpiry(id);
  }
}
