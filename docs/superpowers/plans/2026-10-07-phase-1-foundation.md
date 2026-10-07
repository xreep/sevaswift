# Phase 1 — Foundation (Scaffold, Auth, Technicians, Catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Express API + React app where customers, technicians, and admins can register, verify email, log in, and manage profiles; technicians can submit verification documents and define skills/service areas; a service catalog exists; seed data loads; CI runs tests on every push.

**Architecture:** Monorepo `backend/` (Node 20 + Express 5 + TypeScript, feature modules under `src/modules`, Prisma + PostgreSQL 16 + PostGIS, stateless JWT auth in httpOnly cookies) + `frontend/` (React 18 + Vite + TypeScript + Tailwind, TanStack Query, axios with auto-refresh). Docker Compose runs postgres/postgis + redis + kafka locally. No dispatch engine yet — that is Phase 2.

**Tech Stack:** Node 20 LTS, Express 5, TypeScript 5, Prisma 6, PostgreSQL 16 + PostGIS, Redis 7 (ioredis), Kafka 3.x (kafkajs), jsonwebtoken, bcrypt, zod, helmet, express-rate-limit, swagger (swagger-jsdoc); React 18, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query, Axios, React Hook Form + Zod, Google Maps JS API, Vitest + Testing Library; Jest + Supertest (backend tests).

**Spec:** `docs/superpowers/specs/2026-10-07-dispatch-design.md` (stack follows the PRD: Node/Express per Unified Mentor requirements)

**Phase roadmap (each phase gets its own plan file, written when the previous phase is done):**
1. **Foundation** — this plan (scaffold, auth, technician profiles + verification docs, service catalog, seed data)
2. Job lifecycle + auto-dispatch engine (matching score, atomic claim, reassignment rounds)
3. Real-time (Socket.IO tracking, Redis GEO live locations, Kafka events, ETA)
4. Admin dispatcher dashboard, notifications (push/SMS), reviews, cancellation policy
5. End-to-end testing drill, polish, seed expansion, **live deployment (PRD-mandated)**

## Global Constraints
- Node 20 LTS; TypeScript strict mode. Express 5.
- Prisma Migrate owns the schema (`prisma/migrations/`). Never edit an applied migration; add a new one.
- All REST endpoints under `/api/v1`. All errors are RFC 7807-style JSON `{ status, code, message, fieldErrors? }`.
- Module structure: `src/modules/<feature>/{*.routes.ts, *.controller.ts, *.service.ts}`; no controller touches Prisma directly — services own data access; no raw DB rows in API responses — DTOs only.
- Secrets via env vars only (`.env.example` committed, `.env` never); dev defaults harmless.
- `Date.now()` wrapped in a `clock()` util for testable time. Money in integer paise (never float rupees).
- If a shell path contains spaces, always quote it.

## Tasks

### A. Scaffold & infrastructure
- [ ] Backend scaffold: `npm init`, TypeScript, Express 5, folder layout, eslint + prettier
- [ ] Prisma init: schema with User, TechnicianProfile, TechnicianSkill, ServiceArea, Service, RefreshToken; V1 migration
- [ ] `docker-compose.yml`: postgres:16 + postgis, redis:7, kafka (kraft mode, single broker for dev)
- [ ] Env config (`src/config.ts`): dev/test/prod; `.env.example`
- [ ] GitHub Actions: backend `npm test`, frontend `npm test` + build, on every push
- [ ] README: prerequisites, `docker compose up`, run instructions, demo accounts table

### B. Auth (3 roles, hardened)
- [ ] `modules/auth`: register/login/refresh/verify-email/reset-password; roles CUSTOMER/TECHNICIAN/ADMIN
- [ ] ADMIN not self-registrable (reject with INVALID_ROLE)
- [ ] Refresh-token rotation + reuse detection (replayed token → revoke all sessions for user)
- [ ] Login timing-attack protection (bcrypt compare against dummy hash when email unknown)
- [ ] Email normalization (lowercase + trim); rate-limited auth endpoints (express-rate-limit)
- [ ] JWT in httpOnly cookies; helmet security headers
- [ ] Frontend: Login/Register/ForgotPassword/ResetPassword/VerifyEmail pages; axios interceptors with auto refresh-on-401
- [ ] Role-guarded routes (customer / technician / admin shells)

### C. Technician profiles & verification
- [ ] `modules/technicians`: TechnicianProfile (verificationStatus, ratingAvg, ratingCount), skills join, service areas (PostGIS polygon + radiusKm fallback)
- [ ] Document upload (ID + trade certificate) → private local storage in dev; HMAC-signed time-limited URLs
- [ ] Verification lifecycle: UNSUBMITTED → PENDING → VERIFIED/REJECTED (admin endpoints stubbed now, UI in Phase 4)
- [ ] Technician dashboard page: profile, availability toggle (online/offline persisted), skills & service-area editor
- [ ] Only VERIFIED technicians enter the matching pool (enforced in Phase 2)

### D. Service catalog
- [ ] `modules/catalog`: Service table (plumbing, electrical, AC repair, appliance, carpentry, painting) with baseFee (paise) and category
- [ ] CRUD for admin (stub UI), public read endpoint; seed 8–10 services
- [ ] Customer request page: category select, location (browser GPS + manual), description, photo upload — stub stores a DRAFT (dispatch wired in Phase 2)

### E. Seed data & tests
- [ ] Seed script: 3 demo accounts per role, 10 services, 20 demo technicians across 4 Indian cities
- [ ] Backend tests (Jest + Supertest): auth flow, verification lifecycle, catalog CRUD, rate limiting
- [ ] Frontend tests: auth pages, role guards, technician dashboard (Vitest, colocated)

## Definition of Done (Phase 1)
- [ ] `docker compose up` + backend + frontend run with zero manual DB setup
- [ ] All three roles can register, verify email, log in; refresh rotation works; admin cannot self-register
- [ ] Technician can upload documents, set skills + service area, toggle availability
- [ ] Service catalog browsable; customer can draft a request with location + photos
- [ ] CI green; README documents every demo login; no secrets in repo
