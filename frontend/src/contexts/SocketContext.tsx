import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { refreshAccessToken } from '../services/api';

interface SocketState {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketState>({ socket: null, connected: false });

/**
 * One Socket.IO connection per signed-in session. An expired access token is
 * refreshed and the connection retried; the server pushes offers, job status,
 * live location and (for admins) fleet updates.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = useState<SocketState>({ socket: null, connected: false });
  const retrying = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const socket = io({
      path: '/socket.io',
      auth: cb => cb({ token: localStorage.getItem('accessToken') }),
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setState({ socket, connected: true }));
    socket.on('disconnect', () => setState({ socket, connected: false }));
    socket.on('connect_error', async err => {
      setState({ socket, connected: false });
      if (['TOKEN_EXPIRED', 'INVALID_TOKEN', 'MISSING_TOKEN'].includes(err.message) && !retrying.current) {
        retrying.current = true;
        try {
          await refreshAccessToken();
          socket.connect();
        } catch {
          // The API client handles a dead session by sending the user to login.
        } finally {
          retrying.current = false;
        }
      }
    });

    setState({ socket, connected: false });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setState({ socket: null, connected: false });
    };
  }, [isAuthenticated, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return <SocketContext.Provider value={state}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);

/** Subscribes to a server event for the lifetime of the component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const { socket } = useSocket();
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => saved.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

/** Joins a job's live room (location + ETA) while mounted, re-joining after reconnects. */
export function useJobRoom(jobId: string | undefined) {
  const { socket, connected } = useSocket();
  useEffect(() => {
    if (!socket || !connected || !jobId) return;
    socket.emit('job:subscribe', { jobId });
    return () => {
      socket.emit('job:unsubscribe', { jobId });
    };
  }, [socket, connected, jobId]);
}
