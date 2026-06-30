/*
  Warnings (from Prisma generator):

  - You are about to drop the column `modelConfigId` on the `AgentModelOverride` table. All the data in the column will be lost.
  - You are about to drop the column `activeModelConfigId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `ModelConfig` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[activeModelId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `modelId` to the `AgentModelOverride` table without a default value. This is not possible if the table is not empty.

  NOTE: This migration has been hand-edited (reordered) so the data-migration window is valid.
  The raw Prisma-generated ordering created Vendor/Model AFTER dropping ModelConfig and adding
  NOT NULL columns, leaving no window to copy ModelConfig rows into Vendor/Model. The reorder:
    1. Drop FKs/indexes pointing at ModelConfig
    2. CREATE Vendor + Model (+ their FKs)
    3. ADD new columns as NULLABLE (activeModelId, modelId, temperature)
    4. DATA MIGRATION: ModelConfig → Vendor (dedup) + Model (map) + remap User.activeModelId / Override.modelId
    5. ENFORCE constraints (Override.modelId NOT NULL; unique index on User.activeModelId; new FKs)
    6. DROP old columns + ModelConfig table
*/

-- ── 1. Drop existing FKs / unique index pointing at ModelConfig ─────────────
-- DropForeignKey
ALTER TABLE "AgentModelOverride" DROP CONSTRAINT "AgentModelOverride_modelConfigId_fkey";

-- DropForeignKey
ALTER TABLE "ModelConfig" DROP CONSTRAINT "ModelConfig_userId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_activeModelConfigId_fkey";

-- DropIndex
DROP INDEX "User_activeModelConfigId_key";

-- ── 2. Create new Vendor / Model tables and their FKs FIRST ────────────────
-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Model" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vendor_userId_idx" ON "Vendor"("userId");

-- CreateIndex
CREATE INDEX "Model_vendorId_idx" ON "Model"("vendorId");

-- AddForeignKey: Vendor → User
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Model → Vendor
ALTER TABLE "Model" ADD CONSTRAINT "Model_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Add NEW columns as NULLABLE (NOT NULL enforced post-migration) ──────
-- AlterTable: User — add activeModelId (nullable; unique index added after data migration)
ALTER TABLE "User" ADD COLUMN     "activeModelId" TEXT;

-- AlterTable: AgentModelOverride — add modelId (nullable for now) + temperature
ALTER TABLE "AgentModelOverride" ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "temperature" DOUBLE PRECISION;

-- ── 4. DATA MIGRATION: ModelConfig → Vendor (dedup) + Model (map) + remap ─
-- Window invariant: Vendor & Model exist; User.activeModelConfigId,
-- AgentModelOverride.modelConfigId, and the ModelConfig table are ALL still intact.
--
-- IMPORTANT PostgreSQL semantics: data-modifying CTEs (INSERT/UPDATE/DELETE in WITH)
-- are NOT mutually visible within the same statement — sibling CTEs cannot see each
-- other's writes, and the trailing UPDATE/SELECT cannot see them either, UNLESS they
-- reference the CTE *by name*. So we split into 3 separate statements:
--   (a) INSERT Vendor (dedup) — reads old ModelConfig
--   (b) INSERT Model — reads old ModelConfig JOINs the now-committed Vendor TABLE
--   (c) UPDATE User + UPDATE Override — reads old ModelConfig JOINs committed Vendor/Model tables
-- Each statement commits its writes to the table, so the NEXT statement sees them.
INSERT INTO "Vendor" ("id", "userId", "name", "provider", "baseUrl", "apiKey", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "userId",
  COALESCE(NULLIF(MIN("name"), ''), "provider" || '/' || MIN("model")),
  "provider",
  "baseUrl",
  "apiKey",
  NOW(),
  NOW()
FROM "ModelConfig"
GROUP BY "userId", "provider", "baseUrl", "apiKey";

-- (b) Model rows — Vendor table is now populated, so the JOIN resolves each model to its vendor.
INSERT INTO "Model" ("id", "vendorId", "model", "temperature", "name", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  vm."id",
  mc."model",
  mc."temperature",
  mc."name",
  NOW(),
  NOW()
FROM "ModelConfig" mc
JOIN "Vendor" vm
  ON vm."userId" = mc."userId"
  AND vm."provider" = mc."provider"
  AND COALESCE(vm."baseUrl", '') = COALESCE(mc."baseUrl", '')
  AND vm."apiKey" = mc."apiKey";

-- (c) Remap User.activeModelConfigId → activeModelId (locate new Model by vendor+model uniquely)
UPDATE "User" u SET "activeModelId" = (
  SELECT mm."id"
  FROM "ModelConfig" mc
  JOIN "Vendor" vm ON vm."userId" = mc."userId" AND vm."provider" = mc."provider"
    AND COALESCE(vm."baseUrl", '') = COALESCE(mc."baseUrl", '') AND vm."apiKey" = mc."apiKey"
  JOIN "Model" mm ON mm."vendorId" = vm."id" AND mm."model" = mc."model"
  WHERE mc."id" = u."activeModelConfigId"
  LIMIT 1
)
WHERE u."activeModelConfigId" IS NOT NULL;

-- (d) Remap AgentModelOverride.modelConfigId → modelId
UPDATE "AgentModelOverride" o SET "modelId" = (
  SELECT mm."id"
  FROM "ModelConfig" mc
  JOIN "Vendor" vm ON vm."userId" = mc."userId" AND vm."provider" = mc."provider"
    AND COALESCE(vm."baseUrl", '') = COALESCE(mc."baseUrl", '') AND vm."apiKey" = mc."apiKey"
  JOIN "Model" mm ON mm."vendorId" = vm."id" AND mm."model" = mc."model"
  WHERE mc."id" = o."modelConfigId"
  LIMIT 1
)
WHERE o."modelConfigId" IS NOT NULL;

-- ── 5. Enforce constraints now that data is in place ───────────────────────
-- Safety: if any AgentModelOverride.modelId is still NULL (orphan), fail loudly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AgentModelOverride" WHERE "modelId" IS NULL) THEN
    RAISE EXCEPTION 'AgentModelOverride rows with unresolved modelId after data migration';
  END IF;
END $$;

ALTER TABLE "AgentModelOverride" ALTER COLUMN "modelId" SET NOT NULL;

-- Unique index on User.activeModelId (NULLs allowed → multiple NULLs OK; populated values unique)
CREATE UNIQUE INDEX "User_activeModelId_key" ON "User"("activeModelId");

-- AddForeignKey: User.activeModelId → Model
ALTER TABLE "User" ADD CONSTRAINT "User_activeModelId_fkey" FOREIGN KEY ("activeModelId") REFERENCES "Model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: AgentModelOverride.modelId → Model
ALTER TABLE "AgentModelOverride" ADD CONSTRAINT "AgentModelOverride_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 6. Drop OLD columns + ModelConfig table (nothing reads them anymore) ───
-- AlterTable: drop old pointer columns
ALTER TABLE "User" DROP COLUMN "activeModelConfigId";

ALTER TABLE "AgentModelOverride" DROP COLUMN "modelConfigId";

-- DropTable
DROP TABLE "ModelConfig";
