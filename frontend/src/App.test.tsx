import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import type { Role } from './types';

let auth: { isAuthenticated: boolean; isLoading: boolean; user: { role: Role } | null };
vi.mock('./contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./components/Layout', () => ({ default: () => <Outlet /> }));
vi.mock('./pages/customer/CustomerHome', () => ({ default: () => <p>customer home</p> }));
vi.mock('./pages/technician/TechnicianDashboard', () => ({ default: () => <p>technician home</p> }));
vi.mock('./pages/admin/AdminOverview', () => ({ default: () => <p>admin home</p> }));
vi.mock('./pages/Login', () => ({ default: () => <p>login page</p> }));

const { default: App } = await import('./App');

function at(path: string, role: Role | null) {
  auth = { isAuthenticated: !!role, isLoading: false, user: role ? { role } : null };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('role-based routing', () => {
  it('sends signed-out visitors to login', () => {
    at('/admin', null);
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it.each([
    ['CUSTOMER', 'customer home'],
    ['TECHNICIAN', 'technician home'],
    ['ADMIN', 'admin home'],
  ] as const)('lands a %s on their own home from /', (role, text) => {
    at('/', role);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("redirects a technician away from customer pages instead of looping", () => {
    at('/customer', 'TECHNICIAN');
    expect(screen.getByText('technician home')).toBeInTheDocument();
  });

  it('keeps customers out of the admin area', () => {
    at('/admin/technicians', 'CUSTOMER');
    expect(screen.getByText('customer home')).toBeInTheDocument();
  });
});
