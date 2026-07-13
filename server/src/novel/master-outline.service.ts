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
 * main 经 set_master_outline 工具 upsert;ContextAssembler/runTurn get 注入。
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

  /**
   * 删总纲整行(1:1 Novel)。ACTIVE 阶段返 warning(总纲是北极星),但不拦。
   * 重建走 upsert。
   */
  async clear(
    userId: string,
    novelId: string,
  ): Promise<
    | { ok: true; warned: boolean; reason?: string }
    | { ok: false; reason: 'not_found' }
  > {
    const n = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true, status: true },
    });
    if (!n) throw new NotFoundException('Novel not found');
    const existing = await this.prisma.masterOutline.findFirst({
      where: { novelId, novel: { userId } },
      select: { id: true },
    });
    if (!existing) return { ok: false, reason: 'not_found' };
    await this.prisma.masterOutline.delete({ where: { id: existing.id } });
    if (n.status === 'ACTIVE') {
      return {
        ok: true,
        warned: true,
        reason: '总纲是北极星,删除后 writer 将失去战力/主线/三幕锚点',
      };
    }
    return { ok: true, warned: false };
  }
}
