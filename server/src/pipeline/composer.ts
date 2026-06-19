import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { NovelService } from '../novel/novel.service';
import { ChapterService } from '../novel/chapter.service';
import { WRITER_AGENT_PROMPT } from '../agentos/agent-prompts';

/**
 * 上下文策展 = 记忆注入(确定性、不调 LLM、只读 DB)。
 *
 * 每个无状态专家配一个 buildContext:从 DB 现读现拼小说状态(设定/正文/摘要/伏笔),
 * 产出 { system, user } 供专家 agent 单次有界工具循环使用。专家 agent 不拖跨轮的
 * 原始聊天线程 —— DB 就是它们的记忆(见 spec §2 两层记忆)。
 *
 * 文案复用:writer 沿用 WRITER_AGENT_PROMPT + 【设定】/【前情】/【未回收伏笔】标签
 * (与 ContextAssembler 一致);settler 复刻 AnalystService 的结算 prompt(本章正文+
 * 设定+OPEN 伏笔),不重写。
 */
export interface ComposedPrompt {
  system: string;
  user: string;
}

interface NovelSettingsLite {
  style?: string;
  worldviewText?: string;
  language?: string;
}

@Injectable()
export class Composer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
  ) {}

  /**
   * writer 的上下文:写作指令 + 设定 + 前情(近5章摘要)+ 未回收伏笔 + 本章目标。
   * 从 DB 现读现拼(专家记忆 = DB)。
   */
  async buildWriterContext(deps: {
    userId: string;
    novelId: string;
    chapterOrder: number;
    userMessage: string;
  }): Promise<ComposedPrompt> {
    const { userId, novelId, chapterOrder, userMessage } = deps;
    const novel = await this.novels.get(userId, novelId);
    const settings = (novel.settings ?? {}) as NovelSettingsLite;
    const recent = await this.summaries.listRecent(userId, novelId, 5);
    const openHooks = await this.events.listOpen(userId, novelId);

    const blocks: string[] = [WRITER_AGENT_PROMPT, '', '【设定】'];
    blocks.push(`书名:${novel.title}`);
    if (novel.genre) blocks.push(`类型:${novel.genre}`);
    if (novel.synopsis) blocks.push(`简介:${novel.synopsis}`);
    if (settings.worldviewText)
      blocks.push(`世界观/设定:${settings.worldviewText}`);
    if (settings.style) blocks.push(`文风:${settings.style}`);
    if (settings.language) blocks.push(`语言:${settings.language}`);

    if (recent.length) {
      // listRecent 返回序号倒序(最新在前);前情用早→晚,故 reverse()。
      const recap = recent
        .slice()
        .reverse()
        .map((r) => `第${r.chapterOrder}章:${r.summary}`)
        .join(' / ');
      blocks.push('', `【前情】${recap}`);
    }
    if (openHooks.length) {
      blocks.push(
        '',
        `【未回收伏笔】${openHooks.map((h) => h.description).join(' · ')}`,
      );
    }

    const system = blocks.join('\n');
    const user = `请写第 ${chapterOrder} 章。作者本轮指示:${
      userMessage || '(无特别指示,按设定与前情推进)'
    }`;
    return { system, user };
  }

  /**
   * settler 的上下文:本章正文 + 设定 + OPEN 伏笔。复刻 AnalystService 的结算 prompt
   * (文案逐字一致),由 settler agent 用 withStructuredOutput 提取 4 类事实。
   */
  async buildSettlerContext(deps: {
    userId: string;
    novelId: string;
    chapterOrder: number;
  }): Promise<ComposedPrompt> {
    const { userId, novelId, chapterOrder } = deps;
    const chapter = await this.chapters.findByOrder(
      userId,
      novelId,
      chapterOrder,
    );
    const content = chapter?.content ?? '';

    const novel = await this.novels.get(userId, novelId);
    const settings = (novel.settings ?? {}) as NovelSettingsLite;
    const openHooks = await this.events.listOpen(userId, novelId);

    const system =
      '你是小说一致性记账员。阅读本章正文,严谨提取事实(客观、不编造)。' +
      'resolvedHookIds 只能从下面给出的 OPEN 伏笔 id 里挑本章确实回收了的;没回收就返回空数组。';
    const user =
      `【书名】${novel.title}\n【类型】${novel.genre ?? '未指定'}\n` +
      `【简介】${novel.synopsis ?? '未指定'}\n【世界观】${settings.worldviewText ?? '未指定'}\n` +
      `【文风】${settings.style ?? '未指定'}\n\n【本章序号】第${chapterOrder}章\n` +
      `【OPEN 伏笔(仅可从中挑选回收)】\n` +
      (openHooks.length
        ? openHooks.map((h) => `- id=${h.id}: ${h.description}`).join('\n')
        : '(无)') +
      `\n\n【本章正文】\n${content}`;

    return { system, user };
  }
}
