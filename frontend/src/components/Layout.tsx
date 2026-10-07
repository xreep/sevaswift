import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!isAuthenticated) {
    return <Outlet />;
  }

  const getDashboardPath = () => {
    switch (user?.role) {
      case 'TECHNICIAN':
        return '/technician';
      case 'ADMIN':
        return '/admin';
      default:
        return '/';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to={getDashboardPath()} className="flex items-center space-x-2">
                <svg className="h-8 w-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2-8 1.5 3 4 6 4 6s1.5-3 4-6c1.5 3 4 6 4 6a8 8 0 01-3.343 8.657z" />
                </svg>
                <span className="text-xl font-bold text-gray-900">SevaSwift</span>
              </Link>
            </div>

            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">{user?.name} ({user?.role})</span>
              <button onClick={handleLogout} className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md">
                Logout
              </button>
            </div>
          </div>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}