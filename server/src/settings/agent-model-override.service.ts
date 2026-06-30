import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ModelConfigRecord } from '../agentos/model-factory';

/** agentKey → 完整 ModelConfig(含 apiKey,喂 buildChatModel)。 */
export type OverrideMap = Map<string, ModelConfigRecord>;

@Injectable()
export class AgentModelOverrideService {
  constructor(private readonly prisma: PrismaService) {}

  /** runTurn 开头一次读全量 override(含 apiKey),buildNode 据此 override 优先。 */
  async listMap(userId: string): Promise<OverrideMap> {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      include: { modelConfig: true },
    });
    const map: OverrideMap = new Map();
    for (const r of rows) {
      const c = r.modelConfig;
      map.set(r.agentKey, {
        id: c.id,
        provider: c.provider,
        model: c.model,
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        temperature: c.temperature,
        updatedAt: c.updatedAt,
      });
    }
    return map;
  }

  /** 设置页用:agentKey → modelConfigId(脱敏,不含 key)。 */
  async listForApi(userId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      select: { agentKey: true, modelConfigId: true },
    });
    const out: Record<string, string> = {};
    for (const r of rows) out[r.agentKey] = r.modelConfigId;
    return out;
  }

  async upsert(
    userId: string,
    agentKey: string,
    modelConfigId: string,
  ): Promise<void> {
    const owned = await this.prisma.modelConfig.findFirst({
      where: { id: modelConfigId, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Model config not found');
    await this.prisma.agentModelOverride.upsert({
      where: { userId_agentKey: { userId, agentKey } },
      create: { userId, agentKey, modelConfigId },
      update: { modelConfigId },
    });
  }

  async remove(userId: string, agentKey: string): Promise<void> {
    await this.prisma.agentModelOverride.delete({
      where: { userId_agentKey: { userId, agentKey } },
    });
  }
}
