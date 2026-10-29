import { useEffect, useRef } from 'react';
import type { JobPriority, JobStatus, Role } from '../../types';
import { statusLabel } from '../../lib/format';

const statusTone: Record<JobStatus, string> = {
  CREATED: 'bg-signal-soft text-signal-deep border-signal/50',
  MATCHED: 'bg-signal-soft text-signal-deep border-signal/50',
  ACCEPTED: 'bg-route-soft text-route border-route/30',
  EN_ROUTE: 'bg-route-soft text-route border-route/30',
  ARRIVED: 'bg-route-soft text-route border-route/30',
  IN_PROGRESS: 'bg-route-soft text-route border-route/30',
  COMPLETED: 'bg-go-soft text-go border-go/30',
  CANCELLED: 'bg-paper text-ink-muted border-line',
  EXPIRED: 'bg-alert-soft text-alert border-alert/30',
};

export function StatusBadge({ status, role }: { status: JobStatus; role?: Role }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusTone[status]}`}
    >
      {(status === 'CREATED' || status === 'MATCHED') && (
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
      )}
      {statusLabel(status, role)}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: JobPriority }) {
  if (priority !== 'URGENT') return null;
  return (
    <span className="inline-flex items-center rounded-sm bg-alert px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
      Emergency
    </span>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-ink-muted">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-alert/30 bg-alert-soft px-4 py-3 text-sm"
      role="alert"
    >
      <span>{message}</span>
      {onRetry && (
        <button className="font-semibold text-alert underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'signal' | 'alert' | 'go';
}) {
  const accent = {
    default: 'border-line',
    signal: 'border-signal',
    alert: 'border-alert',
    go: 'border-go',
  }[tone];
  return (
    <div className={`panel border-l-4 ${accent} px-4 py-3`}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="num font-display text-3xl font-semibold leading-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[900] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-t-panel bg-white p-5 outline-none sm:rounded-panel ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl font-semibold">{title}</h2>
          <button className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
          className={`text-3xl leading-none ${n <= value ? 'text-signal' : 'text-line'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="text-signal" aria-label={`${value} out of 5`}>
      {'★'.repeat(Math.round(value))}
      <span className="text-line">{'★'.repeat(5 - Math.round(value))}</span>
    </span>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {options.map(o => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
            value === o.value
              ? 'border-ink text-ink'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          {o.label}
          {o.count != null && (
            <span className="num ml-1.5 rounded-full bg-paper px-1.5 text-xs">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
