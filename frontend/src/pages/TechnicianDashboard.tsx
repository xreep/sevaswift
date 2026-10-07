import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import { technicianApi, servicesApi } from '../services/api';
import type { TechnicianProfile, Service } from '../types';

const profileSchema = z.object({
  name: z.string().min(2),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional().or(z.literal('')),
});

const serviceAreaSchema = z.object({
  centerLat: z.number(),
  centerLng: z.number(),
  radiusKm: z.number().min(1).max(100),
});

type ProfileForm = z.infer<typeof profileSchema>;
type ServiceAreaForm = z.infer<typeof serviceAreaSchema>;

export default function TechnicianDashboard() {
  const { user, refreshUser } = useAuth();
  const [profile, setProfile] = useState<TechnicianProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'profile' | 'skills' | 'areas' | 'availability'>('profile');
  const [isOnline, setIsOnline] = useState(false);

  const {
    register: registerProfile,
    handleSubmit: handleSubmitProfile,
  } = useForm<ProfileForm>({ resolver: zodResolver(profileSchema) });

  const {
    register: registerArea,
    handleSubmit: handleSubmitArea,
  } = useForm<ServiceAreaForm>({ resolver: zodResolver(serviceAreaSchema) });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [profileRes, servicesRes] = await Promise.all([
        technicianApi.me(),
        servicesApi.list(),
      ]);
      setProfile(profileRes.data);
      setIsOnline(profileRes.data.isOnline);
      setServices(servicesRes.data);
    } catch (err) {
      console.error('Failed to load technician data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (data: ProfileForm) => {
    try {
      await technicianApi.update(data);
      await refreshUser();
      await loadData();
    } catch (err) {
      console.error('Failed to update profile:', err);
    }
  };

  const handleToggleAvailability = async () => {
    try {
      await technicianApi.toggleAvailability(!isOnline);
      setIsOnline(!isOnline);
    } catch (err) {
      console.error('Failed to toggle availability:', err);
    }
  };

  const handleAddSkill = async (serviceId: string) => {
    try {
      await technicianApi.addSkill(serviceId);
      await loadData();
    } catch (err) {
      console.error('Failed to add skill:', err);
    }
  };

  const handleRemoveSkill = async (serviceId: string) => {
    try {
      await technicianApi.removeSkill(serviceId);
      await loadData();
    } catch (err) {
      console.error('Failed to remove skill:', err);
    }
  };

  const handleAddServiceArea = async (data: ServiceAreaForm) => {
    try {
      await technicianApi.addServiceArea(data);
      await loadData();
    } catch (err) {
      console.error('Failed to add service area:', err);
    }
  };

  const handleRemoveServiceArea = async (id: string) => {
    try {
      await technicianApi.removeServiceArea(id);
      await loadData();
    } catch (err) {
      console.error('Failed to remove service area:', err);
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('document', file);
    formData.append('type', 'ID');

    try {
      await technicianApi.uploadDocuments(formData);
      await loadData();
    } catch (err) {
      console.error('Failed to upload document:', err);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Technician Dashboard</h1>
          <p className="text-gray-600 mt-1">Manage your profile, skills, and availability</p>
        </div>
        <div className="flex items-center space-x-4">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${isOnline ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <button
            onClick={handleToggleAvailability}
            className={`px-4 py-2 rounded-md text-sm font-medium ${isOnline ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-green-600 text-white hover:bg-green-700'}`}
          >
            {isOnline ? 'Go Offline' : 'Go Online'}
          </button>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex space-x-8" aria-label="Dashboard tabs">
          {['profile', 'skills', 'areas', 'availability'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'profile' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Profile Information</h2>
          <form onSubmit={handleSubmitProfile(handleProfileUpdate)} className="space-y-4 max-w-md">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">Full Name</label>
              <input
                id="name"
                {...registerProfile('name')}
                defaultValue={profile?.userId ? user?.name : ''}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">Phone Number</label>
              <input
                id="phone"
                {...registerProfile('phone')}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Verification Status</label>
              <p className="mt-1 text-sm text-gray-900">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  profile?.verificationStatus === 'VERIFIED' ? 'bg-green-100 text-green-800' :
                  profile?.verificationStatus === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                  profile?.verificationStatus === 'REJECTED' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {profile?.verificationStatus}
                </span>
              </p>
              {profile?.verificationStatus === 'REJECTED' && profile?.rejectionReason && (
                <p className="mt-1 text-sm text-red-600">Reason: {profile.rejectionReason}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Upload Verification Documents</label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleDocumentUpload}
                className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              Save Profile
            </button>
          </form>
        </div>
      )}

      {activeTab === 'skills' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Your Skills</h2>
          {profile?.skills.length ? (
            <ul className="space-y-2">
              {profile.skills.map((skill) => (
                <li key={skill.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                  <span>{skill.service.name} ({skill.service.category})</span>
                  <button
                    onClick={() => handleRemoveSkill(skill.serviceId)}
                    className="text-red-600 hover:text-red-700 text-sm font-medium"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No skills added yet</p>
          )}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-md font-medium text-gray-900 mb-3">Add Skill</h3>
            <select
              onChange={(e) => handleAddSkill(e.target.value)}
              className="block w-full max-w-md rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              defaultValue=""
            >
              <option value="">Select a service</option>
              {services.filter((s) => !profile?.skills.some((skill) => skill.serviceId === s.id)).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} ({service.category}) - ₹{service.baseFee / 100}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {activeTab === 'areas' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Service Areas</h2>
          {profile?.serviceAreas.length ? (
            <ul className="space-y-2 mb-6">
              {profile.serviceAreas.map((area) => (
                <li key={area.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                  <span>Lat: {area.centerLat}, Lng: {area.centerLng} — Radius: {area.radiusKm} km</span>
                  <button
                    onClick={() => handleRemoveServiceArea(area.id)}
                    className="text-red-600 hover:text-red-700 text-sm font-medium"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 mb-6">No service areas added yet</p>
          )}
          <form onSubmit={handleSubmitArea(handleAddServiceArea)} className="max-w-md space-y-4">
            <h3 className="text-md font-medium text-gray-900">Add Service Area</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="centerLat" className="block text-sm font-medium text-gray-700">Latitude</label>
                <input
                  id="centerLat"
                  type="number"
                  step="any"
                  {...registerArea('centerLat', { valueAsNumber: true })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="centerLng" className="block text-sm font-medium text-gray-700">Longitude</label>
                <input
                  id="centerLng"
                  type="number"
                  step="any"
                  {...registerArea('centerLng', { valueAsNumber: true })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="radiusKm" className="block text-sm font-medium text-gray-700">Radius (km)</label>
                <input
                  id="radiusKm"
                  type="number"
                  min="1"
                  max="100"
                  {...registerArea('radiusKm', { valueAsNumber: true })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  required
                />
              </div>
            </div>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              Add Area
            </button>
          </form>
        </div>
      )}

      {activeTab === 'availability' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Availability Settings</h2>
          <p className="text-gray-600 mb-4">Toggle your online status to receive job offers</p>
          <div className="flex items-center space-x-4">
            <span className={`px-4 py-2 rounded-full text-lg font-medium ${isOnline ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
              {isOnline ? 'Currently Online' : 'Currently Offline'}
            </span>
            <button
              onClick={handleToggleAvailability}
              className={`px-6 py-3 rounded-md text-lg font-medium ${isOnline ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-green-600 text-white hover:bg-green-700'}`}
            >
              {isOnline ? 'Go Offline' : 'Go Online'}
            </button>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            When online, you'll receive job offers matching your skills and service areas.
            You have 60 seconds to accept or reject each offer.
          </p>
        </div>
      )}
    </div>
  );
}