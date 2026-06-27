import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModelConfigService } from './model-config.service';
import {
  buildChatModel,
  type ModelConfigRecord,
} from '../agentos/model-factory';
import { MAX_TOKENS_BY_TIER } from '../agentos/agent-tree.config';
import { PROFILE_BUILDER_PROMPT } from './profile-builder.prompt';

/**
 * 把作者粘贴的样本拼成喂给画像 agent 的 user 消息(纯函数,好单测)。
 */
export function buildProfilePrompt(samples: string[]): string {
  const body = samples
    .map((s, i) => `【样本 ${i + 1}】\n${s}`)
    .join('\n\n---\n\n');
  return `下面是这位作者的若干段代表性文字。请据此归纳出一份「作者画像」Markdown。\n\n${body}`;
}

@Injectable()
export class VoiceProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelConfigs: ModelConfigService,
  ) {}

  list(userId: string) {
    return this.prisma.voiceProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, data: { name: string; profile: string }) {
    return this.prisma.voiceProfile.create({ data: { ...data, userId } });
  }

  async update(
    userId: string,
    id: string,
    data: { name?: string; profile?: string },
  ) {
    await this.assertOwned(userId, id);
    return this.prisma.voiceProfile.update({ where: { id }, data });
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    await this.assertOwned(userId, id);
    await this.prisma.voiceProfile.delete({ where: { id } });
    return { ok: true };
  }

  /** 注入用:取小说选中的画像 Markdown(无则 null)。 */
  async getForNovel(userId: string, novelId: string): Promise<string | null> {
    const novel = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { voiceProfile: { select: { profile: true } } },
    });
    return novel?.voiceProfile?.profile ?? null;
  }

  /**
   * 跑画像 agent:从作者样本归纳 Markdown 画像。不落库(回前端供审,保存走 create/update)。
   * 复用用户活动模型配置;无配置时与 runTurn 一致抛错。
   */
  async generate(
    userId: string,
    samples: string[],
  ): Promise<{ profile: string }> {
    const active = await this.modelConfigs.getActive(userId);
    if (!active) {
      throw new Error('尚未配置模型,请在设置页「设置」中添加并激活一个模型');
    }
    const config: ModelConfigRecord = {
      id: active.id,
      provider: active.provider,
      model: active.model,
      baseUrl: active.baseUrl,
      apiKey: active.apiKey,
      temperature: active.temperature,
      updatedAt: active.updatedAt,
    };
    const model = await buildChatModel(config, MAX_TOKENS_BY_TIER.long);
    // 动态 import(保持 Jest collection 干净):底层 createAgent。与 deep-agent.service 同源摩擦,as never。
    const { createAgent } = await import('langchain');
    const agent = createAgent({
      model: model as never,
      systemPrompt: PROFILE_BUILDER_PROMPT,
    } as never);
    const result = (await agent.invoke({
      messages: [{ role: 'user', content: buildProfilePrompt(samples) }],
    } as never)) as { messages: Array<{ content?: unknown }> };
    return { profile: extractLastText(result.messages) };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.voiceProfile.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Voice profile not found');
  }
}

/** 取 langgraph 结果最后一条消息的文本内容。 */
function extractLastText(messages: Array<{ content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i]?.content;
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}
