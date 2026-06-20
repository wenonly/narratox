-- CreateEnum
CREATE TYPE "ChapterOutlineStatus" AS ENUM ('DRAFT', 'APPROVED', 'WRITTEN');

-- CreateTable
CREATE TABLE "Volume" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "synopsis" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Volume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterOutline" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "volumeId" TEXT,
    "chapterOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "cbn" JSONB NOT NULL,
    "cpns" JSONB NOT NULL,
    "cen" JSONB NOT NULL,
    "mustCover" JSONB NOT NULL,
    "forbidden" JSONB NOT NULL,
    "status" "ChapterOutlineStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterOutline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Volume_novelId_idx" ON "Volume"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "Volume_novelId_order_key" ON "Volume"("novelId", "order");

-- CreateIndex
CREATE INDEX "ChapterOutline_novelId_idx" ON "ChapterOutline"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterOutline_novelId_chapterOrder_key" ON "ChapterOutline"("novelId", "chapterOrder");

-- AddForeignKey
ALTER TABLE "Volume" ADD CONSTRAINT "Volume_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterOutline" ADD CONSTRAINT "ChapterOutline_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterOutline" ADD CONSTRAINT "ChapterOutline_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
