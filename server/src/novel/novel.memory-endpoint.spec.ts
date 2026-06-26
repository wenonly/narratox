import { NovelService } from './novel.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';

describe('NovelService.getChapterMemory', () => {
  it('returns settled:false when no summary exists for the chapter', async () => {
    const prisma = {
      novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1' }) },
      chapter: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const summaries = {
      findByChapter: jest.fn().mockResolvedValue(null),
    } as unknown as SummaryService;
    const events = {
      listForChapter: jest.fn(),
    } as unknown as StoryEventService;
    const svc = new NovelService(
      prisma as unknown as PrismaService,
      summaries,
      events,
    );
    const out = await svc.getChapterMemory('u1', 'n1', 3);
    expect(out).toEqual({
      settled: false,
      chapterOrder: 3,
      summary: '',
      roleChanges: [],
      entities: [],
      newHooks: [],
      resolvedHooks: [],
    });
  });

  it('rebuilds MemoryData from ChapterSummary + StoryEvents for the chapter', async () => {
    const prisma = {
      novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1' }) },
      chapter: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const summaries = {
      findByChapter: jest.fn().mockResolvedValue({
        summary: '觉醒',
        roleChanges: [{ name: '陈平安', change: '觉醒' }],
        entities: [{ type: 'item', name: '剑', note: '所得' }],
      }),
    } as unknown as SummaryService;
    const events = {
      listForChapter: jest.fn().mockResolvedValue([
        {
          id: 'e1',
          description: '黑影',
          openedAtChapter: 3,
          resolvedAtChapter: null,
        },
        {
          id: 'e2',
          description: '钥匙',
          openedAtChapter: 2,
          resolvedAtChapter: 3,
        },
      ]),
    } as unknown as StoryEventService;
    const svc = new NovelService(
      prisma as unknown as PrismaService,
      summaries,
      events,
    );
    const out = await svc.getChapterMemory('u1', 'n1', 3);
    expect(out.settled).toBe(true);
    expect(out.summary).toBe('觉醒');
    expect(out.roleChanges).toEqual([{ name: '陈平安', change: '觉醒' }]);
    expect(out.newHooks).toEqual([{ id: 'e1', description: '黑影' }]);
    expect(out.resolvedHooks).toEqual([{ id: 'e2', description: '钥匙' }]);
  });
});
