-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isError" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "langGraphId" TEXT;
