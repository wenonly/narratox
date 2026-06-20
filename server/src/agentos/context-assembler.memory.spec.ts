import { ContextAssembler } from './context-assembler.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';
import type { WorldEntryService } from '../novel/world-entry.service';

// listCore 返回空 → 不注入世界观 slice(保留旧的 memory-only 测试行为)。
const stubWorld = {
  listCore: jest.fn().mockResolvedValue([]),
} as unknown as WorldEntryService;

const novelRow = () => ({
  id: 'n1',
  title: '剑来',
  genre: '仙侠',
  synopsis: '少年下山',
  settings: { worldviewText: '剑修世界', style: '沉稳' },
  status: 'ACTIVE',
});

const SYSTEM_PROMPT =
  'You are a helpful, concise assistant. Reply in the same language as the user.';

describe('ContextAssembler memory injection', () => {
  it('injects recent summaries + open hooks into an ACTIVE prompt', async () => {
    const prisma = {
      novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) },
    };
    const summaries = {
      listRecent: jest.fn().mockResolvedValue([
        { summary: '主角觉醒', chapterOrder: 2 },
        { summary: '主角下山', chapterOrder: 1 },
      ]),
    };
    const events = {
      listOpen: jest
        .fn()
        .mockResolvedValue([
          { id: 'e1', description: '黑影身份', openedAtChapter: 1 },
        ]),
    };
    const asm = new ContextAssembler(
      prisma as unknown as PrismaService,
      summaries as unknown as SummaryService,
      events as unknown as StoryEventService,
      stubWorld,
    );
    const { prompt, novelId } = await asm.forSession('u1', 's1');
    expect(novelId).toBe('n1');
    expect(summaries.listRecent).toHaveBeenCalledWith('u1', 'n1', 5);
    expect(events.listOpen).toHaveBeenCalledWith('u1', 'n1');
    expect(prompt).toContain('【前情】');
    expect(prompt).toContain('第1章:主角下山');
    expect(prompt).toContain('第2章:主角觉醒');
    expect(prompt).toContain('【未回收伏笔】');
    expect(prompt).toContain('黑影身份');
  });

  it('omits memory slices when none exist', async () => {
    const prisma = {
      novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) },
    };
    const summaries = { listRecent: jest.fn().mockResolvedValue([]) };
    const events = { listOpen: jest.fn().mockResolvedValue([]) };
    const asm = new ContextAssembler(
      prisma as unknown as PrismaService,
      summaries as unknown as SummaryService,
      events as unknown as StoryEventService,
      stubWorld,
    );
    const { prompt } = await asm.forSession('u1', 's1');
    expect(prompt).not.toContain('【前情】');
    expect(prompt).not.toContain('【未回收伏笔】');
  });

  it('falls back to SYSTEM_PROMPT + null novelId when novel lookup misses', async () => {
    const prisma = { novel: { findFirst: jest.fn().mockResolvedValue(null) } };
    const summaries = { listRecent: jest.fn() };
    const events = { listOpen: jest.fn() };
    const asm = new ContextAssembler(
      prisma as unknown as PrismaService,
      summaries as unknown as SummaryService,
      events as unknown as StoryEventService,
      stubWorld,
    );
    const { prompt, novelId } = await asm.forSession('u1', 's1');
    expect(novelId).toBeNull();
    expect(summaries.listRecent).not.toHaveBeenCalled();
    expect(prompt).toBe(SYSTEM_PROMPT);
  });
});
