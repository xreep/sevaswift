import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../contexts/ToastContext';
import NewRequest from './NewRequest';

vi.mock('../../components/map/Map', () => ({
  BaseMap: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  ClickToPick: () => null,
  Recenter: () => null,
  homeIcon: () => undefined,
}));
vi.mock('react-leaflet', () => ({ Marker: () => null }));

const auth = { user: { role: 'CUSTOMER', email: 'TEST@example.com', emailVerified: true } };
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ ...auth, setUser: vi.fn() }) }));

const create = vi.fn();
vi.mock('../../services/api', () => ({
  servicesApi: {
    list: () =>
      Promise.resolve([
        { id: 'plumbing', name: 'Plumbing Repair', category: 'Plumbing', baseFee: 49900, icon: '🔧', description: 'Leaks', isActive: true },
        { id: 'electrical', name: 'Electrical Repair', category: 'Electrical', baseFee: 59900, icon: '⚡', description: 'Wiring', isActive: true },
      ]),
  },
  jobsApi: { create: (...args: unknown[]) => create(...args) },
  uploadsApi: { image: vi.fn() },
  authApi: { me: () => new Promise(() => undefined), resendVerification: vi.fn() },
  errorMessage: (_e: unknown, fallback = 'error') => fallback,
}));

function renderPage(path = '/customer/request') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <NewRequest />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('NewRequest', () => {
  beforeEach(() => {
    create.mockReset();
    auth.user.emailVerified = true;
  });

  it('asks an unverified customer to verify their email and keeps the request from being sent', async () => {
    auth.user.emailVerified = false;
    renderPage();
    expect(await screen.findByText('Verify your email to raise requests.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  it('explains what is missing instead of sending an incomplete request', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Choose what needs fixing.')).toBeInTheDocument();
    expect(screen.getByText(/Set the location/)).toBeInTheDocument();
    expect(screen.getByText(/Enter the address/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('preselects the service from the link and defaults to emergency priority', async () => {
    renderPage('/customer/request?service=electrical');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Electrical Repair' })).toHaveAttribute('aria-checked', 'true')
    );
    expect(screen.getByDisplayValue('URGENT')).toBeChecked();
    expect(screen.getByText(/Visit fee ₹599/)).toBeInTheDocument();
  });
});
