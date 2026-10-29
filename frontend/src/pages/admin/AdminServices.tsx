import { useCallback, useEffect, useState } from 'react';
import type { Service } from '../../types';
import { adminApi, errorMessage, servicesApi } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { ErrorNotice, Modal, PageHeader, PageLoader, Spinner } from '../../components/ui';
import { rupees } from '../../lib/format';
import ServiceIcon from '../../components/ServiceIcon';

interface Draft {
  id?: string;
  name: string;
  category: string;
  fee: string;
  icon: string;
  description: string;
}

const empty: Draft = { name: '', category: '', fee: '', icon: '', description: '' };

/** The catalogue of services customers can request and technicians can be skilled in. */
export default function AdminServices() {
  const toast = useToast();
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServices(await adminApi.services());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const fee = Number(draft.fee);
    if (!draft.name.trim() || !draft.category.trim()) return setFormError('Name and category are required.');
    if (!Number.isFinite(fee) || fee <= 0) return setFormError('Visit fee must be a positive amount in rupees.');
    setBusy('save');
    setFormError(null);
    const body = {
      name: draft.name.trim(),
      category: draft.category.trim(),
      baseFee: Math.round(fee * 100),
      icon: draft.icon.trim() || undefined,
      description: draft.description.trim() || undefined,
    };
    try {
      if (draft.id) await servicesApi.update(draft.id, body);
      else await servicesApi.create(body);
      toast(draft.id ? 'Service saved.' : 'Service added.', 'success');
      setDraft(null);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (s: Service) => {
    setBusy(s.id);
    try {
      await servicesApi.update(s.id, { isActive: !s.isActive });
      toast(s.isActive ? `${s.name} hidden from customers.` : `${s.name} is available again.`, 'info');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (error && !services) return <ErrorNotice message={error} onRetry={load} />;
  if (!services) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="What customers can request. Hidden services keep their history."
        actions={<button className="btn-primary" onClick={() => { setDraft(empty); setFormError(null); }}>Add service</button>}
      />
      <div className="panel overflow-x-auto">
        <table className="data-table min-w-[640px]">
          <thead>
            <tr><th>Service</th><th>Category</th><th>Visit fee</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {services.map(s => (
              <tr key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                <td>
                  <p className="flex items-center gap-2 font-semibold"><ServiceIcon service={s} className="h-5 w-5" />{s.name}</p>
                  {s.description && <p className="text-xs text-ink-muted">{s.description}</p>}
                </td>
                <td>{s.category}</td>
                <td className="num">{rupees(s.baseFee)}</td>
                <td>{s.isActive ? <span className="font-semibold text-go">Offered</span> : <span className="text-ink-muted">Hidden</span>}</td>
                <td>
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn-secondary px-3 py-1.5"
                      onClick={() => {
                        setDraft({ id: s.id, name: s.name, category: s.category, fee: String(s.baseFee / 100), icon: s.icon ?? '', description: s.description ?? '' });
                        setFormError(null);
                      }}
                    >
                      Edit
                    </button>
                    <button className="btn-secondary px-3 py-1.5" disabled={busy === s.id} onClick={() => toggle(s)}>
                      {s.isActive ? 'Hide' : 'Offer again'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!draft} title={draft?.id ? 'Edit service' : 'Add service'} onClose={() => setDraft(null)}>
        {draft && (
          <form onSubmit={save} className="space-y-3" noValidate>
            {formError && <ErrorNotice message={formError} />}
            <div className="grid grid-cols-[4rem_1fr] gap-3">
              <div>
                <label htmlFor="s-icon" className="label">Icon</label>
                <input id="s-icon" className="field text-center" maxLength={4} value={draft.icon} onChange={e => setDraft({ ...draft, icon: e.target.value })} placeholder="🔧" />
              </div>
              <div>
                <label htmlFor="s-name" className="label">Name</label>
                <input id="s-name" className="field" maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="s-cat" className="label">Category</label>
                <input id="s-cat" className="field" maxLength={50} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} placeholder="Plumbing" />
              </div>
              <div>
                <label htmlFor="s-fee" className="label">Visit fee (₹)</label>
                <input id="s-fee" type="number" min={1} step={1} className="field" value={draft.fee} onChange={e => setDraft({ ...draft, fee: e.target.value })} />
              </div>
            </div>
            <div>
              <label htmlFor="s-desc" className="label">Description</label>
              <input id="s-desc" className="field" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What the visit covers" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy === 'save'}>
                {busy === 'save' ? <Spinner className="h-4 w-4" /> : draft.id ? 'Save service' : 'Add service'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
