export type Role = 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: 'CUSTOMER' | 'TECHNICIAN';
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  instance?: string;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  baseFee: number;
  icon?: string;
  description?: string;
  isActive: boolean;
}

export interface TechnicianProfile {
  id: string;
  userId: string;
  verificationStatus: 'UNSUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  documentKey?: string;
  documentType?: string;
  rejectionReason?: string;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  isOnline: boolean;
  lastLocation?: string;
  skills: TechnicianSkill[];
  serviceAreas: ServiceArea[];
}

export interface TechnicianSkill {
  id: string;
  technicianId: string;
  serviceId: string;
  service: Service;
  createdAt: string;
}

export interface ServiceArea {
  id: string;
  technicianId: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  createdAt: string;
}