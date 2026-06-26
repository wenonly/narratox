import { Injectable } from '@nestjs/common';
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
    // generate() 用;Task 4 接入。这里先占位注入(构造期不调用)。
    private readonly modelConfigs: ModelConfigService,
  ) {}

  /** 取当前用户的画像 Markdown;未设置返回 null。 */
  async get(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { voiceProfile: true },
    });
    return u?.voiceProfile ?? null;
  }

  /** 整体覆盖画像;空串视为清空(存 null)。 */
  async upsert(
    userId: string,
    profile: string,
  ): Promise<{ profile: string | null }> {
    const value = profile && profile.trim() ? profile : null;
    await this.prisma.user.update({
      where: { id: userId },
      data: { voiceProfile: value },
    });
    return { profile: value };
  }

  /**
   * 跑画像 agent:从作者样本归纳 Markdown 画像。不落库(回前端供审,保存走 upsert)。
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
    const profile = extractLastText(result.messages);
    return { profile };
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
