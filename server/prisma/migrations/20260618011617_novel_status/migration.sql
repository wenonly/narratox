-- CreateEnum
CREATE TYPE "NovelStatus" AS ENUM ('CONCEPT', 'ACTIVE');

-- AlterTable
ALTER TABLE "Novel" ADD COLUMN     "status" "NovelStatus" NOT NULL DEFAULT 'ACTIVE';
