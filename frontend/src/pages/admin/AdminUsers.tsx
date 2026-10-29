import { useCallback, useEffect, useState } from 'react';
import type { AdminUser } from '../../types';
import { adminApi, errorMessage } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { EmptyState, ErrorNotice, PageHeader, Spinner, Tabs } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

type Tab = 'ACTIVE' | 'SUSPENDED';

export default function AdminUsers() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await adminApi.users({ role: 'CUSTOMER', status: tab, q: q.trim() || undefined }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tab, q]);

  useEffect(() => {
    const id = window.setTimeout(load, 250);
    return () => window.clearTimeout(id);
  }, [load]);

  const setStatus = async (u: AdminUser, status: 'ACTIVE' | 'SUSPENDED') => {
    setBusyId(u.id);
    try {
      await adminApi.setUserStatus(u.id, status);
      toast(status === 'SUSPENDED' ? `${u.name} is suspended and signed out.` : `${u.name} is reactivated.`, 'info');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader title="Customers" subtitle="Accounts and their request history." />
      <Tabs<Tab> value={tab} onChange={setTab} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }]} />
      <div className="mb-4 max-w-sm">
        <label htmlFor="user-search" className="sr-only">Search customers</label>
        <input id="user-search" className="field" placeholder="Search name, email or phone" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {error && <ErrorNotice message={error} onRetry={load} />}
      {!users ? (
        <div className="py-12 text-center"><Spinner /></div>
      ) : users.length === 0 ? (
        <EmptyState title="No customers match" />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Requests</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <p className="font-semibold">{u.name}</p>
                    <p className="text-xs text-ink-muted">{u.email}{!u.emailVerified && ', email not verified'}</p>
                  </td>
                  <td>{u.phone ?? '—'}</td>
                  <td className="num">{u.jobCount}</td>
                  <td className="num">{formatDateTime(u.createdAt)}</td>
                  <td className="text-right">
                    {u.status === 'SUSPENDED' ? (
                      <button className="btn-secondary px-3 py-1.5" disabled={!!busyId} onClick={() => setStatus(u, 'ACTIVE')}>Reactivate</button>
                    ) : (
                      <button className="btn-danger px-3 py-1.5" disabled={!!busyId} onClick={() => setStatus(u, 'SUSPENDED')}>Suspend</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
