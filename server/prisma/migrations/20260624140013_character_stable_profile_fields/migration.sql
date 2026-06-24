-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "appearance" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "arcGoal" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "motivation" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "personality" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "voice" TEXT NOT NULL DEFAULT '';
