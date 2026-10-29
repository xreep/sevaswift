import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminTechnician } from '../../types';
import { adminApi, errorMessage } from '../../services/api';
import { useSocketEvent } from '../../contexts/SocketContext';
import { useToast } from '../../contexts/ToastContext';
import { EmptyState, ErrorNotice, Modal, PageHeader, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { duration, formatDateTime, minutes, percent, rating } from '../../lib/format';
import ServiceIcon from '../../components/ServiceIcon';

type Tab = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'ALL';

export default function AdminTechnicians() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('VERIFIED');
  const [list, setList] = useState<AdminTechnician[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminTechnician | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [rows, pending] = await Promise.all([
        adminApi.technicians({ verification: tab === 'ALL' ? undefined : tab, q: q.trim() || undefined }),
        adminApi.technicians({ verification: 'PENDING' }),
      ]);
      setList(rows);
      setPendingCount(pending.length);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tab, q]);

  useEffect(() => {
    const id = window.setTimeout(load, 250);
    return () => window.clearTimeout(id);
  }, [load]);

  useEffect(() => {
    // Land on the verification queue when someone is waiting.
    adminApi.technicians({ verification: 'PENDING' }).then(p => p.length > 0 && setTab('PENDING')).catch(() => undefined);
  }, []);

  useSocketEvent('technician:availability', () => load());

  const replace = (t: AdminTechnician) => setList(l => (l ? l.map(x => (x.id === t.id ? t : x)) : l));

  const verify = async (t: AdminTechnician) => {
    setBusyId(t.id);
    try {
      replace(await adminApi.setVerification(t.id, 'VERIFIED'));
      toast(`${t.name} is verified and can go online.`, 'success');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    if (reason.trim().length < 3) {
      toast('Give the technician a reason (at least 3 characters).', 'error');
      return;
    }
    setBusyId(rejecting.id);
    try {
      await adminApi.setVerification(rejecting.id, 'REJECTED', reason.trim());
      toast(`${rejecting.name} was not approved.`, 'info');
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const setAccount = async (t: AdminTechnician, status: 'ACTIVE' | 'SUSPENDED') => {
    setBusyId(t.id);
    try {
      await adminApi.setUserStatus(t.id, status);
      toast(status === 'SUSPENDED' ? `${t.name} is suspended and signed out.` : `${t.name} is reactivated.`, 'info');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Technicians" subtitle="Verify new technicians, watch availability and performance." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'PENDING', label: 'Waiting for verification', count: pendingCount },
          { value: 'VERIFIED', label: 'Verified' },
          { value: 'REJECTED', label: 'Not approved' },
          { value: 'ALL', label: 'All' },
        ]}
      />
      <div className="mb-4 max-w-sm">
        <label htmlFor="tech-search" className="sr-only">Search technicians</label>
        <input id="tech-search" className="field" placeholder="Search name, email or phone" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {error && <ErrorNotice message={error} onRetry={load} />}

      {!list ? (
        <div className="py-12 text-center"><Spinner /></div>
      ) : list.length === 0 ? (
        <EmptyState title={tab === 'PENDING' ? 'No one is waiting for verification' : 'No technicians match'} />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[960px]">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Skills</th>
                <th>Now</th>
                <th>Rating</th>
                <th>Jobs done</th>
                <th>Offers accepted</th>
                <th>Accepts in</th>
                <th>Reaches customer in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map(t => (
                <tr key={t.id} className={t.accountStatus === 'SUSPENDED' ? 'opacity-60' : ''}>
                  <td>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-ink-muted">{t.email}{t.phone && `, ${t.phone}`}</p>
                    <p className="text-xs text-ink-muted">Joined {formatDateTime(t.joinedAt)}</p>
                    {t.verificationStatus === 'REJECTED' && t.rejectionReason && (
                      <p className="text-xs text-alert">Not approved: {t.rejectionReason}</p>
                    )}
                  </td>
                  <td className="max-w-[12rem] text-xs">
                    {t.skills.length === 0 ? (
                      <span className="text-alert">None</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {t.skills.map(s => (
                          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5">
                            <ServiceIcon service={s} className="h-3.5 w-3.5" />
                            {s.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="text-xs">
                    {t.accountStatus === 'SUSPENDED' ? (
                      <span className="font-semibold text-alert">Suspended</span>
                    ) : t.activeJob ? (
                      <Link to={`/jobs/${t.activeJob.id}`} className="hover:underline"><StatusBadge status={t.activeJob.status} role="ADMIN" /></Link>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 font-semibold ${t.isOnline ? 'text-go' : 'text-ink-muted'}`}>
                        <span className={`h-2 w-2 rounded-full ${t.isOnline ? 'bg-go' : 'bg-line'}`} />
                        {t.isOnline ? (t.pendingOfferJobId ? 'Answering offer' : 'Available') : 'Offline'}
                      </span>
                    )}
                  </td>
                  <td className="num">★ {rating(t.ratingAvg)}<span className="block text-xs text-ink-muted">{t.ratingCount} ratings</span></td>
                  <td className="num">{t.completedJobs}</td>
                  <td className="num">{percent(t.performance.acceptanceRate)}<span className="block text-xs text-ink-muted">{t.performance.offersAccepted}/{t.performance.offersAnswered}</span></td>
                  <td className="num">{duration(t.performance.avgAcceptSecs)}</td>
                  <td className="num">{minutes(t.performance.avgArrivalMins)}</td>
                  <td>
                    <div className="flex justify-end gap-2">
                      {t.verificationStatus !== 'VERIFIED' && (
                        <button className="btn-go px-3 py-1.5" disabled={!!busyId} onClick={() => verify(t)}>
                          {busyId === t.id ? <Spinner className="h-4 w-4" /> : 'Verify'}
                        </button>
                      )}
                      {t.verificationStatus !== 'REJECTED' && (
                        <button className="btn-secondary px-3 py-1.5" disabled={!!busyId} onClick={() => setRejecting(t)}>
                          {t.verificationStatus === 'VERIFIED' ? 'Revoke' : 'Reject'}
                        </button>
                      )}
                      {t.verificationStatus === 'VERIFIED' &&
                        (t.accountStatus === 'SUSPENDED' ? (
                          <button className="btn-secondary px-3 py-1.5" disabled={!!busyId} onClick={() => setAccount(t, 'ACTIVE')}>
                            Reactivate
                          </button>
                        ) : (
                          <button className="btn-danger px-3 py-1.5" disabled={!!busyId} onClick={() => setAccount(t, 'SUSPENDED')}>
                            Suspend
                          </button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!rejecting} title={rejecting?.verificationStatus === 'VERIFIED' ? `Revoke ${rejecting?.name}?` : `Reject ${rejecting?.name}?`} onClose={() => setRejecting(null)}>
        <p className="text-sm text-ink-soft">
          They will be taken offline and stop receiving jobs. The reason is shown to them on their dashboard.
        </p>
        <label htmlFor="reject-reason" className="label mt-4">Reason</label>
        <textarea id="reject-reason" rows={2} maxLength={300} className="field" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. ID document is unreadable, please re-upload" />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setRejecting(null)}>Keep as is</button>
          <button className="btn-danger" onClick={reject} disabled={!!busyId}>
            {busyId ? <Spinner className="h-4 w-4" /> : 'Confirm'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
