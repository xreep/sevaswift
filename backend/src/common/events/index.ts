import { EventEmitter } from 'events';
import type { JobStatus } from '@prisma/client';

/**
 * Domain events. Published in-process; the real-time layer subscribes to push
 * them to clients. A broker (e.g. Kafka) could replace this behind the same API.
 */
export interface DomainEvents {
  'job.status_changed': {
    jobId: string;
    customerId: string;
    technicianUserId: string | null;
    from: JobStatus | null;
    to: JobStatus;
  };
  'job.offered': {
    jobId: string;
    offerId: string;
    technicianUserId: string;
    expiresAt: Date;
  };
  'job.offer_closed': {
    jobId: string;
    offerId: string;
    technicianUserId: string;
    reason: 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  };
  'technician.location': {
    technicianUserId: string;
    lat: number;
    lng: number;
    at: Date;
  };
}

type EventName = keyof DomainEvents;

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export const events = {
  publish<E extends EventName>(name: E, payload: DomainEvents[E]): void {
    emitter.emit(name, payload);
  },
  subscribe<E extends EventName>(name: E, handler: (payload: DomainEvents[E]) => void): () => void {
    emitter.on(name, handler);
    return () => emitter.off(name, handler);
  },
};
