import { useCallback, useEffect, useState } from 'react';
import type { TestData } from '../../types';
import { adminApi, errorMessage } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { ErrorNotice, Modal, Spinner } from '../ui';
import { formatDateTime, statusLabel } from '../../lib/format';

const CONFIRM = 'DELETE TEST DATA';

/**
 * Removes records testers labelled TEST: accounts whose name starts with
 * "TEST", and jobs whose description or address does. Admin and demo logins are
 * never included, and anything still open is skipped.
 */
export default function TestDataPanel() {
  const toast = useToast();
  const [data, setData] = useState<TestData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.testData());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const purge = async () => {
    setBusy(true);
    try {
      const r = await adminApi.purgeTestData(typed.trim());
      toast(
        `Deleted ${r.deletedUsers} TEST accounts and ${r.deletedJobs} TEST jobs` +
          (r.skippedUsers + r.skippedJobs ? `; skipped ${r.skippedUsers + r.skippedJobs} still open.` : '.'),
        'success'
      );
      setOpen(false);
      setTyped('');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toDelete = data ? data.users.filter(u => !u.skipped).length + data.jobs.filter(j => !j.skipped).length : 0;

  return (
    <section className="panel mt-8 p-5">
      <h2 className="font-display text-xl font-semibold">TEST data cleanup</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Accounts whose name starts with “TEST”, and jobs whose description or address starts with “TEST” or that
        belong to a TEST account. Admin and demo logins are never included. Open jobs are skipped until they are
        cancelled or finished.
      </p>
      {error && <div className="mt-3"><ErrorNotice message={error} onRetry={load} /></div>}
      {!data ? (
        <div className="py-6 text-center"><Spinner /></div>
      ) : data.users.length + data.jobs.length === 0 ? (
        <p className="mt-3 text-sm">No TEST-labelled records.</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="data-table min-w-[560px] text-sm">
              <tbody>
                {data.users.map(u => (
                  <tr key={u.id}>
                    <td className="font-semibold">{u.name}</td>
                    <td className="text-ink-muted">{u.email} · {u.role.toLowerCase()}</td>
                    <td className="num text-ink-muted">{formatDateTime(u.createdAt)}</td>
                    <td>{u.skipped ? <span className="text-signal-deep">skipped, open job</span> : 'will be deleted'}</td>
                  </tr>
                ))}
                {data.jobs.map(j => (
                  <tr key={j.id}>
                    <td className="font-semibold">Job {j.id.slice(0, 8)}</td>
                    <td className="text-ink-muted">
                      {j.customerName} · {statusLabel(j.status, 'ADMIN')}
                      {j.rated && ' · rated'}
                    </td>
                    <td className="num text-ink-muted">{formatDateTime(j.createdAt)}</td>
                    <td>{j.skipped ? <span className="text-signal-deep">skipped, still open</span> : 'will be deleted'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-danger mt-3" disabled={toDelete === 0} onClick={() => setOpen(true)}>
            Delete {toDelete} TEST {toDelete === 1 ? 'record' : 'records'}
          </button>
        </>
      )}
      <Modal open={open} title="Delete all TEST data?" onClose={() => setOpen(false)}>
        <p className="text-sm text-ink-soft">
          This permanently removes the records listed as “will be deleted”, with their status logs, offers and
          ratings. Technician ratings are recalculated. It cannot be undone.
        </p>
        <label htmlFor="purge-confirm" className="label mt-4">Type {CONFIRM} to confirm</label>
        <input id="purge-confirm" className="field" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            Back
          </button>
          <button className="btn-danger" onClick={purge} disabled={busy || typed.trim() !== CONFIRM}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Delete TEST data'}
          </button>
        </div>
      </Modal>
    </section>
  );
}
