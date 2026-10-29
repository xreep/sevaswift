import { useEffect, useState } from 'react';
import type { ProfileUser } from '../types';
import { errorMessage, usersApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ErrorNotice, PageHeader, PageLoader, Spinner, Stat } from '../components/ui';
import { formatDateTime } from '../lib/format';

const PHONE_RE = /^\+?[1-9]\d{1,14}$/;
const ROLE_LABEL = { CUSTOMER: 'Customer', TECHNICIAN: 'Technician', ADMIN: 'Administrator' };

export default function Profile() {
  const { setUser } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [detailsError, setDetailsError] = useState<Record<string, string>>({});

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    usersApi
      .me()
      .then(p => {
        setProfile(p);
        setName(p.name);
        setPhone(p.phone ?? '');
      })
      .catch(err => setLoadError(errorMessage(err)));
  }, []);

  if (loadError) return <ErrorNotice message={loadError} />;
  if (!profile) return <PageLoader />;

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Name must be at least 2 characters.';
    if (phone && !PHONE_RE.test(phone)) errs.phone = 'Use digits only, e.g. +919876543210.';
    setDetailsError(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const updated = await usersApi.update({ name: name.trim(), phone });
      setProfile(updated);
      setUser(updated);
      toast('Profile saved.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (next.length < 8) return setPwError('New password must be at least 8 characters.');
    if (next !== confirm) return setPwError('The new passwords do not match.');
    setPwBusy(true);
    try {
      await usersApi.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Password changed. Other devices have been signed out.', 'success');
    } catch (err) {
      setPwError(errorMessage(err));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Profile" subtitle={`${ROLE_LABEL[profile.role]} account, member since ${formatDateTime(profile.createdAt)}`} />

      {profile.role !== 'ADMIN' && (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <Stat label={profile.role === 'TECHNICIAN' ? 'Jobs assigned' : 'Requests raised'} value={profile.stats.totalJobs} />
          <Stat label="Completed" value={profile.stats.completedJobs} tone="go" />
        </div>
      )}

      <form onSubmit={saveDetails} className="panel space-y-4 p-5 sm:p-6" noValidate>
        <h2 className="font-display text-2xl font-semibold">Your details</h2>
        <div>
          <label htmlFor="p-name" className="label">Full name</label>
          <input id="p-name" className={`field ${detailsError.name ? 'field-error' : ''}`} value={name} onChange={e => setName(e.target.value)} />
          {detailsError.name && <p className="mt-1 text-sm text-alert">{detailsError.name}</p>}
        </div>
        <div>
          <label htmlFor="p-email" className="label">Email</label>
          <input id="p-email" className="field bg-paper" value={profile.email} disabled />
          <p className="mt-1 text-xs text-ink-muted">
            {profile.emailVerified ? 'Verified.' : 'Not verified yet. Check your inbox for the link.'}
          </p>
        </div>
        <div>
          <label htmlFor="p-phone" className="label">Phone</label>
          <input id="p-phone" type="tel" className={`field ${detailsError.phone ? 'field-error' : ''}`} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210" />
          {detailsError.phone && <p className="mt-1 text-sm text-alert">{detailsError.phone}</p>}
          <p className="mt-1 text-xs text-ink-muted">
            {profile.role === 'CUSTOMER'
              ? 'Shared only with the technician assigned to your request.'
              : 'Shown to customers you are assigned to.'}
          </p>
        </div>
        <button className="btn-primary" disabled={saving}>
          {saving ? <Spinner className="h-4 w-4" /> : 'Save changes'}
        </button>
      </form>

      <form onSubmit={changePassword} className="panel mt-5 space-y-4 p-5 sm:p-6" noValidate>
        <h2 className="font-display text-2xl font-semibold">Change password</h2>
        {pwError && <ErrorNotice message={pwError} />}
        <div>
          <label htmlFor="pw-current" className="label">Current password</label>
          <input id="pw-current" type="password" autoComplete="current-password" className="field" value={current} onChange={e => setCurrent(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pw-new" className="label">New password</label>
            <input id="pw-new" type="password" autoComplete="new-password" className="field" value={next} onChange={e => setNext(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pw-confirm" className="label">Confirm new password</label>
            <input id="pw-confirm" type="password" autoComplete="new-password" className="field" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
        </div>
        <button className="btn-secondary" disabled={pwBusy || !current || !next}>
          {pwBusy ? <Spinner className="h-4 w-4" /> : 'Change password'}
        </button>
      </form>
    </div>
  );
}
