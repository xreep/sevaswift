import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { LatLng, TechnicianProfile } from '../types';
import { errorMessage, technicianApi } from '../services/api';
import { distanceKm, stepTowards } from '../lib/geo';
import { useToast } from './ToastContext';
import { useSocketEvent } from './SocketContext';

export type LocationMode = 'gps' | 'manual';

interface TechnicianState {
  profile: TechnicianProfile | null;
  loadError: string | null;
  reload: () => Promise<void>;
  setProfile: (p: TechnicianProfile) => void;
  position: LatLng | null;
  /** When the current position was last sent to the server. */
  positionAt: string | null;
  mode: LocationMode;
  setMode: (m: LocationMode) => void;
  gpsError: string | null;
  /** Sends a position chosen on the map (manual mode / demo). */
  placeAt: (p: LatLng) => Promise<void>;
  simulating: boolean;
  startDrive: (to: LatLng) => void;
  stopDrive: () => void;
}

const TechnicianContext = createContext<TechnicianState | null>(null);

/** Send a GPS fix at most this often unless the technician moved noticeably. */
const MIN_INTERVAL_MS = 5000;
const MIN_MOVE_KM = 0.02;
/** Demo drive: one step every 2 s, sped up so a few km take about a minute. */
const DRIVE_TICK_MS = 2000;
const DRIVE_STEP_KM = 0.12;
/** While on duty, re-send the last position this often so the server knows the app is alive. */
const HEARTBEAT_MS = 2 * 60_000;

/**
 * Technician session state shared by every technician page: their profile and
 * the location heartbeat. While online the browser's GPS is streamed to the
 * server (which drives dispatch and the customer's live map); the position
 * can also be set by hand or "driven" towards a job to simulate travel.
 */
export function TechnicianProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const [profile, setProfile] = useState<TechnicianProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [positionAt, setPositionAt] = useState<string | null>(null);
  const [mode, setMode] = useState<LocationMode>(() =>
    localStorage.getItem('techLocationMode') === 'manual' ? 'manual' : 'gps'
  );
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const simulatingRef = useRef(false);
  simulatingRef.current = simulating;
  const lastSent = useRef<{ at: number; p: LatLng } | null>(null);
  const driveTimer = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const p = await technicianApi.me();
      setProfile(p);
      setLoadError(null);
      if (p.location) {
        setPosition(prev => prev ?? { lat: p.location!.lat, lng: p.location!.lng });
        setPositionAt(prev => prev ?? p.location!.updatedAt);
      }
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load your profile'));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const send = useCallback(async (p: LatLng, force = false) => {
    const last = lastSent.current;
    const now = Date.now();
    if (!force && last && now - last.at < MIN_INTERVAL_MS && distanceKm(last.p, p) < MIN_MOVE_KM) {
      return;
    }
    lastSent.current = { at: now, p };
    setPosition(p);
    await technicianApi.sendLocation(p.lat, p.lng);
    setPositionAt(new Date().toISOString());
  }, []);

  // The server takes silent technicians off duty after 10 minutes; tell admins and the user why.
  useSocketEvent<{ technicianId: string; isOnline: boolean }>('technician:availability', e => {
    if (profile && e.technicianId === profile.user.id && e.isOnline !== profile.isOnline) {
      reload();
      if (!e.isOnline) toast('You are now off duty.', 'info');
    }
  });

  // Heartbeat: keep the position fresh while on duty, even when standing still.
  useEffect(() => {
    if (!profile?.isOnline) return;
    const id = window.setInterval(() => {
      const p = lastSent.current?.p ?? position;
      if (p && !simulatingRef.current) send(p, true).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [profile?.isOnline, position, send]);

  const changeMode = (m: LocationMode) => {
    setMode(m);
    localStorage.setItem('techLocationMode', m);
  };

  // Stream GPS while online in GPS mode (and not simulating a drive).
  useEffect(() => {
    if (!profile?.isOnline || mode !== 'gps' || simulating) return;
    if (!('geolocation' in navigator)) {
      setGpsError('This browser cannot share its location. Set it on the map instead.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      pos => {
        setGpsError(null);
        send({ lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => undefined);
      },
      err =>
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission is blocked. Allow it in the browser, or set your position on the map.'
            : 'Waiting for a GPS fix…'
        ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [profile?.isOnline, mode, simulating, send]);

  const placeAt = useCallback(
    async (p: LatLng) => {
      try {
        await send(p, true);
      } catch (err) {
        toast(errorMessage(err, 'Could not update your location'), 'error');
      }
    },
    [send, toast]
  );

  const stopDrive = useCallback(() => {
    if (driveTimer.current) window.clearInterval(driveTimer.current);
    driveTimer.current = null;
    setSimulating(false);
  }, []);

  const startDrive = useCallback(
    (to: LatLng) => {
      const from = lastSent.current?.p ?? position;
      if (!from) {
        toast('Set your position first, then start the drive.', 'error');
        return;
      }
      stopDrive();
      setSimulating(true);
      let current = from;
      driveTimer.current = window.setInterval(() => {
        current = stepTowards(current, to, DRIVE_STEP_KM);
        send(current, true).catch(() => undefined);
        if (distanceKm(current, to) < 0.005) {
          stopDrive();
          toast('You have reached the customer. Mark yourself as arrived.', 'success');
        }
      }, DRIVE_TICK_MS);
    },
    [position, send, stopDrive, toast]
  );

  useEffect(() => stopDrive, [stopDrive]);

  return (
    <TechnicianContext.Provider
      value={{
        profile,
        loadError,
        reload,
        setProfile,
        position,
        positionAt,
        mode,
        setMode: changeMode,
        gpsError,
        placeAt,
        simulating,
        startDrive,
        stopDrive,
      }}
    >
      {children}
    </TechnicianContext.Provider>
  );
}

export function useTechnician() {
  const ctx = useContext(TechnicianContext);
  if (!ctx) throw new Error('useTechnician must be used within TechnicianProvider');
  return ctx;
}

export const useOptionalTechnician = () => useContext(TechnicianContext);
