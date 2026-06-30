import { PrismaService } from '../../src/prisma/prisma.service';
import { ChapterService } from '../../src/novel/chapter.service';
import { NovelService } from '../../src/novel/novel.service';
import { SummaryService } from '../../src/memory/chapter-summary.service';
import { EventService } from '../../src/memory/event.service';
import { StoryEventService } from '../../src/memory/story-event.service';
import { RevisionSnapshotService } from '../../src/novel/revision-snapshot.service';
import { makeClearChapterTool } from '../../src/agentos/tools/clear-chapter.tool';
import { makeCheckProseTool } from '../../src/agentos/tools/check-prose.tool';
import { setupTestNovel, seedOutline, teardown } from '../harness/setup';
import {
  assertChapterCommitted,
  assertSummaryExists,
  assertEventsExist,
  assertNovelStatus,
} from '../harness/assertDb';

// L1 集成冒烟:真 DB + 无模型。测数据管道 + 关卡 + 持久化 + clear 安全网 + 弧派生。
// 需要 DB(DATABASE_URL);setupFiles 已含 dotenv/config。

describe('L1 集成冒烟', () => {
  let prisma: PrismaService;
  let chapters: ChapterService;
  let summaries: SummaryService;
  let events: EventService;
  let storyEvents: StoryEventService;
  let snapshots: RevisionSnapshotService;
  let novels: NovelService;
  let userId: string;
  let novelId: string;
  let chapterId: string;

  beforeAll(async () => {
    const ctx = await setupTestNovel('L1-');
    prisma = ctx.prisma;
    userId = ctx.userId;
    novelId = ctx.novelId;
    chapterId = ctx.chapterId;
    chapters = new ChapterService(prisma);
    summaries = new SummaryService(prisma);
    events = new EventService(prisma);
    storyEvents = new StoryEventService(prisma);
    snapshots = new RevisionSnapshotService(prisma);
    novels = new NovelService(prisma, summaries, events);
  });

  afterAll(async () => {
    await teardown(prisma, userId);
    await prisma.$disconnect();
  });

  it('appendSection 写正文 + 细纲→WRITTEN(CONCEPT→ACTIVE 在工具层,见 markActiveIfConcept)', async () => {
    await seedOutline(prisma, novelId, 1);
    await chapters.appendSection(userId, novelId, 1, '陆青衫站在雨中。刀尖滴血。');
    const ch = await prisma.chapter.findFirst({ where: { novelId, order: 1 } });
    expect((ch?.content || '').length).toBeGreaterThan(0);
    const outline = await prisma.chapterOutline.findFirst({ where: { novelId, chapterOrder: 1 } });
    expect(outline?.status).toBe('WRITTEN');
  });

  it('关卡 assertHasPlan:有章无细纲 → 返回 ok:false(工具层据此拒写)', async () => {
    // ch2 有 Chapter 行但无 outline → assertHasPlan 返回 ok:false
    await prisma.chapter.create({
      data: { novelId, order: 2, title: '第2章', content: '', status: 'DRAFT' },
    });
    const result = await chapters.assertHasPlan(userId, novelId, 2);
    expect(result).toMatchObject({ ok: false });
  });

  it('结算提取:SummaryService + EventService + StoryEventService 落库', async () => {
    await summaries.upsert({
      userId,
      novelId,
      chapterId,
      summary: '陆青衫雨夜出场,斩杀刺客',
      roleChanges: [{ name: '陆青衫', field: 'status', value: '被追杀', reason: '刺客上门' }],
      entities: [{ type: 'item', name: '青衫剑', note: '本命剑' }],
    });
    await events.createEvents(userId, novelId, [
      { description: '陆青衫雨夜斩杀刺客', significance: 'MAJOR', involvedCharacters: ['陆青衫'] },
    ], 1);
    await storyEvents.createHooks(userId, novelId, [
      { description: '刺客背后的灭门线索', payoffTiming: 'NEAR_TERM', core: false },
    ], 1);

    await assertSummaryExists(prisma, novelId, 1);
    await assertEventsExist(prisma, novelId, 1, 1);
    const hookCount = await prisma.storyEvent.count({ where: { novelId } });
    expect(hookCount).toBeGreaterThanOrEqual(1);
  });

  it('clear_chapter 安全网:清空前自动 snapshot → 可 restore', async () => {
    // ch1 有正文(上面 appendSection 写了) → clear 应自动 snapshot
    const clearTool = makeClearChapterTool({ userId, novelId, chapters, snapshots });
    await clearTool.invoke({ chapterOrder: 1 });
    // snapshot 是 in-memory;restore 应返回 ok(证明 snapshot 被自动创建)
    const restored = await snapshots.restore(userId, novelId, 1);
    expect(restored.ok).toBe(true);
  });

  it('弧进展派生:listByChapterRange 按 range 取摘要', async () => {
    // ch2 已存在(gate test 建了);给它加摘要
    const ch2 = await prisma.chapter.findFirst({ where: { novelId, order: 2 } });
    if (ch2) {
      await summaries.upsert({
        userId, novelId, chapterId: ch2.id,
        summary: '陆青衫查到线索',
        roleChanges: [], entities: [],
      });
    }
    const range = await summaries.listByChapterRange(userId, novelId, 1, 2);
    expect(range.length).toBeGreaterThanOrEqual(1);
    expect(range[0].chapterOrder).toBe(1);
  });

  it('check_prose:退化正文(逐字复读)→ blocking + nextAction revise', async () => {
    // 给 ch1 写入退化正文(相邻整行复读)
    await chapters.update(userId, novelId, chapterId, {
      content: '陆青衫站在雨中看着远方。\n陆青衫站在雨中看着远方。',
    });
    const t = makeCheckProseTool({ userId, novelId, chapters, novels });
    const r = await t.invoke({ chapterOrder: 1 });
    expect(r.ok).toBe(true);
    expect(r.blocking.some((f) => f.type === 'verbatim-repeat')).toBe(true);
    expect(r.nextAction).toBe('revise');
  });

  it('check_prose:auto-fix 写回(\\uFFFD 被清除)', async () => {
    await chapters.update(userId, novelId, chapterId, { content: '正常正文一句。�' });
    const t = makeCheckProseTool({ userId, novelId, chapters, novels });
    await t.invoke({ chapterOrder: 1 });
    const ch = await prisma.chapter.findFirst({ where: { novelId, order: 1 } });
    expect(ch?.content).not.toContain('�');
  });
});
