-- CreateEnum
CREATE TYPE "HookPayoffTiming" AS ENUM ('IMMEDIATE', 'NEAR_TERM', 'MID_ARC', 'SLOW_BURN', 'ENDGAME');

-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'PROGRESSING';

-- AlterTable
ALTER TABLE "StoryEvent" ADD COLUMN     "advancedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "coreHook" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastAdvancedAtChapter" INTEGER,
ADD COLUMN     "payoffTiming" "HookPayoffTiming" NOT NULL DEFAULT 'MID_ARC';
