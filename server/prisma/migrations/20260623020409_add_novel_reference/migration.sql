-- CreateTable
CREATE TABLE "NovelReference" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "injectTo" TEXT,
    "source" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovelReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NovelReference_novelId_idx" ON "NovelReference"("novelId");

-- AddForeignKey
ALTER TABLE "NovelReference" ADD CONSTRAINT "NovelReference_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelReference" ADD CONSTRAINT "NovelReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
