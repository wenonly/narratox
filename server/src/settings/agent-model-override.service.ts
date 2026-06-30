import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assembleModelConfig } from '../agentos/vendor-model-assembler';
import type { AgentOverrideEntry } from '../agentos/deep-agent.service';

/**
 * per-agent 模型 override:agentKey → Model(挂 Vendor)+ 可选 temperature。
 *  - listMap 喂 runTurn(拼 ModelConfigRecord 含 apiKey,buildNode override 优先)。
 *  - listForApi 喂设置页(脱敏:只返 { modelId, temperature })。
 *  - upsert 接收 { modelId?, temperature? };modelId 空 → remove。
 */
@Injectable()
export class AgentModelOverrideService {
  constructor(private readonly prisma: PrismaService) {}

  /** runTurn 开头一次读全量 override(含 apiKey,经 vendor 拼装),buildNode 据此 override 优先。 */
  async listMap(userId: string): Promise<Map<string, AgentOverrideEntry>> {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      include: { model: { include: { vendor: true } } },
    });
    const map = new Map<string, AgentOverrideEntry>();
    for (const r of rows) {
      map.set(r.agentKey, {
        config: assembleModelConfig(r.model, r.model.vendor),
        temperatureOverride: r.temperature,
      });
    }
    return map;
  }

  /** 设置页用:agentKey → { modelId, temperature }(脱敏,不含 apiKey)。 */
  async listForApi(
    userId: string,
  ): Promise<Record<string, { modelId: string; temperature: number | null }>> {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      select: { agentKey: true, modelId: true, temperature: true },
    });
    const out: Record<string, { modelId: string; temperature: number | null }> =
      {};
    for (const r of rows)
      out[r.agentKey] = { modelId: r.modelId, temperature: r.temperature };
    return out;
  }

  /**
   * 写一条 override。modelId 空(或不传)= 清除该 agentKey 的 override(remove)。
   * 否则校验 Model 归属当前用户(经 Vendor),再 upsert 并写 temperature(null 表示用模型自带)。
   */
  async upsert(
    userId: string,
    agentKey: string,
    dto: { modelId?: string; temperature?: number | null },
  ): Promise<void> {
    if (!dto.modelId) {
      await this.remove(userId, agentKey);
      return;
    }
    const owned = await this.prisma.vendor.findFirst({
      where: { models: { some: { id: dto.modelId } }, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Model not found');
    await this.prisma.agentModelOverride.upsert({
      where: { userId_agentKey: { userId, agentKey } },
      create: {
        userId,
        agentKey,
        modelId: dto.modelId,
        temperature: dto.temperature ?? null,
      },
      update: {
        modelId: dto.modelId,
        temperature: dto.temperature ?? null,
      },
    });
  }

  async remove(userId: string, agentKey: string): Promise<void> {
    // deleteMany 幂等:行不存在(如温度变化触发 remove)不抛 P2025,返 { count: 0 }。
    // 注意 deleteMany 的 where 不接受复合唯一键(userId_agentKey),用两个字段。
    await this.prisma.agentModelOverride.deleteMany({
      where: { userId, agentKey },
    });
  }
}
