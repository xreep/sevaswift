import { useAuth } from '../contexts/AuthContext';

export default function CustomerDashboard() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.name}</h1>
        <p className="text-gray-600 mt-1">Customer Dashboard</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Request Service</h3>
          <p className="text-gray-600 mb-4">Book emergency home services instantly</p>
          <button className="text-blue-600 hover:text-blue-500 font-medium">Create Request →</button>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Active Jobs</h3>
          <p className="text-gray-600 mb-4">Track your ongoing service requests</p>
          <button className="text-blue-600 hover:text-blue-500 font-medium">View Jobs →</button>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Service History</h3>
          <p className="text-gray-600 mb-4">View past services and receipts</p>
          <button className="text-blue-600 hover:text-blue-500 font-medium">View History →</button>
        </div>
      </div>
    </div>
  );
}