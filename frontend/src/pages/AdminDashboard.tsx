import { useAuth } from '../contexts/AuthContext';

export default function AdminDashboard() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome, {user?.name}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Total Users</h3>
          <p className="text-3xl font-bold text-gray-900">—</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Active Technicians</h3>
          <p className="text-3xl font-bold text-gray-900">—</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Pending Verifications</h3>
          <p className="text-3xl font-bold text-gray-900">—</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Active Jobs</h3>
          <p className="text-3xl font-bold text-gray-900">—</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors">
              Manage Technician Verifications
            </button>
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors">
              View All Jobs
            </button>
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors">
              Manage Service Catalog
            </button>
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors">
              View Analytics
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">System Status</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Database</span>
              <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded-full">Connected</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Redis</span>
              <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded-full">Connected</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Kafka</span>
              <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded-full">Connected</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}