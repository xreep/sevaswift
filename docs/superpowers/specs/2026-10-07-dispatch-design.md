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
| Database | **PostgreSQL 16** (PRD allows MongoDB/PostgreSQL; Postgres chosen for transactions); Prisma Migrate owns schema. Distance via haversine in TypeScript (no PostGIS needed at this scale) |
| Live locations | Technician position stored on `TechnicianProfile` and broadcast over Socket.IO, updated every ~10s while online |
| Real-time | **Socket.IO** (per PRD's WebSockets option) for live tracking, status updates and job offers. Single instance; Redis adapter is the documented scale-out path |
| Events | In-process `EventEmitter` behind an `EventPublisher` interface (job created/matched/accepted/status/completed/cancelled). Kafka is not required by the PRD and is the scale-out path |
| Matching | Eligible = verified, online, skilled, idle, within radius. Ranked by fastest arrival (road time when available), ties by rating then distance — the PRD asks for the nearest/fastest technician. Atomic claim via a conditional Postgres update (`WHERE status = 'MATCHED'`) |
| Maps | **Leaflet + OpenStreetMap** (free, no key) for maps; **OpenRouteService** for road travel time/ETA with haversine ÷ 25 km/h fallback. Avoids the PRD's map-API cost constraint |
| Notifications | Web Push + SMS (MSG91); console fallback when keys absent |
| Payments | **Out of scope Phase 1** (per PRD) — architecture leaves a `payment/` module stub |
| Auth | JWT access + rotating refresh tokens (httpOnly cookies); bcrypt; refresh-token reuse detection (replayed token → revoke all sessions), timing-safe login (dummy hash when email unknown) |
| Deployment | **Required by PRD** — backend → Render, Postgres → Neon, frontend → Vercel, image uploads → Cloudinary; GitHub Actions CI |

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
Customer raises request → POST /api/v1/jobs → job CREATED → event job.created → Dispatch engine scores online technicians (radius + skill + rating + load) → Best match → job MATCHED → event job.matched → in-app Socket.IO offer to technician → Technician accepts within 60s (atomic conditional update) → ACCEPTED → customer sees live tracking (Socket.IO room job:{id}) → EN_ROUTE (GPS live) → ARRIVED → IN_PROGRESS → COMPLETED. Timeout/no acceptance → auto-reassign to next-best (up to 3 rounds) → else admin queue.

### 4.4 Dispatch performance
Target: match + notify in <2s. Load online, verified, skilled technicians → filter by radius → score in TypeScript → single write. Live location updates via Socket.IO, throttled to 10s.

## 5. Data Model (Prisma)

- **User** — id, name, email (unique), phone, passwordHash, role (CUSTOMER/TECHNICIAN/ADMIN), status
- **TechnicianProfile** — userId, verificationStatus (PENDING/VERIFIED/REJECTED, admin-approved), isOnline, lastLat/lastLng, ratingAvg, ratingCount, completedJobs
- **TechnicianSkill** — technicianId, serviceId
- **Service** (catalog) — id, name, category, baseFee (paise), icon
- **JobRequest** — id, customerId, serviceId, lat/lng, address, description, photoKeys, priority (NORMAL/URGENT), status, technicianId (nullable), createdAt, acceptedAt, completedAt, responseTimeSecs
- **JobStatusHistory** — jobId, fromStatus, toStatus, at (audit trail)
- **JobOffer** — jobId, technicianId, offeredAt, expiresAt, response (audit of dispatch rounds)
- **Review** — jobId, rating 1–5, comment
- **RefreshToken** — hashed, rotating

### Job lifecycle
CREATED → MATCHED → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED. Branches: CANCELLED (customer/admin, policy-dependent), EXPIRED (no technician found → admin queue), REASSIGNED (transient, returns to MATCHED with next-best technician).

## 6. Core Logic

### 6.1 Matching
Eligible: VERIFIED, online, has the required skill, not on an active job or holding another offer, within 15 km (straight line). The 10 nearest get road travel times (OpenRouteService, fallback distance ÷ 25 km/h). Ranked by ETA ascending; ties by rating descending, then distance, then id. Offer creation is serialized with a Postgres advisory lock so a technician never holds two offers.

### 6.2 Atomic claim (race safety)
`UPDATE JobRequest SET status = 'ACCEPTED' ... WHERE id = {id} AND status = 'MATCHED' AND technicianId = {techId}` — Postgres row locking makes it atomic. First accept wins; losers get ALREADY_CLAIMED.

### 6.3 Reassignment
60s to accept. On timeout/reject: next-best offered (max 3 rounds, excluding decliners). After 3 rounds → EXPIRED → admin manual-dispatch queue with full offer history.

### 6.4 ETA
OpenRouteService driving time; haversine ÷ 25 km/h fallback if unavailable or over the free quota.

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
- `POST /api/v1/technicians/location` — GPS heartbeat (stored + broadcast over Socket.IO)
All errors: RFC 7807-style problem JSON `{ status, code, message, fieldErrors? }`.

## 8. Testing Strategy
Backend: Jest + Supertest — scoring engine unit tests, claim race tests, lifecycle tests, API integration tests. Frontend: Vitest + Testing Library. Phase 5 includes a scripted end-to-end drill (raise → dispatch → accept → track → complete).

## 9. Deployment (PRD-mandated)
Live link required. Backend → Render, Postgres → Neon, frontend → Vercel, uploads → Cloudinary.

**Stack revision (2026-10-12):** Kafka, Redis and PostGIS were dropped — none is required by the PRD, and none runs on the free hosting tiers the deployment uses. Events go through an in-process `EventPublisher`; offer timeouts use in-process timers that are re-armed on startup. Scaling to multiple instances would add the Socket.IO Redis adapter and a job queue behind the same interfaces.
