-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "ServiceArea" DROP CONSTRAINT "ServiceArea_technicianId_fkey";

-- DropIndex
DROP INDEX "JobOffer_expiresAt_idx";

-- DropIndex
DROP INDEX "JobOffer_jobId_idx";

-- DropIndex
DROP INDEX "JobOffer_technicianId_idx";

-- AlterTable
ALTER TABLE "JobOffer" DROP COLUMN "response",
ADD COLUMN     "distanceKm" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "etaMinutes" INTEGER NOT NULL,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "round" INTEGER NOT NULL,
ADD COLUMN     "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "offeredAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "JobRequest" DROP COLUMN "photoKeys",
ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "dispatchRounds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photoUrls" TEXT[];

-- AlterTable
ALTER TABLE "JobStatusHistory" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "TechnicianProfile" DROP COLUMN "documentKey",
DROP COLUMN "documentType",
DROP COLUMN "lastLocation",
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3),
ALTER COLUMN "verificationStatus" SET DEFAULT 'PENDING';

-- DropTable
DROP TABLE "ServiceArea";

-- CreateIndex
CREATE INDEX "JobOffer_jobId_status_idx" ON "JobOffer"("jobId", "status");

-- CreateIndex
CREATE INDEX "JobOffer_technicianId_status_idx" ON "JobOffer"("technicianId", "status");

-- CreateIndex
CREATE INDEX "JobOffer_status_expiresAt_idx" ON "JobOffer"("status", "expiresAt");

