import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import CustomerHome from './pages/customer/CustomerHome';
import NewRequest from './pages/customer/NewRequest';
import ServiceHistory from './pages/customer/ServiceHistory';
import JobDetail from './pages/JobDetail';
import Profile from './pages/Profile';
import TechnicianDashboard from './pages/technician/TechnicianDashboard';
import TechnicianJobs from './pages/technician/TechnicianJobs';
import AdminOverview from './pages/admin/AdminOverview';
import AdminJobs from './pages/admin/AdminJobs';
import AdminTechnicians from './pages/admin/AdminTechnicians';
import AdminUsers from './pages/admin/AdminUsers';
import AdminServices from './pages/admin/AdminServices';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import { homeFor } from './lib/format';
import type { Role } from './types';
import { PageLoader } from './components/ui';

// Charts are heavy and only admins see them.
const AdminReports = lazy(() => import('./pages/admin/AdminReports'));

function PrivateRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: Role[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;
  // Signed in with another role: send them to their own home instead of looping.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <LoadingSpinner />;
  if (isAuthenticated) return <Navigate to={homeFor(user?.role)} replace />;
  return <>{children}</>;
}

function RoleHome() {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <LoadingSpinner />;
  return <Navigate to={isAuthenticated ? homeFor(user?.role) : '/login'} replace />;
}

const customer: Role[] = ['CUSTOMER'];
const technician: Role[] = ['TECHNICIAN'];
const admin: Role[] = ['ADMIN'];

function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/" element={<RoleHome />} />

      <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="/customer" element={<PrivateRoute allowedRoles={customer}><CustomerHome /></PrivateRoute>} />
        <Route path="/customer/request" element={<PrivateRoute allowedRoles={customer}><NewRequest /></PrivateRoute>} />
        <Route path="/customer/history" element={<PrivateRoute allowedRoles={customer}><ServiceHistory /></PrivateRoute>} />

        <Route path="/technician" element={<PrivateRoute allowedRoles={technician}><TechnicianDashboard /></PrivateRoute>} />
        <Route path="/technician/jobs" element={<PrivateRoute allowedRoles={technician}><TechnicianJobs /></PrivateRoute>} />

        <Route path="/admin" element={<PrivateRoute allowedRoles={admin}><AdminOverview /></PrivateRoute>} />
        <Route path="/admin/jobs" element={<PrivateRoute allowedRoles={admin}><AdminJobs /></PrivateRoute>} />
        <Route path="/admin/technicians" element={<PrivateRoute allowedRoles={admin}><AdminTechnicians /></PrivateRoute>} />
        <Route path="/admin/users" element={<PrivateRoute allowedRoles={admin}><AdminUsers /></PrivateRoute>} />
        <Route path="/admin/reports" element={<PrivateRoute allowedRoles={admin}><Suspense fallback={<PageLoader />}><AdminReports /></Suspense></PrivateRoute>} />
        <Route path="/admin/services" element={<PrivateRoute allowedRoles={admin}><AdminServices /></PrivateRoute>} />

        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/profile" element={<Profile />} />
      </Route>

      <Route path="*" element={<RoleHome />} />
    </Routes>
  );
}

export default App;
