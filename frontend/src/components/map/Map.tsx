import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng } from '../../types';

export function BaseMap({
  center,
  zoom = 13,
  className = 'h-80',
  children,
}: {
  center: LatLng;
  zoom?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`overflow-hidden rounded-panel border border-line ${className}`}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {children}
      </MapContainer>
    </div>
  );
}

/** Keeps every given point in view; refits only when the set of points changes meaningfully. */
export function FitBounds({ points, maxZoom = 15 }: { points: LatLng[]; maxZoom?: number }) {
  const map = useMap();
  const key = points.map(p => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 14));
      return;
    }
    map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [40, 40], maxZoom });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function Recenter({ point, zoom }: { point: LatLng | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView([point.lat, point.lng], zoom ?? map.getZoom());
  }, [point?.lat, point?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function ClickToPick({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: e => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

const pin = (html: string, size: [number, number], anchor: [number, number]) =>
  L.divIcon({ className: 'map-pin', html, iconSize: size, iconAnchor: anchor, popupAnchor: [0, -anchor[1]] });

/** The customer's home: an ink square with a white roof mark. */
export const homeIcon = (urgent = false) =>
  pin(
    `<div style="width:30px;height:30px;border-radius:6px;background:${urgent ? '#C8322B' : '#17202B'};display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(23,32,43,.4)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg></div>`,
    [30, 30],
    [15, 15]
  );

/** A technician: a round marker coloured by state. */
export const techIcon = (state: 'available' | 'busy' | 'offline' | 'self') => {
  const color = { available: '#1E8E5A', busy: '#FFB000', offline: '#9AA4B2', self: '#2F5DA8' }[state];
  return pin(
    `<div style="width:24px;height:24px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 3px rgba(23,32,43,.45)"></div>`,
    [24, 24],
    [12, 12]
  );
};
