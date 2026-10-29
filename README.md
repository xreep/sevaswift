# SevaSwift — Emergency Home Services Auto-Dispatch System

On-demand emergency home services (plumbing, electrical, AC, appliances and more). A customer
raises a request and the system offers it to the **fastest-arriving available technician** with
the right skill. Offers that aren't answered within a minute move on to the next technician
automatically. Customers then follow the technician live on a map with an ETA, and admins run
the whole operation from a real-time dashboard.

**Stack:** Node.js 20, Express 5, TypeScript, PostgreSQL 16 with Prisma, Socket.IO,
React 18 with Vite and Tailwind, and Leaflet with OpenStreetMap (maps and geocoding, no API key needed).

## PRD coverage

| PRD requirement | Where it lives |
|---|---|
| Secure login for Customer / Technician / Admin, RBAC | JWT access tokens + rotating httpOnly refresh cookie, `requireRole` on every route, role-guarded pages |
| Profile management | `/profile`: name, phone, password change (signs out other sessions) |
| Emergency request: category, GPS/manual location, description, photos, priority | `/customer/request`: GPS, address search (Nominatim) or tap-on-map; up to 3 photos; Emergency/Standard |
| Auto-dispatch: radius, fastest route, auto-assign, auto-reassign on timeout | `backend/src/modules/dispatch`: 15 km radius, road travel time (OpenRouteService if keyed, else distance), 60 s offer window, up to 3 rounds, then admin queue |
| Live location, ETA, status updates (Assigned / On the way / In progress / Completed) | `/jobs/:id` tracking page over Socket.IO; technician GPS heartbeat (or map placement / simulated drive for demos) |
| Admin: active jobs, technician availability, response time, analytics & reports | `/admin` live map + KPIs + feed, `/admin/jobs`, `/admin/technicians`, `/admin/reports` (charts + CSV export) |
| Manage workforce | Verify/reject technicians, suspend/reactivate accounts, manual assignment of unanswered jobs, service catalogue |
| Service history | `/customer/history`, `/technician/jobs`, status log + dispatch log per job |
| Feedback | 1–5 star rating and comment after completion; feeds technician rating and CSAT |
| KPIs: response time reduction, utilization, completion rate, CSAT, dispatch accuracy | `GET /api/v1/admin/analytics`, shown on the Reports page with period-over-period comparison |
| System logs: assignment, acceptance, status changes | `JobOffer` (every offer with distance, ETA, outcome, timings), `JobStatusHistory`, `AvailabilityLog` |
| Validation, error handling, security | zod on every input, RFC 7807-style errors, helmet CSP, rate limiting, bcrypt, image sniffing on uploads, CSV formula-injection guard |

### Pages

Login, Register, Forgot/Reset password, Verify email · **Customer:** Home, Request help, Live
tracking, Service history · **Technician:** Dashboard (availability, location, live offers,
skills, 30-day performance), My jobs, Job page with status actions · **Admin:** Live operations,
Jobs, Technicians, Customers, Reports, Services · **Everyone:** Profile.

## Demo accounts (password `Demo@123` for all)

| Role | Email |
|------|-------|
| Customer | customer@demo.sevaswift |
| Technician (central Delhi, every skill) | tech@demo.sevaswift |
| Admin | admin@demo.sevaswift |

The seed also creates 20 field technicians in Delhi, Mumbai, Bangalore and Hyderabad, two
technicians waiting for verification, a dozen customers and 30 days of realistic history (about 220
requests with offers, status logs, reviews and technician shifts), so every report has data.

### Try the full emergency flow

1. Open the app in two browser profiles (or one normal and one private window): sign in as the
   **technician** in one and the **customer** in the other.
2. Technician dashboard: you are already online. Choose **Set on map** and tap somewhere in
   central Delhi (browsers may block GPS; device GPS is used when allowed).
3. Customer: **Request help**, pick a service, search "Connaught Place" or tap the map in Delhi,
   and send. The technician gets a pop-up offer with a 60-second countdown.
4. Accept, then **Start driving to customer** and **Simulate drive to customer**. The customer's map
   and ETA update every 2 seconds. Mark Arrived, then In progress, then Completed, and rate the job as the customer.
5. Decline or ignore an offer to watch it move to the next-nearest technician. After 3 rounds it lands
   in the admin's **Needs assignment** queue, where an admin can assign it manually.
6. Sign in as **admin** to watch all of this live on the operations map and in Reports.

## Run locally

Prerequisites: Node.js 20, Docker (for Postgres), npm.

```bash
docker compose up -d                       # Postgres + test database
cd backend && cp .env.example .env && npm install
npx prisma migrate dev && npm run prisma:seed
npm run dev                                # API + Socket.IO on :4000
cd ../frontend && npm install && npm run dev   # web app on :5173 (proxies /api and /socket.io)
```

### Tests

