-- CreateEnum
CREATE TYPE "BenchmarkStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "BenchmarkEntryType" AS ENUM ('CHAPTER', 'PLOT', 'RHYTHM', 'EMOTION', 'CHARACTER', 'STYLE');

-- CreateTable
CREATE TABLE "BenchmarkBook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "chapters" JSONB NOT NULL DEFAULT '[]',
    "status" "BenchmarkStatus" NOT NULL DEFAULT 'PENDING',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "review" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkBook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkEntry" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "type" "BenchmarkEntryType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "chapterNo" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenchmarkBook_userId_updatedAt_idx" ON "BenchmarkBook"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "BenchmarkEntry_bookId_type_idx" ON "BenchmarkEntry"("bookId", "type");

-- CreateIndex
CREATE INDEX "BenchmarkEntry_bookId_chapterNo_idx" ON "BenchmarkEntry"("bookId", "chapterNo");

-- AddForeignKey
ALTER TABLE "BenchmarkBook" ADD CONSTRAINT "BenchmarkBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkEntry" ADD CONSTRAINT "BenchmarkEntry_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "BenchmarkBook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
