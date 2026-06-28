import { ContextAssembler } from './context-assembler.service';
import { SYSTEM_PROMPT } from './agentos.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';
import type { WorldEntryService } from '../novel/world-entry.service';
import type { NovelReferenceService } from '../novel/novel-reference.service';
import type { CharacterService } from '../novel/character.service';
import type { EventService } from '../memory/event.service';
import type { ArcService } from '../novel/arc.service';
import type { StatusService } from '../novel/status.service';

// buildSystemPrompt 路径不触达 memory 服务,但构造器签名要求依赖。
// 用空数组 stub,确保即使被调用也不会注入 memory slice(保留旧行为)。
const stubSummaries = {
  listRecent: jest.fn().mockResolvedValue([]),
} as unknown as SummaryService;
const stubEvents = {
  listOpen: jest.fn().mockResolvedValue([]),
} as unknown as StoryEventService;
const stubWorld = {
  listCore: jest.fn().mockResolvedValue([]),
} as unknown as WorldEntryService;
const stubReferences = {
  listAll: jest.fn().mockResolvedValue([]),
} as unknown as NovelReferenceService;
// 默认空角色索引 → 不注入角色 slice(保留旧测试行为)。
const stubCharacters = {
  listIndex: jest.fn().mockResolvedValue([]),
} as unknown as CharacterService;
// Phase 11:默认空事件 → 不注入【近期关键事件】slice(保留旧测试行为)。
const stubEventService = {
  listRecentMajor: jest.fn().mockResolvedValue([]),
} as unknown as EventService;
// Phase 12:默认无弧 → 不注入【当前弧线】slice(保留旧测试行为)。
const stubArcService = {
  findArcByChapter: jest.fn().mockResolvedValue(null),
} as unknown as ArcService;
// Phase 13:默认无态势 → 不注入【小说态势】slice(保留旧测试行为)。
const stubStatusService = {
  getOverview: jest.fn().mockResolvedValue(null),
} as unknown as StatusService;

