-- CreateEnum
CREATE TYPE "WorldEntryType" AS ENUM ('concept', 'powerSystem', 'location', 'faction', 'race', 'rule', 'item', 'history');

-- CreateTable
CREATE TABLE "WorldEntry" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "type" "WorldEntryType" NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorldEntry_novelId_type_idx" ON "WorldEntry"("novelId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "WorldEntry_novelId_name_key" ON "WorldEntry"("novelId", "name");

-- AddForeignKey
ALTER TABLE "WorldEntry" ADD CONSTRAINT "WorldEntry_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
