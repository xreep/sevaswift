# Phase 2 — Job Lifecycle + Auto-Dispatch Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer raises a real emergency request; the dispatch engine scores eligible technicians and offers the job to the best match; the technician accepts (atomic claim) or the offer auto-reassigns through up to 3 rounds; both sides see live status transitions through to completion.

**Architecture:** New `src/modules/jobs` (request lifecycle + state machine) and `src/modules/dispatch` (matching engine). `EventPublisher` interface in `src/common/events/` with an in-process implementation (spec §9 escape hatch — kafkajs wires in later without touching domain code). Offer expiry via BullMQ delayed jobs on Redis. Frontend: customer request page fully wired (replaces the Phase 1 stub); technician incoming-job view with accept/reject + status buttons.

**Tech Stack (additions to Phase 1):** ioredis, bullmq.

**Spec:** `docs/superpowers/specs/2026-10-07-dispatch-design.md` (§4.3, §5, §6)

**Phase roadmap:** 1. Foundation ✅ (pending test verification) → 2. **Dispatch engine** (this plan) → 3. Real-time tracking (Socket.IO, live GPS, ETA) → 4. Admin dashboard, notifications, reviews → 5. E2E drill, polish, **live deployment (PRD-mandated)**

## Global Constraints

- All Phase 1 constraints carry over (Prisma Migrate owns schema, `/api/v1`, RFC 7807 errors, services own data access, DTOs only, paise not rupees, env-only secrets, `clock()` for time).
- Job status transitions go through a **state machine** — illegal transitions rejected with `INVALID_TRANSITION`. No direct status writes.
- Every status change writes a `JobStatusHistory` row AND publishes a job event. No silent transitions.
- The offer claim must be **atomic** — Redis `SET NX`, never check-then-set.
- Scoring is a **pure function** — same inputs → same score, unit-testable with fixtures.

## Tasks

### A. Job domain
- [ ] Prisma migration V2: `JobRequest`, `JobStatusHistory`, `JobOffer` (per spec §5)
- [ ] `modules/jobs`: `POST /api/v1/jobs` (create), `GET /api/v1/jobs` (list mine), `GET /api/v1/jobs/{id}` (detail + status)
- [ ] Lifecycle state machine: `CREATED → MATCHED → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED`, branches `CANCELLED` / `EXPIRED` / `REASSIGNED`
- [ ] `POST /api/v1/jobs/{id}/status` — technician advances status (transition-validated)
- [ ] `POST /api/v1/jobs/{id}/cancel` — cancellation policy per spec §6.5 (free before accept; 4900 paise fee recorded on the job after accept — no payment processing, that's out of scope)

### B. Event publishing (escape hatch)
- [ ] `src/common/events/EventPublisher` interface: `publish(topic, event)`
- [ ] In-process implementation (Node EventEmitter) behind the interface
- [ ] Topics: `job.created`, `job.matched`, `job.accepted`, `job.rejected`, `job.expired`, `job.status_changed`, `job.completed`, `job.cancelled`

### C. Dispatch engine (the core)
- [ ] `modules/dispatch/dispatch.service.ts`:
  - `findCandidates(job)` — VERIFIED + online + has required skill + service area covers job location + within 15 km (Redis GEO radius over technician positions; positions seeded from service-area centers until Phase 3 live GPS)
  - `scoreTechnician(tech, job)` — pure function: `40 × distanceScore + 25 × skillMatch + 20 × ratingNorm + 15 × loadScore`; ties → earliest availability timestamp
  - `dispatchJob(jobId)` — score candidates → create `JobOffer` (60s expiry) → publish `job.matched` → return offered technician
- [ ] Unit tests with deterministic fixtures: known best-match wins; tie-break correct; unskilled/out-of-range techs excluded

### D. Atomic claim
- [ ] `POST /api/v1/jobs/{id}/accept` — Redis `SET job:{id}:claim {techId} NX EX 60`; first accept wins, losers get `ALREADY_CLAIMED`
- [ ] `POST /api/v1/jobs/{id}/reject` — records response, triggers immediate re-dispatch excluding the decliner
- [ ] Race tests: N parallel accepts → exactly one winner

### E. Reassignment rounds
- [ ] BullMQ delayed job per offer (60s); on expiry with no response → offer next-best candidate (max 3 rounds, excluding decliners)
- [ ] After 3 rounds → job `EXPIRED` → appears in `GET /api/v1/admin/dispatch-queue` with full offer history
- [ ] `POST /api/v1/admin/jobs/{id}/assign { technicianId }` — manual override (dispatcher)

### F. Customer request page (full wiring — replaces Phase 1 stub)
- [ ] Service select (from catalog), GPS + manual location, description, photo upload, NORMAL/URGENT priority toggle
- [ ] Submit → creates job → "finding your technician…" state → offer result → assigned technician card (name, rating, ETA placeholder)
- [ ] Service History page: past jobs with status timeline

### G. Technician incoming-job view
- [ ] Offer card: service, customer distance, 60s countdown, Accept / Reject
- [ ] Status buttons: EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED (transition-validated)

### H. Phase 1 carryovers
- [ ] HMAC-signed time-limited document URLs (deferred from Phase 1)
- [ ] `POST /api/v1/technicians/location` — heartbeat writes to Redis GEO (full live-tracking UI is Phase 3)

### I. Tests — must actually RUN green
- [ ] Scoring unit tests (deterministic fixtures)
- [ ] Claim race tests (parallel accepts → exactly one winner)
- [ ] Lifecycle transition tests (legal + illegal transitions)
- [ ] API integration tests: register → raise job → dispatch → accept → complete, against seeded data
- [ ] Tests run against real Postgres + Redis via `docker compose` locally AND CI service containers. "No Docker in the agent environment" is not an accepted reason — run them where Docker exists.

## Definition of Done (Phase 2)

- [ ] **Happy-path drill:** seed customer + 3 technicians (near+skilled, far+skilled, near+unskilled) → raise URGENT plumbing request → nearest skilled tech gets the offer → accept → status flows to COMPLETED → history rows + events all recorded
- [ ] **Timeout drill:** technician ignores the offer → auto-reassign to next-best within ~65s → after 3 ignored rounds job lands EXPIRED in the admin dispatch queue
- [ ] **Race drill:** 5 parallel accepts on the same offer → exactly 1 winner, 4 get `ALREADY_CLAIMED`
- [ ] `npm test` green on backend AND frontend, locally and in CI
- [ ] No secrets in repo; README documents the drill steps
