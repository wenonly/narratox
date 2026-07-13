import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assembleModelConfig } from '../agentos/vendor-model-assembler';
import { AGENT_TREE, collectSpecs } from '../agentos/agent-tree.config';
import {
  DISSECT_TREE,
  collectDissectSpecs,
} from '../agentos/dissect-tree.config';
import type { AgentOverrideEntry } from '../agentos/deep-agent.service';

/**
 * 当前所有合法 agent key(写作树 + 拆解树扁平收集)。用于过滤 DB 里可能残留的
 * "幽灵" AgentModelOverride 记录——agent 在重构中被删后,DB 行不会自动清理,
 * 这里在 listMap/listForApi 出口处过滤掉,FE 与 runTurn 都看不到它们。
 * 不在 upsert 时强制校验 key(set_references 类工具也允许灵活 agent 名),
 * 也不主动 deleteMany(让数据可恢复;若用户重建同名 agent 仍能命中旧 override)。
 */
const VALID_AGENT_KEYS = new Set<string>([
  ...collectSpecs(AGENT_TREE).map((s) => s.name),
  ...collectDissectSpecs(DISSECT_TREE).map((s) => s.name),
]);

/**
 * per-agent 模型 override:agentKey → Model(挂 Vendor)+ 可选 temperature。
 *  - listMap 喂 runTurn(拼 ModelConfigRecord 含 apiKey,buildNode override 优先);modelId 空的行 config=null。
 *  - listForApi 喂设置页(脱敏:只返 { modelId, temperature }),modelId 可空。
 *  - upsert 接收 { modelId?, temperature? }:两者都空 → remove;否则 upsert(modelId 可空 = 只覆盖温度)。
 *  - listMap/listForApi 过滤掉 VALID_AGENT_KEYS 之外的幽灵记录(重构后残留)。
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
      if (!VALID_AGENT_KEYS.has(r.agentKey)) continue;
      map.set(r.agentKey, {
        config: r.model ? assembleModelConfig(r.model, r.model.vendor) : null,
        temperatureOverride: r.temperature,
      });
    }
    return map;
  }

  /** 设置页用:agentKey → { modelId, temperature }(脱敏,不含 apiKey)。modelId 可空。 */
  async listForApi(
    userId: string,
  ): Promise<
    Record<string, { modelId: string | null; temperature: number | null }>
  > {
    const rows = await this.prisma.agentModelOverride.findMany({
      where: { userId },
      select: { agentKey: true, modelId: true, temperature: true },
    });
    const out: Record<
      string,
      { modelId: string | null; temperature: number | null }
    > = {};
    for (const r of rows) {
      if (!VALID_AGENT_KEYS.has(r.agentKey)) continue;
      out[r.agentKey] = { modelId: r.modelId, temperature: r.temperature };
    }
    return out;
  }

  /**
   * 写一条 override。
   *  - modelId 空 + temperature 空 → remove(两者都空 = 无 override)。
   *  - 否则 upsert:modelId 可空(空 = 用 active model 只覆盖温度);仅 modelId 非空时校验 Model 归属。
   */
  async upsert(
    userId: string,
    agentKey: string,
    dto: { modelId?: string; temperature?: number | null },
  ): Promise<void> {
    const modelId = dto.modelId ?? null;
    const temperature = dto.temperature ?? null;
    if (!modelId && temperature == null) {
      await this.remove(userId, agentKey);
      return;
    }
    if (modelId) {
      const owned = await this.prisma.vendor.findFirst({
        where: { models: { some: { id: modelId } }, userId },
        select: { id: true },
      });
      if (!owned) throw new NotFoundException('Model not found');
    }
    await this.prisma.agentModelOverride.upsert({
      where: { userId_agentKey: { userId, agentKey } },
      create: { userId, agentKey, modelId, temperature },
      update: { modelId, temperature },
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
