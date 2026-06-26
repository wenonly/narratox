import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModelConfigService } from './model-config.service';

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

  // generate() 在 Task 4 实现。
}
