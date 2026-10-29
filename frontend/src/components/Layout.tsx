import { useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { TechnicianProvider } from '../contexts/TechnicianContext';
import { homeFor } from '../lib/format';
import type { Role } from '../types';
import OfferAlert from './OfferAlert';

const NAV: Record<Role, { to: string; label: string; end?: boolean }[]> = {
  CUSTOMER: [
    { to: '/customer', label: 'Home', end: true },
    { to: '/customer/request', label: 'Request help' },
    { to: '/customer/history', label: 'Service history' },
    { to: '/profile', label: 'Profile' },
  ],
  TECHNICIAN: [
    { to: '/technician', label: 'Dashboard', end: true },
    { to: '/technician/jobs', label: 'My jobs' },
    { to: '/profile', label: 'Profile' },
  ],
  ADMIN: [
    { to: '/admin', label: 'Live operations', end: true },
    { to: '/admin/jobs', label: 'Jobs' },
    { to: '/admin/technicians', label: 'Technicians' },
    { to: '/admin/users', label: 'Customers' },
    { to: '/admin/reports', label: 'Reports' },
    { to: '/admin/services', label: 'Services' },
    { to: '/profile', label: 'Profile' },
  ],
};

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <svg className="h-7 w-7" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#17202B" />
        <path d="M18 4 9 18h6l-2 10 10-15h-6z" fill="#FFB000" />
      </svg>
      <span className="font-display text-2xl font-bold tracking-tight">SevaSwift</span>
    </span>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = user?.role ?? 'CUSTOMER';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block whitespace-nowrap rounded-panel px-3 py-2 text-sm font-semibold ${
      isActive ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper hover:text-ink'
    }`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-[800] border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to={homeFor(role)} aria-label="SevaSwift home">
            <Logo />
          </Link>
          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
            {NAV[role].map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span
              className="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex"
              title={connected ? 'Receiving live updates' : 'Reconnecting to live updates'}
            >
              <span className={`h-2 w-2 rounded-full ${connected ? 'bg-go' : 'bg-line'}`} aria-hidden />
              {connected ? 'Live' : 'Offline'}
            </span>
            <span className="hidden text-sm text-ink-soft md:block">{user?.name}</span>
            <button onClick={handleLogout} className="btn-secondary hidden px-3 py-1.5 lg:inline-flex">
              Sign out
            </button>
            <button
              className="btn-secondary px-3 py-1.5 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen(o => !o)}
            >
              Menu
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" className="border-t border-line px-4 py-3 lg:hidden" aria-label="Main">
            <div className="grid gap-1">
              {NAV[role].map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={linkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
              <button onClick={handleLogout} className="btn-secondary mt-2">
                Sign out
              </button>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      {role === 'TECHNICIAN' && <OfferAlert />}
    </div>
  );
}

export default function Layout() {
  const { user } = useAuth();
  if (user?.role === 'TECHNICIAN') {
    return (
      <TechnicianProvider>
        <Shell />
      </TechnicianProvider>
    );
  }
  return <Shell />;
}
