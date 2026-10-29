-- AlterTable
ALTER TABLE "JobOffer" ADD COLUMN     "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "JobRequest" ADD COLUMN     "dispatchRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "DispatchAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "offeredTechnicianId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchAttempt_jobId_at_idx" ON "DispatchAttempt"("jobId", "at");

-- AddForeignKey
ALTER TABLE "DispatchAttempt" ADD CONSTRAINT "DispatchAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
