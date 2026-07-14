import { ContextAssembler } from './context-assembler.service';
import { SYSTEM_PROMPT } from './agentos.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type { StatusService } from '../novel/status.service';
import type { ProcessMemoryService } from '../memory/process-memory.service';

// main 瘦身后 ContextAssembler 只依赖 statusService(态势)+ masterOutlines(总纲)
// + processMemory(本书过程记忆)。默认均返空 → 不注入 slice(保留 buildSystemPrompt 骨架)。
const stubStatusService = {
  getOverview: jest.fn().mockResolvedValue(null),
} as unknown as StatusService;
const stubMasterOutlines = {
  get: jest.fn().mockResolvedValue(null),
} as never;
const stubProcessMemory = {
  get: jest.fn().mockResolvedValue(null),
} as unknown as ProcessMemoryService;

const make = (
  prisma: unknown,
  processMemory: ProcessMemoryService = stubProcessMemory,
) =>
  new ContextAssembler(
    prisma as PrismaService,
    stubStatusService,
    stubMasterOutlines,
    processMemory,
  );

const novelRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'nid',
  title: 'T',
  genre: null,
  synopsis: null,
  settings: {},
  status: 'ACTIVE',
  ...over,
});

describe('ContextAssembler', () => {
  describe('buildSystemPrompt', () => {
    it('weaves title/genre/synopsis/settings into an author-facing prompt', () => {
      const prompt = make({}).buildSystemPrompt(
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
            totalWordTarget: 1000000,
          },
        },
        'ACTIVE',
      );
      expect(prompt).toContain('剑来');
      expect(prompt).toContain('仙侠');
      expect(prompt).toContain('一个少年的修行路');
      expect(prompt).toContain('冷峻');
      expect(prompt).toContain('九州');
      expect(prompt).toContain('【核心冲突】');
      expect(prompt).toContain('少年寻剑vs天命');
      expect(prompt).toContain('【每章字数目标】');
      expect(prompt).toContain('3000');
      expect(prompt).toContain('【全书字数目标】');
      expect(prompt).toContain('1000000');
    });

    it('works without optional fields', () => {
      const prompt = make({}).buildSystemPrompt(
        { title: '无题', genre: null, synopsis: null, settings: {} },
        'ACTIVE',
      );
      expect(prompt).toContain('无题');
    });

    it('adds the CONCEPT onboarding directive when status is CONCEPT', () => {
      const prompt = make({}).buildSystemPrompt(
        { title: '草稿', genre: null, synopsis: null, settings: {} },
        'CONCEPT',
      );
      expect(prompt).toContain('立项中');
      expect(prompt).toContain('update_novel');
      expect(prompt).toContain('get_novel_info');
      expect(prompt).toContain('missing');
      expect(prompt).not.toContain('run_pipeline');
      expect(prompt).toContain('settler');
      // 编排骨架 = MAIN_AGENT_PROMPT。
      expect(prompt).toContain('交互式编排者');
    });

    it('adds the ACTIVE routing directive when status is ACTIVE', () => {
      const prompt = make({}).buildSystemPrompt(
        { title: '成书', genre: null, synopsis: null, settings: {} },
        'ACTIVE',
      );
      expect(prompt).toContain('写作中');
      expect(prompt).not.toContain('run_pipeline');
      expect(prompt).toContain('settler');
    });
  });

  describe('forSession', () => {
    it('returns the novel prompt + novelId when the session belongs to the user', async () => {
      const findFirst = jest.fn().mockResolvedValue(novelRow({ id: 'nid-1' }));
      const svc = make({ novel: { findFirst } });
      const { prompt, novelId } = await svc.forSession('u1', 's1');
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
      const svc = make({
        novel: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const { prompt, novelId } = await svc.forSession('u1', 'orphan');
      expect(prompt).toBe(SYSTEM_PROMPT);
      expect(novelId).toBeNull();
    });

    it('main 只注入【总纲】+【小说态势】,不注入 writer 导向的动态 slice', async () => {
      // main 瘦身(Phase 19+):前情/事件/伏笔/世界/角色/弧线/写作参考全由各 agent 按需拉。
      const statusService = {
        getOverview: jest.fn().mockResolvedValue({
          totalWords: 1000,
          chapterCount: 2,
          frontierChapter: 2,
          currentVolume: { order: 1, title: '初入江湖' },
          currentArc: { order: 1, title: '拜师', fromChapter: 1, toChapter: 5 },
          onboarding: {
            basics: {
              title: true,
              genre: true,
              synopsis: true,
              coreConflict: true,
              chapterWordTarget: true,
              worldviewText: true,
              style: true,
            },
            hasReferences: true,
            hasWorld: true,
            hasOutline: true,
            hasArcs: true,
            hasCharacters: true,
            readyToWrite: true,
          },
          coverage: {
            volumes: 1,
            arcs: 1,
            plannedChapters: 5,
            plannedRemaining: 3,
            targetChapters: null,
          },
          health: { openHooks: 2, staleHooks: 0, majorEvents: 3 },
          recentPhase: null,
          nextStep: 'write_next_chapter',
        }),
      } as unknown as StatusService;
      const masterOutlines = {
        get: jest.fn().mockResolvedValue({
          theme: '凡人修仙',
          mainLine: '废柴到飞升',
          ending: '破开天界',
          powerProgression: [{ volume: 1, level: '炼气→筑基' }],
          hiddenLines: [{ name: '身世', plant: '卷1', reveal: '卷6' }],
          volumeSplitLogic: '按境界分卷',
        }),
      } as never;
      const svc = new ContextAssembler(
        {
          novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) },
        } as unknown as PrismaService,
        statusService,
        masterOutlines,
        stubProcessMemory,
      );
      const { prompt } = await svc.forSession('u1', 's-x');
      // 只留 总纲 + 态势
      expect(prompt).toContain('【总纲】');
      expect(prompt).toContain('【小说态势】');
      // 不注入 writer 导向 / 动态 slice
      expect(prompt).not.toContain('【前情】');
      expect(prompt).not.toContain('【角色】');
      expect(prompt).not.toContain('【未回收伏笔】');
      expect(prompt).not.toContain('【世界观】');
      expect(prompt).not.toContain('【近期关键事件】');
      expect(prompt).not.toContain('【写作参考】');
      expect(prompt).not.toContain('【当前弧线】');
    });

    it('注入【本书过程记忆】slice 当记忆非空', async () => {
      const processMemory = {
        get: jest.fn().mockResolvedValue({
          rules: '不用第一人称',
          lessons: '短章快节奏',
          decisions: '第15章主角调硬',
        }),
      } as unknown as ProcessMemoryService;
      const svc = new ContextAssembler(
        {
          novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) },
        } as unknown as PrismaService,
        stubStatusService,
        stubMasterOutlines,
        processMemory,
      );
      const { prompt } = await svc.forSession('u1', 's-mem');
      // slice 头标记(独特于注入 slice,不与 main.md 维护节冲突)
      expect(prompt).toContain('main 维护,每轮 update_memory 更新');
      expect(prompt).toContain('不用第一人称');
      expect(prompt).toContain('短章快节奏');
      expect(prompt).toContain('第15章主角调硬');
    });

    it('记忆为空/null → 不注入过程记忆 slice', async () => {
      const processMemory = {
        get: jest.fn().mockResolvedValue(null),
      } as unknown as ProcessMemoryService;
      const svc = make(
        { novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) } },
        processMemory,
      );
      const { prompt } = await svc.forSession('u1', 's-empty');
      // slice 头标记不出现(main.md 维护节会有【本书过程记忆】标题,但不会有 slice 头)
      expect(prompt).not.toContain('main 维护,每轮 update_memory 更新');
    });
  });
});
