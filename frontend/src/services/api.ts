import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  AdminOverview,
  AdminTechnician,
  AdminUser,
  Analytics,
  ApiError,
  Candidate,
  Job,
  JobPriority,
  JobStatus,
  LiveJob,
  LiveTechnician,
  ProfileUser,
  RegisterData,
  Service,
  TechnicianProfile,
  TechnicianStats,
  TestData,
  TestDataPurge,
  Upload,
  User,
} from '../types';

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let refreshing: Promise<string> | null = null;

/** Exchanges the refresh cookie for a new access token; concurrent callers share one request. */
export function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    refreshing = axios
      .post<{ accessToken: string }>('/api/v1/auth/refresh', {}, { withCredentials: true })
      .then(res => {
        localStorage.setItem('accessToken', res.data.accessToken);
        window.dispatchEvent(new Event('sevaswift:token'));
        return res.data.accessToken;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const accessToken = localStorage.getItem('accessToken');
  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh'];

api.interceptors.response.use(
  response => response,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthCall = NO_REFRESH.some(path => original?.url?.startsWith(path));
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshError) {
        localStorage.removeItem('accessToken');
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

/** Human-readable message for any failed request. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiError | undefined;
    if (data?.fieldErrors) {
      const first = Object.entries(data.fieldErrors)[0];
      if (first) return `${first[0].replace(/^body\.|^query\./, '')}: ${first[1][0]}`;
    }
    if (data?.message) return data.message;
    if (!err.response) return 'Cannot reach the server. Check your connection.';
  }
  return fallback;
}

export function errorCode(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as ApiError | undefined)?.code : undefined;
}

export const authApi = {
  register: (data: RegisterData) =>
    api.post<{ user: User; accessToken: string }>('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post<{ user: User; accessToken: string }>('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  resendVerification: () => api.post<{ message: string }>('/auth/resend-verification'),
  verifyEmail: (data: { token: string }) => api.post('/auth/verify-email', data),
  forgotPassword: (data: { email: string }) => api.post('/auth/forgot-password', data),
  resetPassword: (data: { token: string; password: string }) =>
    api.post('/auth/reset-password', data),
  me: () => api.get<{ user: User }>('/auth/me'),
};

export const usersApi = {
  me: () => api.get<{ user: ProfileUser }>('/users/me').then(r => r.data.user),
  update: (data: { name?: string; phone?: string }) =>
    api.patch<{ user: ProfileUser }>('/users/me', data).then(r => r.data.user),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/users/me/password', data),
  deleteAccount: (password: string) => api.delete('/users/me', { data: { password } }),
};

export const servicesApi = {
  list: () => api.get<{ services: Service[] }>('/services').then(r => r.data.services),
  create: (data: Omit<Service, 'id' | 'isActive'>) =>
    api.post<{ service: Service }>('/services', data).then(r => r.data.service),
  update: (id: string, data: Partial<Service>) =>
    api.patch<{ service: Service }>(`/services/${id}`, data).then(r => r.data.service),
  delete: (id: string) => api.delete(`/services/${id}`),
};

export const uploadsApi = {
  image: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<{ upload: Upload }>('/uploads', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(r => r.data.upload);
  },
};

export interface CreateJobInput {
  serviceId: string;
  lat: number;
  lng: number;
  address: string;
  description?: string;
  priority: JobPriority;
  photoUrls: string[];
}

export const jobsApi = {
  create: (data: CreateJobInput) => api.post<{ job: Job }>('/jobs', data).then(r => r.data.job),
  list: (params: { status?: JobStatus; active?: boolean; limit?: number } = {}) =>
    api
      .get<{ jobs: Job[] }>('/jobs', {
        params: {
          ...params,
          active: params.active === undefined ? undefined : String(params.active),
        },
      })
      .then(r => r.data.jobs),
  get: (id: string) => api.get<{ job: Job }>(`/jobs/${id}`).then(r => r.data.job),
  accept: (id: string) => api.post<{ job: Job }>(`/jobs/${id}/accept`).then(r => r.data.job),
  reject: (id: string) => api.post(`/jobs/${id}/reject`),
  setStatus: (
    id: string,
    status: 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED',
    confirmFar?: boolean
  ) => api.post<{ job: Job }>(`/jobs/${id}/status`, { status, confirmFar }).then(r => r.data.job),
  cancel: (id: string, reason?: string) =>
    api.post<{ job: Job }>(`/jobs/${id}/cancel`, { reason }).then(r => r.data.job),
  review: (id: string, data: { rating: number; comment?: string }) =>
    api.post<{ job: Job }>(`/jobs/${id}/review`, data).then(r => r.data.job),
};

export interface Availability {
  radiusKm: number | null;
  radiusStepsKm: number[];
  onDuty: number;
  available: number;
  nearestKm: number | null;
  nearestEtaMins: number | null;
}

export const availabilityApi = {
  get: (params: { lat?: number; lng?: number; serviceId?: string } = {}) =>
    api
      .get<{ availability: Availability }>('/availability', { params })
      .then(r => r.data.availability),
};

export const technicianApi = {
  me: () => api.get<{ profile: TechnicianProfile }>('/technicians/me').then(r => r.data.profile),
  setAvailability: (isOnline: boolean) =>
    api
      .patch<{ profile: TechnicianProfile }>('/technicians/me/availability', { isOnline })
      .then(r => r.data.profile),
  setSkills: (serviceIds: string[]) =>
    api
      .put<{ profile: TechnicianProfile }>('/technicians/me/skills', { serviceIds })
      .then(r => r.data.profile),
  sendLocation: (lat: number, lng: number) => api.post('/technicians/me/location', { lat, lng }),
  offers: () => api.get<{ offers: Job[] }>('/technicians/me/offers').then(r => r.data.offers),
  stats: () => api.get<{ stats: TechnicianStats }>('/technicians/me/stats').then(r => r.data.stats),
};

export interface AssignmentConfirmation {
  acknowledgeWarning?: boolean;
  confirmText?: string;
}

export const adminApi = {
  overview: () =>
    api.get<{ overview: AdminOverview }>('/admin/overview').then(r => r.data.overview),
  live: () =>
    api
      .get<{ technicians: LiveTechnician[]; jobs: LiveJob[] }>('/admin/live')
      .then(r => r.data),
  services: () => api.get<{ services: Service[] }>('/admin/services').then(r => r.data.services),
  technicians: (params: { verification?: string; online?: string; q?: string } = {}) =>
    api
      .get<{ technicians: AdminTechnician[] }>('/admin/technicians', { params })
      .then(r => r.data.technicians),
  setVerification: (id: string, status: 'VERIFIED' | 'REJECTED', reason?: string) =>
    api
      .patch<{ technician: AdminTechnician }>(`/admin/technicians/${id}/verification`, {
        status,
        reason,
      })
      .then(r => r.data.technician),
  users: (params: { role?: string; status?: string; q?: string } = {}) =>
    api.get<{ users: AdminUser[] }>('/admin/users', { params }).then(r => r.data.users),
  setUserStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') =>
    api
      .patch<{ user: AdminUser }>(`/admin/users/${id}/status`, { status })
      .then(r => r.data.user),
  markEmailVerified: (id: string) =>
    api
      .patch<{ user: AdminUser }>(`/admin/users/${id}/email-verified`, { emailVerified: true })
      .then(r => r.data.user),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
  deleteJob: (id: string) => api.delete(`/admin/jobs/${id}`),
  testData: () =>
    api.get<{ testData: TestData }>('/admin/test-data').then(r => r.data.testData),
  purgeTestData: (confirmText: string) =>
    api
      .post<{ purged: TestDataPurge }>('/admin/test-data/purge', { confirmText })
      .then(r => r.data.purged),
  candidates: (jobId: string) =>
    api
      .get<{ candidates: Candidate[] }>(`/admin/jobs/${jobId}/candidates`)
      .then(r => r.data.candidates),
  assign: (jobId: string, technicianUserId: string, confirmation: AssignmentConfirmation = {}) =>
    api
      .post<{ job: Job }>(`/admin/jobs/${jobId}/assign`, { technicianUserId, ...confirmation })
      .then(r => r.data.job),
  offer: (jobId: string, technicianUserId: string, confirmation: AssignmentConfirmation = {}) =>
    api
      .post<{ job: Job }>(`/admin/jobs/${jobId}/offer`, { technicianUserId, ...confirmation })
      .then(r => r.data.job),
  analytics: (days: number) =>
    api
      .get<{ analytics: Analytics }>('/admin/analytics', { params: { days } })
      .then(r => r.data.analytics),
  jobsCsv: (days: number) =>
    api.get<Blob>('/admin/reports/jobs.csv', { params: { days }, responseType: 'blob' }),
};

export default api;
