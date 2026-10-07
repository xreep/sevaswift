# SevaSwift — Emergency Home Services Auto-Dispatch System

On-demand emergency home services (plumbing, electrical, AC repair) with Uber-style
auto-dispatch: the system scores available technicians by distance, skill, rating and
load, then assigns the best match instantly. Live tracking, ETA, and an admin
operations dashboard included.

**Stack (per PRD):** Node.js 20 + Express 5 + TypeScript · PostgreSQL 16 + PostGIS ·
Redis (GEO + pub/sub) · Kafka · Socket.IO · React 18 + Tailwind · Google Maps API

## Docs
- Design spec: `docs/superpowers/specs/2026-10-07-dispatch-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-10-07-phase-1-foundation.md`
- OpenCode handoff: `HANDOFF-opencode.md`

## Build method
Spec-driven agentic development: design spec → phased plans → OpenCode executes
checkbox-by-checkbox with review gates between phases.
