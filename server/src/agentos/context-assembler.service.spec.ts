import { ContextAssembler } from './context-assembler.service';
import { SYSTEM_PROMPT } from './agentos.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';
import type { WorldEntryService } from '../novel/world-entry.service';

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

describe('ContextAssembler', () => {
  describe('buildSystemPrompt', () => {
    it('weaves title/genre/synopsis/settings into an author-facing prompt', () => {
      const svc = new ContextAssembler(
        {} as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
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
        } as unknown as PrismaService,
        stubSummaries,
        stubEvents,
        stubWorld,
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
      );
      const { prompt, novelId } = await svc.forSession('u1', 'orphan');
      expect(prompt).toBe(SYSTEM_PROMPT);
      expect(novelId).toBeNull();
    });
  });
});
