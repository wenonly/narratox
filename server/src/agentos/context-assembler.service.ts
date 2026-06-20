import { Injectable } from '@nestjs/common';
import { SYSTEM_PROMPT } from './agentos.constants';
// Value import (NOT `import type`) so Nest DI can resolve PrismaService when
// AgentosController injects this service (Task 10). A type-only import compiles
// away and leaves the constructor parameter unannotated at runtime → DI failure.
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';

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
  coreConflict?: string;
  chapterWordTarget?: number;
}

/**
 * 把小说设定组装成写作 Agent 的 system prompt（作者视角的自然语言，非 JSON）。
 * Phase 1 lite：只拼 title/genre/synopsis/settings；Phase 2 再加大纲 slice/角色段。
 */
@Injectable()
export class ContextAssembler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}

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
    // A1:核心冲突 + 每章字数目标紧跟简介——让 writer 始终看到全书张力与长度预算。
    if (s.coreConflict) lines.push(`【核心冲突】${s.coreConflict}`);
    if (s.chapterWordTarget)
      lines.push(`【每章字数目标】${s.chapterWordTarget} 字`);
    if (s.worldviewText) lines.push(`【世界观/设定】${s.worldviewText}`);
    if (s.style) lines.push(`【文风】${s.style}`);
    if (s.language) lines.push(`【语言】${s.language}`);
    lines.push('');
    lines.push('规则:不要编造与设定冲突的情节;保持人物与已有内容一致。');
    if (status === 'CONCEPT') {
      lines.push('');
      lines.push(
        '【状态】立项中——基础信息不全。需要收集以下 7 项基础信息(对应 update_novel 参数):\n1. 书名(title)\n2. 类型/题材(genre)\n3. 简介/故事核心(synopsis)——一两句话概括这本小说讲什么\n4. 核心冲突(coreConflict)——主角欲望 vs 障碍,全书张力所在\n5. 每章字数目标(chapterWordTarget)——单章字数预算,如 3000\n6. 世界观/设定(worldviewText)\n7. 文风(style)\n\n工作方式:\n- 开场白已在聊天中;用户回复后先调 get_novel_info 查看已收集的信息和缺失字段(missing 列表)。\n- 根据 missing 列表追问缺失项;每轮调 update_novel 更新(把你目前已知的所有字段都填进去)。\n- 7 项都收集齐(missing 为空)后,作者要写正文时调用 run_pipeline 写章。\n- 不要重新打招呼。',
      );
    } else {
      lines.push('');
      lines.push(
        '【状态】写作中——信息已齐。作者要写/续写正文时,调用 run_pipeline 写章(写章流水线:它会一节节写完整章并自动结算摘要/伏笔)。',
      );
    }
    return lines.join('\n');
  }

  /**
   * 由聊天 session（=novel.sessionId）反查小说并组装 prompt；查不到回落通用 prompt。
   * 同时返回 novelId —— 工作台 swarm 需要它来按章节序号定位章节(write_chapter 工具
   * 用 order,而非 cuid)。select 收紧成 prompt 构造所需 + id 字段。
   *
   * 被动记忆注入(Task 8):在状态指令之前插入【前情】(最近 5 章摘要,早→晚)
   * 与【未回收伏笔】(开放 StoryEvent)。两者皆空则不插入任何 slice,prompt 与
   * 旧版完全一致。memory 查询跳过 CONCEPT 回落路径(no novel)。
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

    const base = this.buildSystemPrompt(novel, novel.status);
    const recent = await this.summaries.listRecent(userId, novel.id, 5);
    const openHooks = await this.events.listOpen(userId, novel.id);

    const slices: string[] = [];
    if (recent.length) {
      // listRecent 返回章节序号倒序(最新在前);recap 用早→晚,故 reverse()。
      const recap = recent
        .slice()
        .reverse()
        .map((r) => `第${r.chapterOrder}章:${r.summary}`)
        .join(' / ');
      slices.push(`【前情】${recap}`);
    }
    if (openHooks.length) {
      slices.push(
        `【未回收伏笔】${openHooks.map((h) => h.description).join(' · ')}`,
      );
    }
    if (!slices.length) return { prompt: base, novelId: novel.id };

    // 把 memory slices 插到「规则:...」之前(即紧贴设定之后、状态指令之前)。
    const marker = '规则:不要编造与设定冲突的情节';
    const idx = base.indexOf(marker);
    if (idx === -1) return { prompt: base, novelId: novel.id };
    return {
      prompt: base.slice(0, idx) + slices.join('\n') + '\n' + base.slice(idx),
      novelId: novel.id,
    };
  }
}