```bash
cd backend && npm test       # 85 integration tests against the sevaswift_test database
cd frontend && npm test
```

## Deploy (one service, one URL)

The API serves the built web app when `FRONTEND_DIST` points at it, so the whole system
(pages, REST API and WebSockets) runs as a single web service on one origin.

**Render (recommended):** push the repo to GitHub, then in Render choose **New → Blueprint** and
select the repository. `render.yaml` creates the Postgres database and the web service, generates
JWT secrets, runs migrations and seeds demo data on start. The service URL is the live link.

**Docker (any host):** `docker build -t sevaswift .` then run with `DATABASE_URL`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (32+ chars each) and `CORS_ORIGIN`/`APP_URL` set to the public URL.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Token signing secrets, 32+ characters |
| `CORS_ORIGIN` / `APP_URL` | Public URL of the web app (defaults to Render's URL) |
| `FRONTEND_DIST` | Built web app directory to serve (e.g. `../frontend/dist`) |
| `DISPATCH_RADIUS_KM`, `OFFER_TIMEOUT_SECONDS`, `MAX_DISPATCH_ROUNDS`, `AVERAGE_SPEED_KMPH` | Dispatch tuning (15 / 60 / 3 / 25) |
| `ORS_API_KEY` | Optional OpenRouteService key for road travel times |
| `SMTP_URL`, `MAIL_FROM` | Optional SMTP for verification and reset emails (otherwise links are logged) |
| `REPORT_TIMEZONE` | Time zone for daily/hourly analytics (default `Asia/Kolkata`) |

## How auto-dispatch works

1. A customer raises a request with a service, location and priority.
2. Candidates are technicians who are **verified, online, skilled in that service, not on a job and
   not answering another offer**, within `DISPATCH_RADIUS_KM` of the job.
3. Up to 10 nearest are sent to OpenRouteService for road travel time (if `ORS_API_KEY` is set;
   otherwise distance ÷ `AVERAGE_SPEED_KMPH`).
4. The technician with the **fastest arrival** gets the offer (ties: higher rating, then shorter distance).
   Offer creation runs under a Postgres advisory lock so nobody holds two offers.
5. They have `OFFER_TIMEOUT_SECONDS` to accept; acceptance is an atomic compare-and-set (first accept wins).
   Reject or timeout → next-best technician, up to `MAX_DISPATCH_ROUNDS`.
6. If nobody accepts, the job becomes **Needs assignment** for an admin. Timers are re-armed from the
   database after a restart.

## API

All REST endpoints are under `/api/v1`. Errors are `{ status, code, message, fieldErrors? }`.

- **Auth:** `POST /auth/register|login|refresh|logout|verify-email|forgot-password|reset-password`, `GET /auth/me`
- **Profile:** `GET|PATCH /users/me`, `POST /users/me/password`
- **Uploads:** `POST /uploads` (multipart `file`, JPEG/PNG/WebP ≤ 5 MB), `GET /uploads/:id`
- **Catalog:** `GET /services`, `GET /services/:id`; admin `POST|PATCH|DELETE /services/:id`
- **Jobs:** `POST /jobs`, `GET /jobs?status=&active=`, `GET /jobs/:id`, `POST /jobs/:id/accept|reject|status|cancel|review`
- **Technician:** `GET /technicians/me`, `PATCH /technicians/me/availability`, `PUT /technicians/me/skills`,
  `POST /technicians/me/location`, `GET /technicians/me/offers`, `GET /technicians/me/stats`
- **Admin:** `GET /admin/overview`, `GET /admin/live`, `GET /admin/services`, `GET /admin/technicians`,
  `PATCH /admin/technicians/:id/verification`, `GET /admin/users`, `PATCH /admin/users/:id/status`,
  `GET /admin/jobs/:id/candidates`, `POST /admin/jobs/:id/assign`, `GET /admin/analytics?days=`,
  `GET /admin/reports/jobs.csv?days=`

### Real-time (Socket.IO, same origin)

Connect with `io({ auth: { token: accessToken } })`.

| Event (server → client) | Sent to | Payload |
|---|---|---|
| `offer:new` / `offer:closed` | the offered technician | `{ jobId, offerId, expiresAt }` / `{ jobId, offerId, reason }` |
| `job:status` | customer, assigned technician, admins, `job:{id}` subscribers | `{ jobId, from, to, at }` |
| `job:location` | `job:{id}` subscribers | `{ jobId, lat, lng, at, eta }` |
| `technician:location` / `technician:availability` | admins | `{ technicianId, lat, lng, at }` / `{ technicianId, isOnline }` |

Client → server: `job:subscribe { jobId }` (with ack; only users who can view the job) and `job:unsubscribe`.

## Docs

- Design spec: `docs/superpowers/specs/2026-10-07-dispatch-design.md`
- Plans: `docs/superpowers/plans/`
