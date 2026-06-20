-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeModelConfigId" TEXT;

-- CreateTable
CREATE TABLE "ModelConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKey" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelConfig_userId_idx" ON "ModelConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_activeModelConfigId_key" ON "User"("activeModelConfigId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeModelConfigId_fkey" FOREIGN KEY ("activeModelConfigId") REFERENCES "ModelConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelConfig" ADD CONSTRAINT "ModelConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

