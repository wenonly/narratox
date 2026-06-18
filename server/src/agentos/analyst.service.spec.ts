import { AnalystService } from './analyst.service';
import type { ChapterService } from '../novel/chapter.service';
import type { NovelService } from '../novel/novel.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';

/**
 * AnalystService 的价值在「安全不变量」,纯逻辑可测,无需 LLM mock:
 *  1. settle() 永不抛出(内部 try/catch 吞掉所有错误)。
 *  2. 同一 novelId 的并发第二次 settle 被锁丢弃(锁检查在 doSettle 任何 await 之前)。
 *  3. 失败的 settle 在 finally 里释放锁,下一次同 novel 的 settle 能真正再跑。
 *
 * 仓库内没有 deep-agent.service.spec.ts 之类的 ESM-mock 范本,因此这里走 spec
 * 建议的 fallback 路径:让依赖直接 throw 或返回 null,使 doSettle 在到达
 * getModel()(真实 `await import('@langchain/openai')`)之前就退出 —— 完全规避 LLM。
 */

function makeMocks() {
  const chapters = {
    findByOrder: jest.fn(),
  };
  const novels = {
    get: jest.fn(),
  };
  const summaries = {
    upsert: jest.fn(),
  };
  const events = {
    listOpen: jest.fn(),
    createHooks: jest.fn(),
    resolveHooks: jest.fn(),
  };
  return { chapters, novels, summaries, events };
}

function makeService(mocks: ReturnType<typeof makeMocks>) {
  return new AnalystService(
    mocks.chapters as unknown as ChapterService,
    mocks.novels as unknown as NovelService,
    mocks.summaries as unknown as SummaryService,
    mocks.events as unknown as StoryEventService,
  );
}

describe('AnalystService', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // settle() 内部失败会 console.error —— 测试里压掉,保持输出干净。
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('settle() safety invariants', () => {
    it('never throws when a dependency rejects (error is swallowed, resolves undefined)', async () => {
      const mocks = makeMocks();
      // 第一个 await 就 reject —— doSettle 立刻抛出,但 settle() 必须吞掉。
      mocks.chapters.findByOrder.mockRejectedValue(new Error('db exploded'));
      const svc = makeService(mocks);

      await expect(
        svc.settle({ userId: 'u1', novelId: 'n1', chapterOrder: 3 }),
      ).resolves.toBeUndefined();

      // 错误确实被记录,且没走到下游任何写操作。
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(mocks.summaries.upsert).not.toHaveBeenCalled();
      expect(mocks.events.createHooks).not.toHaveBeenCalled();
    });

    it('releases the per-novel lock after a failed run so the next call proceeds', async () => {
      const mocks = makeMocks();
      mocks.chapters.findByOrder.mockRejectedValue(new Error('transient'));
      const svc = makeService(mocks);

      // 第一次:失败,但 finally 必须释放锁。
      await svc.settle({ userId: 'u1', novelId: 'n-shared', chapterOrder: 1 });
      expect(mocks.chapters.findByOrder).toHaveBeenCalledTimes(1);

      // 第二次:同一 novel —— 如果锁没释放,这次会被 has() 提前 return,
      // findByOrder 不会被再次调用。能再次调用 = 锁已释放。
      await svc.settle({ userId: 'u1', novelId: 'n-shared', chapterOrder: 1 });
      expect(mocks.chapters.findByOrder).toHaveBeenCalledTimes(2);
    });

    it('drops a concurrent second call for the same novel (lock checked before any await)', async () => {
      const mocks = makeMocks();
      // 让 findByOrder 进入「挂起」状态:第一次 settle 的 doSettle 在 await 它时
      // 仍未返回,锁始终持有。此时并发第二次 settle 必须被锁丢弃。
      let releaseFirst: () => void = () => {};
      const pending = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      // 第一次返回 null(走 early-return 路径),但用 pending 卡住它,让 doSettle
      // 在 await findByOrder 期间暂停 —— 这段窗口里锁被持有。
      mocks.chapters.findByOrder.mockImplementationOnce(() => pending.then(() => null));

      const svc = makeService(mocks);

      const first = svc.settle({ userId: 'u1', novelId: 'n-concurrent', chapterOrder: 5 });
      // 让微任务跑起来,确保第一次 settle 已经进入 doSettle 并 await 到 findByOrder。
      await Promise.resolve();
      await Promise.resolve();

      // 并发第二次:锁应被持有 → 直接返回,不调 findByOrder。
      await svc.settle({ userId: 'u1', novelId: 'n-concurrent', chapterOrder: 5 });

      // 此时 findByOrder 只被第一次调用过一次(第二次被锁挡掉)。
      expect(mocks.chapters.findByOrder).toHaveBeenCalledTimes(1);

      // 释放第一次,让它正常结束(并释放锁)。
      releaseFirst();
      await first;

      // 锁释放后,新的一次调用能真正再跑。
      mocks.chapters.findByOrder.mockResolvedValueOnce(null);
      await svc.settle({ userId: 'u1', novelId: 'n-concurrent', chapterOrder: 5 });
      expect(mocks.chapters.findByOrder).toHaveBeenCalledTimes(2);
    });

    it('allows concurrent settle for DIFFERENT novels (lock is per-novelId, not global)', async () => {
      const mocks = makeMocks();
      const svc = makeService(mocks);

      // 两个不同 novel,findByOrder 都返回 null(early-return,不到 LLM)。
      mocks.chapters.findByOrder.mockResolvedValue(null);

      await Promise.all([
        svc.settle({ userId: 'u1', novelId: 'n-A', chapterOrder: 1 }),
        svc.settle({ userId: 'u1', novelId: 'n-B', chapterOrder: 1 }),
      ]);

      // 两个不同 novel 各自真正进入了 doSettle(各调一次 findByOrder)。
      expect(mocks.chapters.findByOrder).toHaveBeenCalledTimes(2);
    });

    it('exits silently (no downstream writes) when the chapter is missing', async () => {
      const mocks = makeMocks();
      mocks.chapters.findByOrder.mockResolvedValue(null); // 章节不在
      const svc = makeService(mocks);

      await svc.settle({ userId: 'u1', novelId: 'n1', chapterOrder: 9 });

      // early-return 在 getModel/novels.get/events 之前 —— 这些都不应被触达。
      expect(mocks.novels.get).not.toHaveBeenCalled();
      expect(mocks.events.listOpen).not.toHaveBeenCalled();
      expect(mocks.summaries.upsert).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
