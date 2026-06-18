import { makeQueryMemoryTool } from './query-memory.tool';
import { PrismaService } from '../../prisma/prisma.service';

interface InvokableTool {
  invoke: (input: unknown) => Promise<unknown>;
}

const invoke =
  (t: InvokableTool) =>
  (input: unknown): Promise<unknown> =>
    t.invoke(input);

describe('query_memory tool', () => {
  it('returns matching summaries + hooks by keyword (contains, both when kind omitted)', async () => {
    const prisma = {
      chapterSummary: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { summary: '陈平安觉醒剑修', chapter: { order: 2 } },
          ]),
      },
      storyEvent: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'e1', description: '陈平安的身世', status: 'OPEN' },
          ]),
      },
    };
    const tool = makeQueryMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      prisma: prisma as unknown as PrismaService,
    });
    const out = (await invoke(tool)({ query: '陈平安' })) as {
      summaries: unknown[];
      hooks: unknown[];
    };
    expect(prisma.chapterSummary.findMany).toHaveBeenCalled();
    expect(out.summaries).toEqual([
      { chapterOrder: 2, summary: '陈平安觉醒剑修' },
    ]);
    expect(out.hooks).toEqual([
      { id: 'e1', description: '陈平安的身世', status: 'OPEN' },
    ]);
  });

  it('kind=hook searches only hooks', async () => {
    const prisma = {
      chapterSummary: { findMany: jest.fn() },
      storyEvent: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'e1', description: '钥匙', status: 'OPEN' },
          ]),
      },
    };
    const tool = makeQueryMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      prisma: prisma as unknown as PrismaService,
    });
    const out = (await invoke(tool)({ query: '钥匙', kind: 'hook' })) as {
      summaries: unknown[];
      hooks: unknown[];
    };
    expect(prisma.chapterSummary.findMany).not.toHaveBeenCalled();
    expect(out.hooks).toHaveLength(1);
  });

  it('empty query returns empty arrays', async () => {
    const prisma = {
      chapterSummary: { findMany: jest.fn() },
      storyEvent: { findMany: jest.fn() },
    };
    const tool = makeQueryMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      prisma: prisma as unknown as PrismaService,
    });
    const out = (await invoke(tool)({ query: '   ' })) as {
      summaries: unknown[];
      hooks: unknown[];
    };
    expect(prisma.chapterSummary.findMany).not.toHaveBeenCalled();
    expect(out).toEqual({ summaries: [], hooks: [] });
  });
});
