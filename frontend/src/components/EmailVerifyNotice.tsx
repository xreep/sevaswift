import { useEffect, useState } from 'react';
import { authApi, errorMessage } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Spinner } from './ui';

/**
 * Customers must verify their email before raising a request. Shows why, and
 * lets them send a fresh link. Re-reads the account on mount so a link opened
 * in another tab is picked up.
 */
export default function EmailVerifyNotice({ className = '' }: { className?: string }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const unverified = !!user && !user.emailVerified;

  useEffect(() => {
    if (!unverified) return;
    authApi
      .me()
      .then(r => r.data.user.emailVerified && setUser(r.data.user))
      .catch(() => undefined);
    // Only on mount: the check is cheap but needs no repeating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!unverified) return null;

  const resend = async () => {
    setBusy(true);
    try {
      const res = await authApi.resendVerification();
      toast(res.data.message, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-panel border border-signal bg-signal-soft px-4 py-3 text-sm ${className}`} role="status">
      <p>
        <span className="font-semibold">Verify your email to raise requests.</span> We sent a link to{' '}
        <span className="font-semibold">{user.email}</span>. Open it, then come back here.
      </p>
      <button
        type="button"
        className="mt-1 inline-flex items-center gap-1.5 font-semibold text-route hover:underline disabled:opacity-50"
        onClick={resend}
        disabled={busy}
      >
        {busy && <Spinner className="h-3.5 w-3.5" />}Send a new link
      </button>
    </div>
  );
}
