-- CreateEnum
CREATE TYPE "CharacterChangeSignificance" AS ENUM ('MAJOR', 'MINOR');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "flaw" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "growth" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CharacterChange" ADD COLUMN     "significance" "CharacterChangeSignificance" NOT NULL DEFAULT 'MINOR';
