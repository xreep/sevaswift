export type Role = 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type VerificationStatus = 'UNSUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type JobPriority = 'NORMAL' | 'URGENT';
export type JobStatus =
  | 'CREATED'
  | 'MATCHED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string;
}

export interface ProfileUser extends User {
  stats: { totalJobs: number; completedJobs: number };
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
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
  details?: { guard?: AssignmentGuard; distanceKm?: number | null };
  instance?: string;
}

export interface AssignmentGuard {
  level: 'ok' | 'warn' | 'confirm';
  distanceKm: number;
  etaMinutes: number;
  locationAgeMins: number | null;
  reasons: string[];
}

export interface DispatchAttempt {
  at: string;
  radiusKm: number;
  outcome: 'OFFERED' | 'NO_CANDIDATES' | 'RADIUS_EXPANDED' | 'EXHAUSTED' | 'MANUAL_OFFER' | 'MANUAL_ASSIGN';
  note: string | null;
  candidates: {
    technicianId: string;
    name: string;
    distanceKm: number;
    etaMinutes: number;
    reason: string | null;
  }[];
}

export interface Service {
  id: string;
  name: string;
  category: string;
  baseFee: number;
  icon?: string | null;
  description?: string | null;
  isActive: boolean;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TimedLocation extends LatLng {
  updatedAt: string | null;
}

export interface TechnicianProfile {
  id: string;
  user: { id: string; name: string; email: string; phone: string | null };
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  isOnline: boolean;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  location: TimedLocation | null;
  skills: Pick<Service, 'id' | 'name' | 'category' | 'icon'>[];
}

export interface Performance {
  offersAnswered: number;
  offersAccepted: number;
  offersRejected: number;
  offersExpired: number;
  acceptanceRate: number | null;
  avgAcceptSecs: number | null;
  completedJobs: number;
  avgArrivalMins: number | null;
  avgServiceMins: number | null;
  avgRating: number | null;
  ratingCount: number;
}

export interface TechnicianStats {
  lifetime: Performance;
  last30Days: Performance;
  activeJobId: string | null;
}

export interface Eta {
  distanceKm: number;
  minutes: number;
}

export interface Job {
  id: string;
  status: JobStatus;
  priority: JobPriority;
  service: { id: string; name: string; category: string; icon: string | null; baseFee: number };
  location: LatLng & { address: string };
  description: string | null;
  photoUrls: string[];
  customer: { id: string; name: string; phone: string | null };
  technician: {
    id: string;
    name: string;
    phone: string | null;
    ratingAvg: number;
    ratingCount: number;
    completedJobs: number;
    location: TimedLocation | null;
  } | null;
  eta: Eta | null;
  offer: {
    id: string;
    round: number;
    distanceKm: number;
    etaMinutes: number;
    offeredAt: string;
    expiresAt: string;
  } | null;
  dispatchRounds: number;
  dispatch: {
    radiusKm: number;
    /** Search radii in order (15 -> 25 -> 40 km); beyond the last only an admin assigns. */
    radiusStepsKm: number[];
    offersMade: number;
    currentOffer: {
      technicianName: string;
      distanceKm: number;
      etaMinutes: number;
      offeredAt: string;
      expiresAt: string;
    } | null;
    widened: { radiusKm: number; at: string }[];
  };
  dispatchAttempts?: DispatchAttempt[];
  responseTimeSecs: number | null;
  createdAt: string;
  acceptedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  timeline: { from: JobStatus | null; to: JobStatus; note: string | null; at: string }[];
  dispatchLog?: {
    technicianName: string;
    round: number;
    radiusKm: number;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
    distanceKm: number;
    etaMinutes: number;
    offeredAt: string;
    respondedAt: string | null;
  }[];
  review: { rating: number; comment: string | null } | null;
}

export interface Upload {
  id: string;
  mimeType: string;
  size: number;
  url: string;
}

// ---- Admin ----

export interface AdminOverview {
  customers: number;
  technicians: {
    total: number;
    verified: number;
    pendingVerification: number;
    online: number;
    busy: number;
    available: number;
  };
  jobs: {
    open: number;
    awaitingAssignment: number;
    last24h: number;
    completedLast24h: number;
    avgResponseSecsLast24h: number | null;
  };
}

export interface LiveTechnician extends LatLng {
  id: string;
  name: string;
  phone: string | null;
  isOnline: boolean;
  ratingAvg: number;
  locationUpdatedAt: string | null;
  skills: string[];
  activeJobId: string | null;
  simulated: boolean;
}

export interface LiveJob extends LatLng {
  id: string;
  status: JobStatus;
  priority: JobPriority;
  address: string;
  createdAt: string;
  service: { id: string; name: string; category: string; icon: string | null };
  customerName: string;
  technicianId: string | null;
}

export interface AdminTechnician {
  id: string;
  profileId: string;
  name: string;
  email: string;
  phone: string | null;
  accountStatus: UserStatus;
  joinedAt: string;
  simulated: boolean;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  isOnline: boolean;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  location: TimedLocation | null;
  skills: { id: string; name: string; icon: string | null }[];
  activeJob: { id: string; status: JobStatus } | null;
  pendingOfferJobId: string | null;
  performance: Performance;
}

export interface AdminUser extends User {
  jobCount: number;
}

export interface Candidate {
  id: string;
  name: string;
  phone: string | null;
  isOnline: boolean;
  ratingAvg: number;
  completedJobs: number;
  location: TimedLocation;
  distanceKm: number;
  etaMinutes: number;
  busy: boolean;
  hasOtherOffer: boolean;
  assignable: boolean;
  offerable: boolean;
  guard: AssignmentGuard;
}

export interface Analytics {
  range: { days: number; from: string; to: string; timezone: string };
  kpis: {
    requests: number;
    urgentRequests: number;
    completed: number;
    cancelled: number;
    expired: number;
    open: number;
    completionRate: number | null;
    avgResponseSecs: number | null;
    p90ResponseSecs: number | null;
    prevAvgResponseSecs: number | null;
    responseTimeChange: number | null;
    avgArrivalMins: number | null;
    avgServiceMins: number | null;
    avgResolutionMins: number | null;
    utilization: number | null;
    dispatchAccuracy: number | null;
    autoAssignRate: number | null;
    offerAcceptanceRate: number | null;
    avgOfferEtaMins: number | null;
    csat: { avgRating: number | null; ratings: number; positiveShare: number | null };
  };
  daily: {
    day: string;
    requests: number;
    completed: number;
    unfulfilled: number;
    avgResponseSecs: number | null;
  }[];
  hourly: { hour: number; requests: number; avgResponseSecs: number | null }[];
  byService: {
    serviceId: string;
    name: string;
    icon: string | null;
    requests: number;
    completed: number;
    completionRate: number | null;
    avgResponseSecs: number | null;
  }[];
  byPriority: { priority: JobPriority; requests: number; avgResponseSecs: number | null }[];
  technicians: (Performance & { id: string; name: string; utilization: number | null })[];
}

export interface TestData {
  users: { id: string; name: string; email: string; role: Role; createdAt: string; skipped: boolean }[];
  jobs: {
    id: string;
    status: JobStatus;
    address: string;
    description: string | null;
    createdAt: string;
    customerName: string;
    rated: boolean;
    skipped: boolean;
  }[];
}

export interface TestDataPurge {
  deletedUsers: number;
  deletedJobs: number;
  skippedUsers: number;
  skippedJobs: number;
}
