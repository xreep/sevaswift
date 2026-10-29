import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Analytics } from '../../types';
import { adminApi, errorMessage } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { ErrorNotice, PageHeader, PageLoader, Spinner, Stat, Tabs } from '../../components/ui';
import { duration, minutes, percent, rating } from '../../lib/format';

const SERIES = { requests: '#2F5DA8', completed: '#D99A00' };
const AXIS = { fontSize: 12, fill: '#6B7686' };
const GRID = '#E8ECF0';

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function ChartPanel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {note && <p className="text-sm text-ink-muted">{note}</p>}
      <div className="mt-3 h-64">{children}</div>
    </section>
  );
}

const tooltipStyle = {
  contentStyle: { border: '1px solid #DCE1E7', borderRadius: 6, fontFamily: 'Barlow', fontSize: 13 },
  cursor: { fill: 'rgba(23,32,43,0.05)' },
};

export default function AdminReports() {
  const toast = useToast();
  const [days, setDays] = useState<'7' | '30' | '90'>('7');
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.analytics(Number(days)));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [days]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await adminApi.jobsCsv(Number(days));
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sevaswift-jobs-last-${days}-days.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(errorMessage(err, 'Could not export the report'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const header = (
    <PageHeader
      title="Reports"
      subtitle="Response times, dispatch quality and workforce performance."
      actions={
        <button className="btn-secondary" onClick={download} disabled={downloading}>
          {downloading ? <Spinner className="h-4 w-4" /> : 'Export jobs as CSV'}
        </button>
      }
    />
  );
  const range = (
    <Tabs<'7' | '30' | '90'>
      value={days}
      onChange={setDays}
      options={[
        { value: '7', label: 'Last 7 days' },
        { value: '30', label: 'Last 30 days' },
        { value: '90', label: 'Last 90 days' },
      ]}
    />
  );

  if (error && !data) return <>{header}{range}<ErrorNotice message={error} onRetry={load} /></>;
  if (!data) return <>{header}{range}<PageLoader /></>;

  const k = data.kpis;
  const change = k.responseTimeChange;
  const changeText =
    change == null
      ? 'No earlier data to compare'
      : `${change <= 0 ? '↓' : '↑'} ${percent(Math.abs(change))} vs previous ${days} days (${duration(k.prevAvgResponseSecs)})`;
  const daily = data.daily.map(d => ({ ...d, label: dayLabel(d.day), avgResponseMins: d.avgResponseSecs == null ? null : Math.round((d.avgResponseSecs / 60) * 10) / 10 }));

  return (
    <div className="space-y-6">
      {header}
      {range}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Average time to assign" value={duration(k.avgResponseSecs)} hint={changeText} tone={change != null && change <= 0 ? 'go' : 'default'} />
        <Stat label="Job completion rate" value={percent(k.completionRate)} hint={`${k.completed} completed, ${k.cancelled} cancelled, ${k.expired} unassigned`} />
        <Stat label="Technician utilization" value={percent(k.utilization)} hint="Time on jobs ÷ time online" />
        <Stat label="Customer satisfaction" value={k.csat.avgRating == null ? '—' : `${rating(k.csat.avgRating)} ★`} hint={`${percent(k.csat.positiveShare)} rated 4–5 from ${k.csat.ratings} ratings`} tone="signal" />
        <Stat label="Dispatch accuracy" value={percent(k.dispatchAccuracy)} hint="Engine's first choice accepted" />
        <Stat label="Requests" value={k.requests} hint={`${k.urgentRequests} emergencies, ${k.open} still open`} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="90% assigned within" value={duration(k.p90ResponseSecs)} />
        <Stat label="Time to reach customer" value={minutes(k.avgArrivalMins)} hint={`Engine estimate at offer: ${minutes(k.avgOfferEtaMins)}`} />
        <Stat label="Time on site" value={minutes(k.avgServiceMins)} />
        <Stat label="Request to completion" value={minutes(k.avgResolutionMins)} hint={`Auto-assigned: ${percent(k.autoAssignRate)}, offers accepted: ${percent(k.offerAcceptanceRate)}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartPanel title="Requests and completions per day">
          <ResponsiveContainer>
            <BarChart data={daily} barGap={2} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend
                wrapperStyle={{ fontSize: 13 }}
                iconType="square"
                formatter={value => <span style={{ color: '#3A4656' }}>{value}</span>}
              />
              <Bar dataKey="requests" name="Requests" fill={SERIES.requests} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="completed" name="Completed" fill={SERIES.completed} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Average time to assign, minutes" note="From request to a technician accepting.">
          <ResponsiveContainer>
            <LineChart data={daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} min`, 'Time to assign']} cursor={{ stroke: '#9AA4B2' }} />
              <Line type="linear" dataKey="avgResponseMins" stroke={SERIES.requests} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Demand by hour of day" note={`Requests by local hour (${data.range.timezone}).`}>
          <ResponsiveContainer>
            <BarChart data={data.hourly} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={h => `${h}:00`} interval={2} />
              <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipStyle} labelFormatter={h => `${h}:00–${h}:59`} formatter={(v: number) => [v, 'Requests']} />
              <Bar dataKey="requests" fill={SERIES.requests} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <section className="panel p-4">
          <h2 className="font-display text-xl font-semibold">By service</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Service</th><th>Requests</th><th>Completed</th><th>Time to assign</th></tr>
              </thead>
              <tbody>
                {data.byService.length === 0 && <tr><td colSpan={4} className="text-ink-muted">No requests in this period.</td></tr>}
                {data.byService.map(s => (
                  <tr key={s.serviceId}>
                    <td>{s.icon} {s.name}</td>
                    <td className="num">{s.requests}</td>
                    <td className="num">{percent(s.completionRate)}</td>
                    <td className="num">{duration(s.avgResponseSecs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.byPriority.length > 0 && (
              <p className="mt-3 text-sm text-ink-muted">
                {data.byPriority.map(p => `${p.priority === 'URGENT' ? 'Emergencies' : 'Standard'}: ${p.requests} requests, assigned in ${duration(p.avgResponseSecs)}`).join('. ')}.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="panel p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-semibold">Daily figures</h2>
          <button className="text-sm font-semibold text-route hover:underline" onClick={() => setShowTable(s => !s)}>
            {showTable ? 'Hide table' : 'Show table'}
          </button>
        </div>
        {showTable && (
          <div className="mt-2 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Day</th><th>Requests</th><th>Completed</th><th>Cancelled or unassigned</th><th>Time to assign</th></tr></thead>
              <tbody>
                {data.daily.map(d => (
                  <tr key={d.day}>
                    <td>{dayLabel(d.day)}</td>
                    <td className="num">{d.requests}</td>
                    <td className="num">{d.completed}</td>
                    <td className="num">{d.unfulfilled}</td>
                    <td className="num">{duration(d.avgResponseSecs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel p-4">
        <h2 className="font-display text-xl font-semibold">Technician performance</h2>
        <p className="text-sm text-ink-muted">Top technicians in this period by completed jobs.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr><th>Technician</th><th>Completed</th><th>Offers accepted</th><th>Accepts in</th><th>Reaches customer in</th><th>Time on site</th><th>Rating</th><th>Utilization</th></tr>
            </thead>
            <tbody>
              {data.technicians.length === 0 && <tr><td colSpan={8} className="text-ink-muted">No technician activity in this period.</td></tr>}
              {data.technicians.map(t => (
                <tr key={t.id}>
                  <td className="font-semibold">{t.name}</td>
                  <td className="num">{t.completedJobs}</td>
                  <td className="num">{percent(t.acceptanceRate)}</td>
                  <td className="num">{duration(t.avgAcceptSecs)}</td>
                  <td className="num">{minutes(t.avgArrivalMins)}</td>
                  <td className="num">{minutes(t.avgServiceMins)}</td>
                  <td className="num">{t.avgRating == null ? '—' : `${rating(t.avgRating)} ★`}</td>
                  <td className="num">{percent(t.utilization)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
