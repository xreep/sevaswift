import type { JobStatus, Role } from '../types';

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function duration(secs: number | null | undefined): string {
  if (secs == null) return '—';
  if (secs < 60) return `${Math.round(secs)}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    const rest = Math.round(secs % 60);
    return rest ? `${mins}m ${rest}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export const minutes = (mins: number | null | undefined) =>
  mins == null ? '—' : mins < 60 ? `${Math.round(mins)} min` : duration(mins * 60);

export const percent = (ratio: number | null | undefined, digits = 0) =>
  ratio == null ? '—' : `${(ratio * 100).toFixed(digits)}%`;

export const rating = (value: number | null | undefined) =>
  value == null || value === 0 ? '—' : value.toFixed(1);

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? dateTime.format(new Date(iso)) : '—';
export const formatTime = (iso: string | null | undefined) =>
  iso ? time.format(new Date(iso)) : '—';

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`;
  return formatDateTime(iso);
}

/** Status names as people say them; EXPIRED reads differently to customers and admins. */
export function statusLabel(status: JobStatus, role: Role = 'CUSTOMER'): string {
  switch (status) {
    case 'CREATED':
      return 'Finding a technician';
    case 'MATCHED':
      return role === 'TECHNICIAN' ? 'New offer' : 'Finding a technician';
    case 'ACCEPTED':
      return 'Assigned';
    case 'EN_ROUTE':
      return 'On the way';
    case 'ARRIVED':
      return 'Arrived';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'COMPLETED':
      return 'Completed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'EXPIRED':
      return role === 'ADMIN' ? 'Needs assignment' : 'No technician available';
  }
}

export const OPEN_STATUSES: JobStatus[] = [
  'CREATED',
  'MATCHED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'IN_PROGRESS',
];
export const ACTIVE_STATUSES: JobStatus[] = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'];
export const CANCELLABLE: JobStatus[] = ['CREATED', 'MATCHED', 'ACCEPTED', 'EN_ROUTE', 'EXPIRED'];

export const homeFor = (role: Role | undefined) =>
  role === 'TECHNICIAN' ? '/technician' : role === 'ADMIN' ? '/admin' : '/customer';
