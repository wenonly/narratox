/*
  Warnings:

  - You are about to drop the column `voiceProfile` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Novel" ADD COLUMN     "voiceProfileId" TEXT;

-- CreateTable (先建 VoiceProfile,数据搬迁依赖此表存在)
CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceProfile_userId_idx" ON "VoiceProfile"("userId");

-- AddForeignKey
ALTER TABLE "VoiceProfile" ADD CONSTRAINT "VoiceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 数据搬迁:每用户非空 voiceProfile → VoiceProfile 表(gen_random_uuid() PG13+ 内置,已 db execute 验证可用)
INSERT INTO "VoiceProfile" ("id", "userId", "name", "profile", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", '默认画像', "voiceProfile", NOW(), NOW()
FROM "User"
WHERE "voiceProfile" IS NOT NULL AND "voiceProfile" <> '';

-- AlterTable (搬迁完成后才删旧列)
ALTER TABLE "User" DROP COLUMN "voiceProfile";

-- AddForeignKey (Novel.voiceProfileId FK 必须在 VoiceProfile 表存在后建立)
ALTER TABLE "Novel" ADD CONSTRAINT "Novel_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "VoiceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
