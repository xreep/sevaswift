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

## Prerequisites
- Node.js 20 LTS
- Docker & Docker Compose
- pnpm (or npm/yarn)

## Quick Start

```bash
# 1. Clone and enter repo
git clone <repo-url>
cd sevaswift

# 2. Start infrastructure (Postgres + PostGIS, Redis, Kafka)
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
- `POST /api/v1/auth/register` — Register (CUSTOMER, TECHNICIAN)
- `POST /api/v1/auth/login` — Login
- `POST /api/v1/auth/refresh` — Refresh access token
- `POST /api/v1/auth/verify-email` — Verify email
- `POST /api/v1/auth/forgot-password` — Request password reset
- `POST /api/v1/auth/reset-password` — Reset password

### Technicians
- `GET /api/v1/technicians/me` — Get profile
- `PATCH /api/v1/technicians/me` — Update profile
- `POST /api/v1/technicians/me/documents` — Upload verification docs
- `PATCH /api/v1/technicians/me/availability` — Toggle online/offline
- `POST /api/v1/technicians/me/skills` — Add skill
- `DELETE /api/v1/technicians/me/skills/:serviceId` — Remove skill
- `POST /api/v1/technicians/me/service-areas` — Add service area
- `DELETE /api/v1/technicians/me/service-areas/:id` — Remove service area

### Catalog
- `GET /api/v1/services` — List all services
- `GET /api/v1/services/:id` — Get service details
- `POST /api/v1/services` — Create service (admin)
- `PATCH /api/v1/services/:id` — Update service (admin)
- `DELETE /api/v1/services/:id` — Delete service (admin)

### Jobs (Phase 2)
- `POST /api/v1/jobs` — Create job request
- `GET /api/v1/jobs` — List user's jobs
- `GET /api/v1/jobs/:id` — Get job details

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
| REDIS_URL | Redis connection string |
| JWT_ACCESS_SECRET | Access token secret (32+ chars) |
| JWT_REFRESH_SECRET | Refresh token secret (32+ chars) |
| CORS_ORIGIN | Frontend URL for CORS |
| GOOGLE_MAPS_API_KEY | Google Maps API key (Phase 2+) |

## Testing

```bash
# Run all tests
cd backend && npm test
cd frontend && npm test

# Backend tests use Jest + Supertest
# Frontend tests use Vitest + Testing Library
```

## Deployment (Phase 5)

Per PRD requirements:
- Backend → Render (Docker)
- PostgreSQL → Neon (+ PostGIS)
- Redis → Upstash
- Frontend → Vercel
- Kafka → Self-hosted or deferred

## License

MIT