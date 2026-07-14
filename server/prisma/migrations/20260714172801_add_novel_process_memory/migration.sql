-- CreateTable
CREATE TABLE "NovelProcessMemory" (
    "novelId" TEXT NOT NULL,
    "rules" TEXT NOT NULL DEFAULT '',
    "lessons" TEXT NOT NULL DEFAULT '',
    "decisions" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovelProcessMemory_pkey" PRIMARY KEY ("novelId")
);

-- CreateIndex
CREATE INDEX "NovelProcessMemory_novelId_idx" ON "NovelProcessMemory"("novelId");

-- AddForeignKey
ALTER TABLE "NovelProcessMemory" ADD CONSTRAINT "NovelProcessMemory_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
