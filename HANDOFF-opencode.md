# SevaSwift — OpenCode Handoff
**Model:** Nemotron 3.5 Lightning · **Date:** 2026-10-07

## 1. Files in this repo
- `docs/superpowers/specs/2026-10-07-dispatch-design.md` — the design spec (read first)
- `docs/superpowers/plans/2026-10-07-phase-1-foundation.md` — the task list (execute this)
- `opencode.json` — model + auto-loaded instructions (fill in the model ID)

## 2. Kickoff prompt (paste as your first message to OpenCode)
```
You are building SevaSwift, an emergency home-services auto-dispatch platform.

First, read these two files completely:
- docs/superpowers/specs/2026-10-07-dispatch-design.md (the design spec)
- docs/superpowers/plans/2026-10-07-phase-1-foundation.md (your task list)

You are executing PHASE 1 ONLY. Work through the checkbox tasks in order, top to
bottom. Rules:
1. Complete one checkbox at a time. After each, run the relevant tests. Only move
   on when tests pass.
2. Commit after each completed section (A, B, C, D, E) with a clear message.
3. Follow the Global Constraints in the plan exactly — especially: Prisma Migrate
   owns the schema, /api/v1 prefix, RFC 7807-style errors, no controller touches
   Prisma directly (services own data access), money in integer paise, secrets in
   env vars only, .env never committed.
4. If a task is ambiguous, make the simplest reasonable choice and note it in your
   final summary — do not stop and ask unless truly blocked.
5. When all Phase 1 tasks are done, run the FULL test suite plus the Definition
   of Done checklist, then report: what was built, test results, and every place
   you deviated from the plan.

Do not start Phase 2. Do not deploy. Begin with section A (Scaffold & infrastructure).
```

## 3. Machine prerequisites
Node 20 LTS, Docker Desktop (postgres/postgis + redis + kafka), Git. Google Maps API
key and MSG91 key can wait until Phase 3 — the plan has console fallbacks.
