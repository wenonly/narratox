import { ContextAssembler } from './context-assembler.service';
import { SYSTEM_PROMPT } from './agentos.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';
import type { WorldEntryService } from '../novel/world-entry.service';
import type { NovelReferenceService } from '../novel/novel-reference.service';
import type { CharacterService } from '../novel/character.service';

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
// 默认空卡司 → 不注入角色 slice(保留旧测试行为)。
const stubCharacters = {
  listForContext: jest.fn().mockResolvedValue({ active: [], dormant: [] }),
} as unknown as CharacterService;

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
      // A1:立项清单含 7 项(新增 核心冲突 + 每章字数目标)。
      expect(prompt).toContain('核心冲突');
      expect(prompt).toContain('每章字数目标');
    });

    it('adds the ACTIVE routing directive when status is ACTIVE', () => {
      const svc = new ContextAssembler(
        {} as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
        stubReferences,
        stubCharacters,
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
      );
      const { prompt } = await svc.forSession('u1', 's3');
      expect(prompt).not.toContain('【写作参考】');
    });

    it('injects 【角色档案 · 活跃】+【角色名册 · 沉默】 slices when characters exist', async () => {
      const characters = {
        listForContext: jest.fn().mockResolvedValue({
          active: [
            {
              name: '沈砚',
              role: 'PROTAGONIST',
              aliases: ['沈少'],
              faction: '棺材铺',
              background: '',
              appearance: '青衫',
              personality: '外冷内热',
              motivation: '复仇',
              arcGoal: '放下',
              voice: '寡言',
              currentState: {
                status: { value: '被通缉', chapterOrder: 5, reason: '' },
              },
            },
          ],
          dormant: [
            {
              name: '老陈',
              role: 'SUPPORTING',
              aliases: [],
              personality: '隐忍',
              motivation: '护主',
            },
          ],
        }),
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
      );
      const { prompt } = await svc.forSession('u1', 's-c');
      expect(prompt).toContain('【角色档案 · 活跃】');
      expect(prompt).toContain('沈砚(主角)');
      expect(prompt).toContain('动机:复仇');
      expect(prompt).toContain('当前态:状态=被通缉');
      expect(prompt).toContain('【角色名册 · 沉默】');
      expect(prompt).toContain('老陈(配角)');
    });

    it('does not inject character slice when there are no characters', async () => {
      // 默认 stubCharacters 返回 {active:[],dormant:[]}
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
      );
      const { prompt } = await svc.forSession('u1', 's-e');
      expect(prompt).not.toContain('【角色档案 · 活跃】');
      expect(prompt).not.toContain('【角色名册 · 沉默】');
    });
  });
});