describe('ContextAssembler', () => {
  describe('buildSystemPrompt', () => {
    it('weaves title/genre/synopsis/settings into an author-facing prompt', () => {
      const svc = new ContextAssembler(
        {} as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const prompt = svc.buildSystemPrompt(
        {
          title: '剑来',
          genre: '仙侠',
          synopsis: '一个少年的修行路',
          settings: {
            style: '冷峻',
            language: 'zh',
            worldviewText: '九州',
            coreConflict: '少年寻剑vs天命',
            chapterWordTarget: 3000,
          },
        },
        'ACTIVE',
      );
      expect(prompt).toContain('剑来');
      expect(prompt).toContain('仙侠');
      expect(prompt).toContain('一个少年的修行路');
      expect(prompt).toContain('冷峻');
      expect(prompt).toContain('九州');
      // A1:核心冲突 + 每章字数目标 注入(writer 始终看到长度预算与冲突锚点)。
      expect(prompt).toContain('【核心冲突】');
      expect(prompt).toContain('少年寻剑vs天命');
      expect(prompt).toContain('【每章字数目标】');
      expect(prompt).toContain('3000');
    });

    it('works without optional fields', () => {
      const svc = new ContextAssembler(
        {} as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const prompt = svc.buildSystemPrompt(
        {
          title: '无题',
          genre: null,
          synopsis: null,
          settings: {},
        },
        'ACTIVE',
      );
      expect(prompt).toContain('无题');
    });

    it('adds the CONCEPT onboarding directive when status is CONCEPT', () => {
      const svc = new ContextAssembler(
        {} as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const prompt = svc.buildSystemPrompt(
        { title: '草稿', genre: null, synopsis: null, settings: {} },
        'CONCEPT',
      );
      expect(prompt).toContain('立项中');
      expect(prompt).toContain('update_novel');
      // check-then-ask 引导:先查信息再问;信息齐全后转交写作。
      expect(prompt).toContain('get_novel_info');
      expect(prompt).toContain('missing');
      // A2:不再引用幻影 run_pipeline;改为真实流程(writer→settler→validator)。
      expect(prompt).not.toContain('run_pipeline');
      expect(prompt).toContain('settler');
      // 编排骨架 = MAIN_AGENT_PROMPT(立项段含 核心冲突/字数目标)。
      expect(prompt).toContain('核心冲突');
      expect(prompt).toContain('字数目标');
      expect(prompt).toContain('交互式编排者');
    });

    it('adds the ACTIVE routing directive when status is ACTIVE', () => {
      const svc = new ContextAssembler(
        {} as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const prompt = svc.buildSystemPrompt(
        { title: '成书', genre: null, synopsis: null, settings: {} },
        'ACTIVE',
      );
      expect(prompt).toContain('写作中');
      // A2:不再引用幻影 run_pipeline;改为真实流程。
      expect(prompt).not.toContain('run_pipeline');
      expect(prompt).toContain('settler');
    });
  });

  describe('forSession', () => {
    it('returns the novel prompt + novelId when the session belongs to the user', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'nid-1',
        title: 'T',
        genre: 'g',
        synopsis: 's',
        settings: {},
        status: 'ACTIVE',
      });
      const svc = new ContextAssembler(
        {
          novel: { findFirst },
          chapter: {
            aggregate: jest.fn().mockResolvedValue({ _max: { order: null } }),
          },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const { prompt, novelId } = await svc.forSession('u1', 's1');
      // select now includes id + status (status threads to buildSystemPrompt).
      expect(findFirst).toHaveBeenCalledWith({
        where: { sessionId: 's1', userId: 'u1' },
        select: {
          title: true,
          genre: true,
          synopsis: true,
          settings: true,
          id: true,
          status: true,
        },
      });
      expect(prompt).toContain('T');
      expect(prompt).toContain('写作中');
      expect(novelId).toBe('nid-1');
    });

    it('falls back to the generic prompt and null novelId when no novel is found', async () => {
      const svc = new ContextAssembler(
        {
          novel: { findFirst: jest.fn().mockResolvedValue(null) },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const { prompt, novelId } = await svc.forSession('u1', 'orphan');
      expect(prompt).toBe(SYSTEM_PROMPT);
      expect(novelId).toBeNull();
    });

    it('injects 【写作参考】 slice (index + main/both 精要) when references exist', async () => {
      const listAll = jest.fn().mockResolvedValue([
        {
          id: 'r1',
          title: '悬疑钩子写法',
          category: '方法论',
          injectTo: 'main',
          content: '开篇抛悬念，让读者带着疑问往下读。',
        },
        {
          id: 'r2',
          title: '情绪动作词库',
          category: '词汇',
          injectTo: 'writer',
          content: '哭/怒/惊的动词与神态',
        },
        {
          id: 'r3',
          title: '女频审核红线',
          category: '须知',
          injectTo: 'both',
          content: '规避点清单',
        },
      ]);
      const references = { listAll } as unknown as NovelReferenceService;
      const svc = new ContextAssembler(
        {
          novel: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'nid-2',
              title: 'T',
              genre: null,
              synopsis: null,
              settings: {},
              status: 'ACTIVE',
            }),
          },
          chapter: {
            aggregate: jest.fn().mockResolvedValue({ _max: { order: null } }),
          },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        references,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const { prompt } = await svc.forSession('u1', 's2');
      // 索引含全部条目(writer 条目也在索引里,标 [writer])。
      expect(prompt).toContain('【写作参考】');
      expect(prompt).toContain('悬疑钩子写法');
      expect(prompt).toContain('情绪动作词库');
      // 精要只含 main + both 条目内容。
      expect(prompt).toContain('开篇抛悬念');
      expect(prompt).toContain('规避点清单');
      // writer-only 条目正文不进 main 精要。
      expect(prompt).not.toContain('哭/怒/惊的动词与神态');
    });

    it('does not inject 【写作参考】 when there are no references', async () => {
      const svc = new ContextAssembler(
        {
          novel: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'nid-3',
              title: 'T',
              genre: null,
              synopsis: null,
              settings: {},
              status: 'ACTIVE',
            }),
          },
          chapter: {
            aggregate: jest.fn().mockResolvedValue({ _max: { order: null } }),
          },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences, // listAll → []
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const { prompt } = await svc.forSession('u1', 's3');
      expect(prompt).not.toContain('【写作参考】');
    });

    it('injects 【角色】 name+role 索引 when characters exist', async () => {
      const characters = {
        listIndex: jest
          .fn()
          .mockResolvedValue([
            { name: '沈砚', role: 'PROTAGONIST' },
            { name: '老陈', role: 'SUPPORTING' },
          ]),
      } as unknown as CharacterService;
      const svc = new ContextAssembler(
        {
          novel: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'nid-c',
              title: 'T',
              genre: null,
              synopsis: null,
              settings: {},
              status: 'ACTIVE',
            }),
          },
          chapter: {
            aggregate: jest.fn().mockResolvedValue({ _max: { order: 5 } }),
          },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        characters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const { prompt } = await svc.forSession('u1', 's-c');
      expect(prompt).toContain('【角色】');
      expect(prompt).toContain('沈砚(主角)');
      expect(prompt).toContain('老陈(配角)');
      expect(prompt).toContain('get_character(name)');
      // 不再注入全档案
      expect(prompt).not.toContain('【角色档案 · 活跃】');
      expect(prompt).not.toContain('动机:复仇');
    });

    it('does not inject character slice when there are no characters', async () => {
      // 默认 stubCharacters.listIndex → []
      const svc = new ContextAssembler(
        {
          novel: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'nid-e',
              title: 'T',
              genre: null,
              synopsis: null,
              settings: {},
              status: 'ACTIVE',
            }),
          },
          chapter: {
            aggregate: jest.fn().mockResolvedValue({ _max: { order: null } }),
          },
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
        stubEventService,
        stubArcService,
        stubStatusService,
        { get: jest.fn().mockResolvedValue(null) } as never,
      );
      const { prompt } = await svc.forSession('u1', 's-e');
      expect(prompt).not.toContain('【角色】');
    });
  });
});
