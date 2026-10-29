# Single image: builds the web app and the API; the API serves both on one port.
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
RUN cd frontend && npm run build
COPY backend/package*.json backend/
COPY backend/prisma backend/prisma
RUN cd backend && npm ci && npx prisma generate
COPY backend backend
RUN cd backend && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production FRONTEND_DIST=../frontend/dist PORT=4000
COPY --from=build /app/frontend/dist frontend/dist
COPY --from=build /app/backend backend
WORKDIR /app/backend
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run prisma:seed && node dist/index.js"]
