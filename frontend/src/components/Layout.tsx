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

export function Logo({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <svg className="h-7 w-7" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill={onDark ? '#FFFFFF' : '#17202B'} fillOpacity={onDark ? 0.12 : 1} />
        <path d="M18 4 9 18h6l-2 10 10-15h-6z" fill="#FFB000" />
      </svg>
      <span className={`font-display text-2xl font-bold tracking-tight ${onDark ? 'text-white' : ''}`}>SevaSwift</span>
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

  // Active page carries the amber "signal" bar, like a lit lane on the dispatch board.
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative block whitespace-nowrap px-3 py-5 text-sm font-semibold transition-colors lg:py-[1.3rem] ${
      isActive
        ? 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t after:bg-signal'
        : 'text-white/65 hover:text-white'
    }`;
  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-panel px-3 py-2.5 text-sm font-semibold ${
      isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
    }`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-[800] bg-ink text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to={homeFor(role)} aria-label="SevaSwift home" className="mr-2">
            <Logo onDark />
          </Link>
          <nav className="hidden h-16 flex-1 items-stretch gap-1 lg:flex" aria-label="Main">
            {NAV[role].map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span
              className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/80 sm:flex"
              title={connected ? 'Receiving live updates' : 'Reconnecting to live updates'}
            >
              <span className={`h-2 w-2 rounded-full ${connected ? 'live-dot bg-signal' : 'bg-white/30'}`} aria-hidden />
              {connected ? 'Live' : 'Reconnecting'}
            </span>
            <span className="hidden items-center gap-2 text-sm text-white/80 md:flex">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 font-display text-sm font-semibold text-white" aria-hidden>
                {user?.name.charAt(0)}
              </span>
              {user?.name}
            </span>
            <button
              onClick={handleLogout}
              className="btn hidden border border-white/20 px-3 py-1.5 text-white/90 hover:bg-white/10 lg:inline-flex"
            >
              Sign out
            </button>
            <button
              className="btn border border-white/20 px-3 py-1.5 text-white hover:bg-white/10 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen(o => !o)}
            >
              Menu
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" className="border-t border-white/10 px-4 py-3 lg:hidden" aria-label="Main">
            <div className="grid gap-1">
              {NAV[role].map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={mobileLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
              <button onClick={handleLogout} className="btn mt-2 border border-white/20 text-white hover:bg-white/10">
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
