import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { JobStatus } from '@prisma/client';
import { z } from 'zod';
import { config } from '../../config/index';
import { events } from '../../common/events/index';
import { AppError } from '../../common/errors/index';
import { authenticateAccessToken, type AuthUser } from '../../common/middleware/auth';
import { getClock } from '../../common/utils/clock';
import type { LiveEta } from '../jobs/jobs.mapper';
import { activeJobsWithEta, canViewJob } from '../jobs/jobs.service';

/**
 * Socket.IO layer. Clients connect with `auth: { token: <access token> }`.
 *
 * Rooms:
 *  - user:{id}  every socket of a user (offers, status changes of their jobs)
 *  - admins     every admin socket (all status changes, technician positions)
 *  - job:{id}   live location/ETA, joined explicitly with `job:subscribe`
 */
export interface ServerToClientEvents {
  'offer:new': (p: { jobId: string; offerId: string; expiresAt: Date }) => void;
  'offer:closed': (p: { jobId: string; offerId: string; reason: string }) => void;
  'job:status': (p: { jobId: string; from: JobStatus | null; to: JobStatus; at: Date }) => void;
  'job:location': (p: { jobId: string; lat: number; lng: number; at: Date; eta: LiveEta }) => void;
  'technician:location': (p: { technicianId: string; lat: number; lng: number; at: Date }) => void;
}

type Ack = (result: { ok: true } | { ok: false; code: string }) => void;

export interface ClientToServerEvents {
  'job:subscribe': (payload: { jobId: string }, ack?: Ack) => void;
  'job:unsubscribe': (payload: { jobId: string }) => void;
}

interface SocketData {
  user: AuthUser;
}

export interface Realtime {
  io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  close: () => Promise<void>;
}

const jobRef = z.object({ jobId: z.string().uuid() });

const userRoom = (id: string) => `user:${id}`;
const jobRoom = (id: string) => `job:${id}`;
const ADMINS = 'admins';

export function attachRealtime(server: HttpServer): Realtime {
  const io: Realtime['io'] = new Server(server, {
    cors: { origin: config.corsOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.data.user = await authenticateAccessToken(
        typeof token === 'string' ? token : undefined
      );
      next();
    } catch (err) {
      // The client sees the error code as connect_error's message.
      next(new Error(err instanceof AppError ? err.code : 'INTERNAL_ERROR'));
    }
  });

  io.on('connection', socket => {
    const { user } = socket.data;
    socket.join(userRoom(user.id));
    if (user.role === 'ADMIN') socket.join(ADMINS);

    socket.on('job:subscribe', async (payload, ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
      const parsed = jobRef.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, code: 'VALIDATION_ERROR' });
      try {
        if (!(await canViewJob(parsed.data.jobId, user))) {
          return reply({ ok: false, code: 'JOB_NOT_FOUND' });
        }
        await socket.join(jobRoom(parsed.data.jobId));
        reply({ ok: true });
      } catch (err) {
        console.error('[realtime] job:subscribe failed:', err);
        reply({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    socket.on('job:unsubscribe', payload => {
      const parsed = jobRef.safeParse(payload);
      if (parsed.success) socket.leave(jobRoom(parsed.data.jobId));
    });
  });

  const unsubscribers = [
    events.subscribe('job.offered', ({ jobId, offerId, technicianUserId, expiresAt }) => {
      io.to(userRoom(technicianUserId)).emit('offer:new', { jobId, offerId, expiresAt });
    }),

    events.subscribe('job.offer_closed', ({ jobId, offerId, technicianUserId, reason }) => {
      io.to(userRoom(technicianUserId)).emit('offer:closed', { jobId, offerId, reason });
    }),

    events.subscribe('job.status_changed', ({ jobId, customerId, technicianUserId, from, to }) => {
      const rooms = [userRoom(customerId), jobRoom(jobId), ADMINS];
      if (technicianUserId) rooms.push(userRoom(technicianUserId));
      // A socket in several of these rooms still receives the frame once.
      io.to(rooms).emit('job:status', { jobId, from, to, at: new Date(getClock().now()) });
    }),

    events.subscribe('technician.location', ({ technicianUserId, lat, lng, at }) => {
      io.to(ADMINS).emit('technician:location', { technicianId: technicianUserId, lat, lng, at });
      activeJobsWithEta(technicianUserId, { lat, lng })
        .then(jobs => {
          for (const { jobId, eta } of jobs) {
            io.to(jobRoom(jobId)).emit('job:location', { jobId, lat, lng, at, eta });
          }
        })
        .catch(err => console.error('[realtime] Failed to broadcast location:', err));
    }),
  ];

  return {
    io,
    close: async () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      await io.close();
    },
  };
}
