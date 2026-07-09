-- AlterEnum
ALTER TYPE "BenchmarkEntryType" ADD VALUE 'MATERIAL';

-- AlterTable
ALTER TABLE "BenchmarkEntry" ADD COLUMN     "kind" TEXT,
ADD COLUMN     "purposes" TEXT[] DEFAULT ARRAY[]::TEXT[];
