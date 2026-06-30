import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface MasterOutlineInput {
  theme?: string;
  mainLine?: string;
  ending?: string;
  powerProgression?: unknown;
  hiddenLines?: unknown;
  volumeSplitLogic?: string;
  threeAct?: unknown; // { act1Turn?, act2Turn?, act3Turn? },各 { atVolume, beat };act2Turn=灵魂黑夜
}

/**
 * 总纲(全书级蓝图,1:1 Novel)服务。多租户隔离(novel 必须属于 userId)。
 * outline-writer 经 set_master_outline 工具 upsert;ContextAssembler/runTurn get 注入。
 */
@Injectable()
export class MasterOutlineService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwned(userId: string, novelId: string) {
    const n = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!n) throw new NotFoundException('Novel not found');
  }

  async upsert(userId: string, novelId: string, data: MasterOutlineInput) {
    await this.assertOwned(userId, novelId);
    const fields = {
      userId,
      theme: data.theme ?? '',
      mainLine: data.mainLine ?? '',
      ending: data.ending ?? '',
      powerProgression: (data.powerProgression ??
        []) as unknown as Prisma.InputJsonValue,
      hiddenLines: (data.hiddenLines ?? []) as unknown as Prisma.InputJsonValue,
      volumeSplitLogic: data.volumeSplitLogic ?? '',
      threeAct: (data.threeAct ?? {}) as unknown as Prisma.InputJsonValue,
    };
    return this.prisma.masterOutline.upsert({
      where: { novelId },
      create: { novelId, ...fields },
      update: fields,
    });
  }

  async get(userId: string, novelId: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.masterOutline.findUnique({
      where: { novelId, novel: { userId } },
    });
  }
}
