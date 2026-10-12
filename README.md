# SevaSwift — Emergency Home Services Auto-Dispatch System

On-demand emergency home services (plumbing, electrical, AC repair) with Uber-style
auto-dispatch: the system scores available technicians by distance, skill, rating and
load, then assigns the best match instantly. Live tracking, ETA, and an admin
operations dashboard included.

**Stack:** Node.js 20 + Express 5 + TypeScript · PostgreSQL 16 + Prisma · Socket.IO ·
React 18 + Vite + Tailwind · Leaflet + OpenStreetMap

## Docs
- Design spec: `docs/superpowers/specs/2026-10-07-dispatch-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-10-07-phase-1-foundation.md`
- OpenCode handoff: `HANDOFF-opencode.md`

## Prerequisites
- Node.js 20 LTS
- Docker & Docker Compose
- pnpm (or npm/yarn)

## Quick Start

```bash
# 1. Clone and enter repo
git clone <repo-url>
cd sevaswift

# 2. Start Postgres (also creates the sevaswift_test database for tests)
docker compose up -d

# 3. Backend setup
cd backend
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev

# 4. Frontend setup (in another terminal)
cd frontend
npm install
npm run dev
```

## Demo Accounts (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Customer | customer@demo.sevaswift | Demo@123 |
| Technician | tech@demo.sevaswift | Demo@123 |
| Admin | admin@demo.sevaswift | Demo@123 |

## API Endpoints

All endpoints under `/api/v1`:

### Auth
- `POST /api/v1/auth/register` — Register (CUSTOMER, TECHNICIAN; technicians start PENDING admin verification)
- `POST /api/v1/auth/login` — Login
- `POST /api/v1/auth/refresh` — Refresh access token
- `POST /api/v1/auth/verify-email` — Verify email
- `POST /api/v1/auth/forgot-password` — Request password reset
- `POST /api/v1/auth/reset-password` — Reset password

### Technicians (role: TECHNICIAN)
- `GET /api/v1/technicians/me` — Profile, verification status, skills, location
- `PATCH /api/v1/technicians/me/availability` — Go online/offline (verified only; going offline declines the open offer)
- `PUT /api/v1/technicians/me/skills` — Set skills (`{ serviceIds: [] }`)
- `POST /api/v1/technicians/me/location` — GPS heartbeat
- `GET /api/v1/technicians/me/offers` — Job offers waiting for a response

### Catalog
- `GET /api/v1/services` — List all services
- `GET /api/v1/services/:id` — Get service details
- `POST /api/v1/services` — Create service (admin)
- `PATCH /api/v1/services/:id` — Update service (admin)
- `DELETE /api/v1/services/:id` — Delete service (admin)

### Jobs
- `POST /api/v1/jobs` — Raise an emergency request (customer); dispatched immediately
- `GET /api/v1/jobs` — List jobs (customer: own, technician: assigned, admin: all; `?status=`, `?active=true`)
- `GET /api/v1/jobs/:id` — Job details, live ETA and status timeline
- `POST /api/v1/jobs/:id/accept` — Accept an offer (technician; atomic, first accept wins)
- `POST /api/v1/jobs/:id/reject` — Decline an offer; re-dispatched to the next-best technician
- `POST /api/v1/jobs/:id/status` — `EN_ROUTE` → `ARRIVED` → `IN_PROGRESS` → `COMPLETED` (technician)
- `POST /api/v1/jobs/:id/cancel` — Cancel before the technician arrives (customer or admin)
- `POST /api/v1/jobs/:id/review` — Rate a completed job, once (customer)

## How auto-dispatch works

1. A customer raises a request with a service, location and priority.
2. Candidates: technicians who are **verified, online, skilled in that service, not busy**, and within
   `DISPATCH_RADIUS_KM` (default 15 km) of the job.
3. Up to 10 nearest are sent to OpenRouteService for road travel time (if `ORS_API_KEY` is set;
   otherwise distance ÷ `AVERAGE_SPEED_KMPH`).
4. The technician with the **fastest arrival** gets the offer (ties: higher rating, then shorter distance).
5. They have `OFFER_TIMEOUT_SECONDS` (default 60 s) to accept. Reject or timeout → the next-best
   technician is offered the job, up to `MAX_DISPATCH_ROUNDS` (default 3).
6. If nobody accepts, the job becomes `EXPIRED` for an admin to assign manually.

Every status change is recorded in `JobStatusHistory` and every offer (with distance, ETA and response)
in `JobOffer`, which gives the assignment, acceptance and status-change logs the PRD asks for.

## Project Structure

```
sevaswift/
├── backend/
│   ├── src/
│   │   ├── index.ts              # App entry point
│   │   ├── config/               # Configuration
│   │   ├── common/               # Shared utilities
│   │   │   ├── errors/           # Error classes
│   │   │   ├── middleware/       # Express middleware
│   │   │   ├── prisma.ts         # Prisma client
│   │   │   └── utils/            # Utilities (clock, etc.)
│   │   └── modules/              # Feature modules
│   │       ├── auth/
│   │       ├── users/
│   │       ├── technicians/
│   │       ├── catalog/
│   │       ├── jobs/
│   │       ├── dispatch/
│   │       ├── tracking/
│   │       ├── notifications/
│   │       ├── reviews/
│   │       └── admin/
│   ├── prisma/
│   │   ├── schema.prisma         # Database schema
│   │   └── seed.ts               # Seed script
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── contexts/
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml
└── README.md
```

## Development Commands

```bash
# Backend
cd backend
npm run dev          # Start dev server with hot reload
npm run build        # Compile TypeScript
npm run test         # Run tests
npm run lint         # Lint code
npm run format       # Format with Prettier
npm run prisma:studio # Open Prisma Studio

# Frontend
cd frontend
npm run dev          # Start Vite dev server
npm run build        # Build for production
npm run test         # Run tests
npm run lint         # Lint code
```

## Environment Variables

See `backend/.env.example` for all required variables. Key variables:

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| JWT_ACCESS_SECRET | Access token secret (32+ chars) |
| JWT_REFRESH_SECRET | Refresh token secret (32+ chars) |
| CORS_ORIGIN | Frontend URL for CORS |
| TEST_DATABASE_URL | Database used by `npm test` (defaults to local `sevaswift_test`) |

## Testing

```bash
# Run all tests
cd backend && npm test
cd frontend && npm test

# Backend tests use Jest + Supertest
# Frontend tests use Vitest + Testing Library
```

## Deployment (Phase 5)

- Backend → Render
- PostgreSQL → Neon
- Frontend → Vercel
- Image uploads → Cloudinary

## License

MIT