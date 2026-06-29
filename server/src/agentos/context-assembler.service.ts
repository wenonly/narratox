import { Injectable } from '@nestjs/common';
import { SYSTEM_PROMPT } from './agentos.constants';
import { MAIN_AGENT_PROMPT } from './agent-prompts';
// Value import (NOT `import type`) so Nest DI can resolve PrismaService when
// AgentosController injects this service (Task 10). A type-only import compiles
// away and leaves the constructor parameter unannotated at runtime → DI failure.
import { PrismaService } from '../prisma/prisma.service';
import { StatusService } from '../novel/status.service';
import { MasterOutlineService } from '../novel/master-outline.service';
import { buildMasterOutlineSlice } from './master-slice';

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
  totalWordTarget?: number;
}

/**
 * 把小说设定组装成 main agent 的 system prompt(作者视角的自然语言,非 JSON)。
 *
 * 按角色注入(Phase 19+):main 是编排者(委派 + 决定下一步 + 跟作者对话),不写正文/设定
 * /大纲/角色。故 main 只被动注入 **态势**(下一步路由)+ **总纲**(北极星);其余(前情/事件
 * /伏笔/世界/角色/弧线/写作参考)由各专精 agent 自己 tool 拉,main 需要时也用读工具按需拉。
 * 前情/写作参考移到 writer augment(DeepAgentService)。
 */
@Injectable()
export class ContextAssembler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusService: StatusService,
    private readonly masterOutlines: MasterOutlineService,
  ) {}

  /**
   * 组装 system prompt 骨架。编排骨架 = MAIN_AGENT_PROMPT(交互式一步一停,Phase 16);
   * 本书字段 + 一行【当前阶段】作补充上下文。slices(总纲/态势)由 forSession 插在
   * 「规则:」marker 前。status 仅决定一行阶段(DB 真相);阶段流程引导靠 MAIN_AGENT_PROMPT
   * (立项/建置/写作各段)+ 【小说态势】nextStep。
   */
  buildSystemPrompt(novel: NovelPromptInput, status?: string): string {
    const raw = novel.settings;
    const s: NovelSettings =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const lines: string[] = [MAIN_AGENT_PROMPT, ''];
    lines.push(
      status === 'CONCEPT'
        ? '【当前阶段】立项中(CONCEPT)——基础信息未齐,先按立项流程分步收集(简介自生成,不问用户)。'
        : '【当前阶段】写作中(ACTIVE)——信息已齐,作者要写章时按写章流程委派 chapter。',
    );
    lines.push('');
    lines.push(`【书名】${novel.title}`);
    if (novel.genre) lines.push(`【类型】${novel.genre}`);
    if (novel.synopsis) lines.push(`【简介】${novel.synopsis}`);
    // 核心冲突 + 每章字数目标紧跟简介——编排委派要传的「题材+故事核」来自这里。
    if (s.coreConflict) lines.push(`【核心冲突】${s.coreConflict}`);
    if (s.chapterWordTarget)
      lines.push(`【每章字数目标】${s.chapterWordTarget} 字`);
    if (s.totalWordTarget)
      lines.push(`【全书字数目标】${s.totalWordTarget} 字`);
    if (s.worldviewText) lines.push(`【世界观/设定】${s.worldviewText}`);
    if (s.style) lines.push(`【文风】${s.style}`);
    if (s.language) lines.push(`【语言】${s.language}`);
    lines.push('');
    lines.push('规则:不要编造与设定冲突的情节;保持人物与已有内容一致。');
    return lines.join('\n');
  }

  /**
   * 由聊天 session(=novel.sessionId)反查小说并组装 main prompt;查不到回落通用 prompt。
   * main 只注入【总纲】+【小说态势】(按角色注入,Phase 19+);其余上下文由专精 agent
   * 或 main 自己用读工具按需拉。返回 novelId 供 buildAgentGraph 闭包注入工具。
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
    const overview = await this.statusService.getOverview(userId, novel.id);
    const master = await this.masterOutlines.get(userId, novel.id);
    const masterSlice = buildMasterOutlineSlice(master as never);

    const slices: string[] = [];
    if (masterSlice) slices.push(masterSlice);
    if (overview) {
      const ob = overview.onboarding;
      const basicsAll = Object.values(ob.basics).every(Boolean);
      const flags = `基础${basicsAll ? '✓' : '✗'}参考${ob.hasReferences ? '✓' : '✗'}世界${ob.hasWorld ? '✓' : '✗'}大纲${ob.hasOutline ? '✓' : '✗'}弧${ob.hasArcs ? '✓' : '✗'}角色${ob.hasCharacters ? '✓' : '✗'}`;
      slices.push(
        `【小说态势】${overview.totalWords}字${overview.targetTotalWords ? `(目标${Math.round((overview.totalWords / overview.targetTotalWords) * 100)}%)` : ''}·${overview.chapterCount}章·frontier第${overview.frontierChapter}章${overview.currentVolume ? `·${overview.currentVolume.title}` : ''}${overview.currentArc ? `·弧${overview.currentArc.order}「${overview.currentArc.title}」` : ''} | 立项:${flags} | 细纲剩${overview.coverage.plannedRemaining}章可写 | 开放伏笔${overview.health.openHooks}(⚠️${overview.health.staleHooks}) | 下一步:${overview.nextStep}`,
      );
    }
    if (!slices.length) return { prompt: base, novelId: novel.id };

    // 把 slices 插到「规则:...」之前(紧贴设定之后)。
    const marker = '规则:不要编造与设定冲突的情节';
    const idx = base.indexOf(marker);
    if (idx === -1) return { prompt: base, novelId: novel.id };
    return {
      prompt: base.slice(0, idx) + slices.join('\n') + '\n' + base.slice(idx),
      novelId: novel.id,
    };
  }
}
