-- CreateTable
CREATE TABLE "AgentModelOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "modelConfigId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentModelOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentModelOverride_userId_idx" ON "AgentModelOverride"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentModelOverride_userId_agentKey_key" ON "AgentModelOverride"("userId", "agentKey");

-- AddForeignKey
ALTER TABLE "AgentModelOverride" ADD CONSTRAINT "AgentModelOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentModelOverride" ADD CONSTRAINT "AgentModelOverride_modelConfigId_fkey" FOREIGN KEY ("modelConfigId") REFERENCES "ModelConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
