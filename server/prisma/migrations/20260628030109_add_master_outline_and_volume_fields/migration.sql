-- AlterTable
ALTER TABLE "Volume" ADD COLUMN     "bridge" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mainProgress" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "MasterOutline" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT '',
    "mainLine" TEXT NOT NULL DEFAULT '',
    "ending" TEXT NOT NULL DEFAULT '',
    "powerProgression" JSONB NOT NULL DEFAULT '[]',
    "hiddenLines" JSONB NOT NULL DEFAULT '[]',
    "volumeSplitLogic" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterOutline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MasterOutline_novelId_key" ON "MasterOutline"("novelId");

-- CreateIndex
CREATE INDEX "MasterOutline_novelId_idx" ON "MasterOutline"("novelId");

-- AddForeignKey
ALTER TABLE "MasterOutline" ADD CONSTRAINT "MasterOutline_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterOutline" ADD CONSTRAINT "MasterOutline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
