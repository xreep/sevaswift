import { useState } from 'react';
import { adminApi, errorMessage } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { Modal, Spinner } from '../ui';

/** Shared demo logins cannot be deleted (the server refuses too), so no button is offered. */
export const isDemoAccount = (email: string) => email.endsWith('@demo.sevaswift');

export default function DeleteUserButton({
  user,
  disabled,
  onDeleted,
}: {
  user: { id: string; name: string; email: string; role: string };
  disabled?: boolean;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (isDemoAccount(user.email)) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await adminApi.deleteUser(user.id);
      toast(`${user.name} was deleted.`, 'info');
      setOpen(false);
      onDeleted();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-secondary px-3 py-1.5" disabled={disabled} onClick={() => setOpen(true)}>
        Delete
      </button>
      <Modal open={open} title={`Delete ${user.name} permanently?`} onClose={() => setOpen(false)}>
        <p className="text-sm text-ink-soft">
          {user.role === 'TECHNICIAN'
            ? 'The account, profile, skills and availability history are removed. Jobs they finished stay in the customers’ history without their name.'
            : 'The account and all of its requests, ratings and photos are removed. Ratings they gave are taken off the technicians’ averages.'}{' '}
          This cannot be undone. Accounts with open jobs cannot be deleted.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            Keep account
          </button>
          <button className="btn-danger" onClick={confirm} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Delete account'}
          </button>
        </div>
      </Modal>
    </>
  );
}
