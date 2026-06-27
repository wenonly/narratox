-- AlterTable
ALTER TABLE "Volume" ADD COLUMN     "arcSummary" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Arc" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "volumeId" TEXT,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "fromChapter" INTEGER NOT NULL,
    "toChapter" INTEGER NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Arc_novelId_fromChapter_idx" ON "Arc"("novelId", "fromChapter");

-- CreateIndex
CREATE UNIQUE INDEX "Arc_novelId_order_key" ON "Arc"("novelId", "order");

-- AddForeignKey
ALTER TABLE "Arc" ADD CONSTRAINT "Arc_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arc" ADD CONSTRAINT "Arc_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
