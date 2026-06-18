import { Injectable } from '@nestjs/common';
import { SYSTEM_PROMPT } from './agentos.constants';
// Value import (NOT `import type`) so Nest DI can resolve PrismaService when
// AgentosController injects this service (Task 10). A type-only import compiles
// away and leaves the constructor parameter unannotated at runtime → DI failure.
import { PrismaService } from '../prisma/prisma.service';

interface NovelPromptInput {
  title: string;
  genre: string | null;
  synopsis: string | null;
  // Prisma's `settings` is JsonValue (could be null/array/scalar/...). We
  // narrow defensively inside buildSystemPrompt, so accept `unknown` here —
  // a narrow structural type would reject Prisma's JsonValue at the call site.
  settings?: unknown;
}

interface NovelSettings {
  style?: string;
  language?: string;
  worldviewText?: string;
}

/**
 * 把小说设定组装成写作 Agent 的 system prompt（作者视角的自然语言，非 JSON）。
 * Phase 1 lite：只拼 title/genre/synopsis/settings；Phase 2 再加大纲 slice/角色段。
 */
@Injectable()
export class ContextAssembler {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 组装 system prompt。status 是独立参数(NovelPromptInput 不含它)——
   * 立项中(CONCEPT)与写作中(ACTIVE)给出不同的状态指令。
   */
  buildSystemPrompt(novel: NovelPromptInput, status?: string): string {
    const raw = novel.settings;
    const s: NovelSettings =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const lines = [
      '你是一位资深小说写作助手，与作者协作创作一部小说。遵循作者的意图，用自然、连贯的中文正文回复；正文只输出小说内容本身，不要加解说或meta说明。',
      '',
      `【书名】${novel.title}`,
    ];
    if (novel.genre) lines.push(`【类型】${novel.genre}`);
    if (novel.synopsis) lines.push(`【简介】${novel.synopsis}`);
    if (s.worldviewText) lines.push(`【世界观/设定】${s.worldviewText}`);
    if (s.style) lines.push(`【文风】${s.style}`);
    if (s.language) lines.push(`【语言】${s.language}`);
    lines.push('');
    lines.push('规则:不要编造与设定冲突的情节;保持人物与已有内容一致。');
    if (status === 'CONCEPT') {
      lines.push('');
      lines.push(
        '【状态】立项中——基础信息不全。开场白已在聊天中;用户回复后直接根据内容继续收集信息(书名/类型/世界观/文风),每轮调 update_novel 工具更新。调用 update_novel 时,把你目前已知的所有信息字段都填进去(不只填新改的字段),并检查哪些信息还缺失 → 继续追问补充。不要重新打招呼。信息齐前不要转交写作。',
      );
    } else {
      lines.push('');
      lines.push(
        '【状态】写作中——信息已齐。作者要写正文时,用 transfer_to_writer 转交写作 Agent。',
      );
    }
    return lines.join('\n');
  }

  /**
   * 由聊天 session（=novel.sessionId）反查小说并组装 prompt；查不到回落通用 prompt。
   * 同时返回 novelId —— 工作台 swarm 需要它来按章节序号定位章节(write_chapter 工具
   * 用 order,而非 cuid)。select 收紧成 prompt 构造所需 + id 字段。
   */
  async forSession(
    userId: string,
    sessionId: string,
  ): Promise<{ prompt: string; novelId: string | null }> {
    const novel = await this.prisma.novel.findFirst({
      where: { sessionId, userId },
      select: {
        title: true,
        genre: true,
        synopsis: true,
        settings: true,
        id: true,
        status: true,
      },
    });
    if (!novel) return { prompt: SYSTEM_PROMPT, novelId: null };
    return {
      prompt: this.buildSystemPrompt(novel, novel.status),
      novelId: novel.id,
    };
  }
}
