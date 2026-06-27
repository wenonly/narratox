-- CreateEnum
CREATE TYPE "EventSignificance" AS ENUM ('MAJOR', 'MINOR');

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "chapterOrder" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT,
    "significance" "EventSignificance" NOT NULL DEFAULT 'MINOR',
    "involvedCharacters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "location" TEXT,
    "causedById" TEXT,
    "relatedHookId" TEXT,
    "relatedHookAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_novelId_chapterOrder_idx" ON "Event"("novelId", "chapterOrder");

-- CreateIndex
CREATE INDEX "Event_novelId_significance_idx" ON "Event"("novelId", "significance");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_causedById_fkey" FOREIGN KEY ("causedById") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_relatedHookId_fkey" FOREIGN KEY ("relatedHookId") REFERENCES "StoryEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
