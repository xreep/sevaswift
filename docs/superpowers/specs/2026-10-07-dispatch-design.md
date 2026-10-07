# SevaSwift — Emergency Home Services Auto-Dispatch System — Design Spec

**Project:** Emergency Home Services Auto-Dispatch System (Home Services domain)
**Codename:** SevaSwift · **Repo:** `xreep/sevaswift`
**Author:** Aditya Raj · **Date:** 2026-10-07
**Source PRD:** Unified Mentor program (reference: Urban Company) — stack follows the PRD's suggestion

## 1. Summary

SevaSwift is an on-demand emergency home-services platform (plumbing, electrical, AC repair, appliance breakdowns). A customer raises an emergency request; the **auto-dispatch engine** scores available technicians by distance, skill match, rating, and current load, then assigns the best match instantly. The customer tracks the technician live on a map with ETA; the technician updates job status through their own dashboard; admins monitor everything from a live operations dashboard. The core differentiator vs. Urban Company-style scheduled booking is **speed**: this system exists for emergencies, so every design decision optimizes for minimum response time.

## 2. Decisions

| Topic | Decision |
|---|---|
| Repo structure | Monorepo: `backend/` (Node + Express) + `frontend/` (React) + `docs/`. Docker Compose for local infra |
| Backend | **Node.js 20 LTS + Express.js 5 + TypeScript** (per PRD), Prisma ORM |
| Database | **PostgreSQL 16 + PostGIS** (PRD allows MongoDB/PostgreSQL; Postgres chosen for geo queries and transactions); Prisma Migrate owns schema |
| Live locations | **Redis GEO** (`GEOADD`/`GEORADIUS`) — technician positions updated every ~10s while online (ioredis) |
| Real-time | **Socket.IO** (per PRD's WebSockets option) for live tracking + status; **Redis adapter** for fan-out across instances |
| Events | **Kafka** (kafkajs) topics: `job.events` (created/matched/accepted/enroute/arrived/completed/cancelled) — event-driven core |
| Matching | Scoring engine in TypeScript (distance 40%, skill match 25%, rating 20%, load 15%); atomic claim via Redis `SET NX` |
| Maps | **Google Maps API** (per PRD) for customer/technician maps + ETA; note: requires billing-enabled key — budget the free tier carefully |
| Notifications | Web Push + SMS (MSG91); console fallback when keys absent |
| Payments | **Out of scope Phase 1** (per PRD) — architecture leaves a `payment/` module stub |
| Auth | JWT access + rotating refresh tokens (httpOnly cookies); bcrypt; refresh-token reuse detection (replayed token → revoke all sessions), timing-safe login (dummy hash when email unknown) |
| Deployment | **Required by PRD** — backend → Render, Postgres → Neon (+PostGIS), Redis → Upstash, frontend → Vercel, Kafka → self-hosted or deferred (see §9); GitHub Actions CI |

## 3. Roles

| Role | Capabilities |
|---|---|
| **Customer** | Register/login, raise emergency request (category, GPS/manual location, description, photos, priority), live-track technician + ETA, view service history, rate technician, manage profile |
| **Technician** | Register + document verification, set skills & service areas, toggle online/offline, receive job offers, accept/reject, share live location while on job, update status, view earnings & history |
| **Admin/Dispatcher** | Live operations dashboard (active jobs, technician map), manual override/reassign, verification queues, workforce management, response-time analytics & reports |

## 4. Architecture

### 4.1 Backend (`backend/`, feature folders)
`src/modules/auth` · `src/modules/users` · `src/modules/technicians` (profile, verification, skills, availability) · `src/modules/catalog` (services, pricing rules) · `src/modules/jobs` (request lifecycle) · `src/modules/dispatch` (matching engine) · `src/modules/tracking` (live locations) · `src/modules/notifications` · `src/modules/reviews` · `src/modules/admin` · `src/common` (middleware, errors, geo utils). Each module: `*.routes.ts` → `*.controller.ts` → `*.service.ts` → Prisma. `src/modules/payment/` ships as an empty stub for Phase 2.

### 4.2 Frontend (`frontend/`, React 18 + Vite + TypeScript + Tailwind)
Pages (7, per PRD minimum): Login · Customer Request · Live Tracking · Service History · Technician Dashboard · Profile Management · Admin Panel. Role-guarded routes; TanStack Query; axios client with JWT auto-refresh.

### 4.3 Real-time & event flow
Customer raises request → POST /api/v1/jobs → job CREATED → Kafka: job.created → Dispatch engine scores online technicians (Redis GEO radius + skill + rating + load) → Best match → job MATCHED → Kafka: job.matched → push/SMS to technician → Technician accepts within 60s (atomic claim, Redis SET NX) → ACCEPTED → customer sees live tracking (Socket.IO room job:{id}) → EN_ROUTE (GPS live) → ARRIVED → IN_PROGRESS → COMPLETED. Timeout/no acceptance → auto-reassign to next-best (up to 3 rounds) → else admin queue.

### 4.4 Dispatch performance
Target: match + notify in <2s. Redis GEO radius query → score in TypeScript → single write. Live location updates via Socket.IO, throttled to 10s; positions in Redis only (not Postgres).

## 5. Data Model (Prisma)

- **User** — id, name, email (unique), phone, passwordHash, role (CUSTOMER/TECHNICIAN/ADMIN), status
- **TechnicianProfile** — userId, verificationStatus (UNSUBMITTED/PENDING/VERIFIED/REJECTED), documentKey, ratingAvg, ratingCount, completedJobs
- **TechnicianSkill** — technicianId, serviceId
- **ServiceArea** — technicianId, PostGIS polygon (or center + radiusKm fallback)
- **Service** (catalog) — id, name, category, baseFee (paise), icon
- **JobRequest** — id, customerId, serviceId, lat/lng, address, description, photoKeys, priority (NORMAL/URGENT), status, technicianId (nullable), createdAt, acceptedAt, completedAt, responseTimeSecs
- **JobStatusHistory** — jobId, fromStatus, toStatus, at (audit trail)
- **JobOffer** — jobId, technicianId, offeredAt, expiresAt, response (audit of dispatch rounds)
- **Review** — jobId, rating 1–5, comment
- **RefreshToken** — hashed, rotating

### Job lifecycle
CREATED → MATCHED → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED. Branches: CANCELLED (customer/admin, policy-dependent), EXPIRED (no technician found → admin queue), REASSIGNED (transient, returns to MATCHED with next-best technician).

## 6. Core Logic

### 6.1 Matching score
Eligible: VERIFIED, online, has the required skill, inside service area, within 15 km radius. Score (0–100): score = 40 × distanceScore + 25 × skillMatch + 20 × ratingNorm + 15 × loadScore. Highest wins; ties broken by earliest availability timestamp.

### 6.2 Atomic claim (race safety)
Redis `SET job:{id}:claim {techId} NX EX 60`. First accept wins; losers get ALREADY_CLAIMED.

### 6.3 Reassignment
60s to accept. On timeout/reject: next-best offered (max 3 rounds, excluding decliners). After 3 rounds → EXPIRED → admin manual-dispatch queue with full offer history.

### 6.4 ETA
Google Maps Distance Matrix API initially (per PRD); haversine ÷ 25 km/h fallback if unavailable or over budget.

### 6.5 Cancellation policy
Customer cancels before accept: free. After accept, before arrival: ₹49 fee credited to technician. Technician cancels: strike; 3 strikes in 30 days → admin review.

### 6.6 Verification
Technicians upload ID + trade certificate; private storage, signed URLs; admin approves/rejects with reasons. Unverified technicians never enter the matching pool.

## 7. API Surface (v1, REST + Socket.IO)
- `POST /api/v1/auth/*` — register/login/refresh (httpOnly cookies)/verify-email/reset-password (3 roles; ADMIN not self-registrable)
- `GET/POST /api/v1/jobs` — raise + list; `GET /api/v1/jobs/{id}` — detail + live status
- `POST /api/v1/jobs/{id}/accept|reject|status` — technician actions (claim-checked)
- `POST /api/v1/jobs/{id}/cancel` — policy-enforced
- `GET /api/v1/technicians/me` — profile, availability toggle, earnings
- `GET /api/v1/admin/overview|jobs|technicians|reports` — dispatcher dashboard
- Socket.IO room `job:{id}` — technician lat/lng + status frames
- `POST /api/v1/technicians/location` — GPS heartbeat (→ Redis GEO)
All errors: RFC 7807-style problem JSON `{ status, code, message, fieldErrors? }`.

## 8. Testing Strategy
Backend: Jest + Supertest — scoring engine unit tests, claim race tests, lifecycle tests, API integration tests. Frontend: Vitest + Testing Library. Phase 5 includes a scripted end-to-end drill (raise → dispatch → accept → track → complete).

## 9. Deployment (PRD-mandated)
Live link required. Backend → Render (Docker), Postgres → Neon (+PostGIS), Redis → Upstash, frontend → Vercel. Kafka: if managed Kafka blocks the timeline, Phase 1 ships an in-process event emitter behind the same `EventPublisher` interface; kafkajs wired in Phase 2 without touching domain code.
