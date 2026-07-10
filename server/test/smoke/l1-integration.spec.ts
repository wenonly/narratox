import { PrismaService } from '../../src/prisma/prisma.service';
import { ChapterService } from '../../src/novel/chapter.service';
import { NovelService } from '../../src/novel/novel.service';
import { SummaryService } from '../../src/memory/chapter-summary.service';
import { EventService } from '../../src/memory/event.service';
import { StoryEventService } from '../../src/memory/story-event.service';
import { RevisionSnapshotService } from '../../src/novel/revision-snapshot.service';
import { OutlineService } from '../../src/novel/outline.service';
import { MasterOutlineService } from '../../src/novel/master-outline.service';
import { ArcService } from '../../src/novel/arc.service';
import { CharacterService } from '../../src/novel/character.service';
import { NovelReferenceService } from '../../src/novel/novel-reference.service';
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
  let references: NovelReferenceService;
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
    novels = new NovelService(prisma, summaries, storyEvents);
    references = new NovelReferenceService(prisma);
  });

  afterAll(async () => {
    await teardown(prisma, userId);
    await prisma.$disconnect();
  });

  it('appendSection 写正文 + 细纲→WRITTEN(CONCEPT→ACTIVE 在工具层,见 markActiveIfConcept)', async () => {
    await seedOutline(prisma, novelId, 1);
    await chapters.appendSection(
      userId,
      novelId,
      1,
      '陆青衫站在雨中。刀尖滴血。',
    );
    const ch = await prisma.chapter.findFirst({ where: { novelId, order: 1 } });
    expect((ch?.content || '').length).toBeGreaterThan(0);
    const outline = await prisma.chapterOutline.findFirst({
      where: { novelId, chapterOrder: 1 },
    });
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
      roleChanges: [
        {
          name: '陆青衫',
          field: 'status',
          value: '被追杀',
          reason: '刺客上门',
        },
      ],
      entities: [{ type: 'item', name: '青衫剑', note: '本命剑' }],
    });
    await events.createEvents(
      userId,
      novelId,
      [
        {
          description: '陆青衫雨夜斩杀刺客',
          significance: 'MAJOR',
          involvedCharacters: ['陆青衫'],
        },
      ],
      1,
    );
    await storyEvents.createHooks(
      userId,
      novelId,
      [
        {
          description: '刺客背后的灭门线索',
          payoffTiming: 'NEAR_TERM',
          core: false,
        },
      ],
      1,
    );

    await assertSummaryExists(prisma, novelId, 1);
    await assertEventsExist(prisma, novelId, 1, 1);
    const hookCount = await prisma.storyEvent.count({ where: { novelId } });
    expect(hookCount).toBeGreaterThanOrEqual(1);
  });

  it('clear_chapter 安全网:清空前自动 snapshot → 可 restore', async () => {
    // ch1 有正文(上面 appendSection 写了) → clear 应自动 snapshot
    const clearTool = makeClearChapterTool({
      userId,
      novelId,
      chapters,
      snapshots,
    });
    await clearTool.invoke({ chapterOrder: 1 });
    // snapshot 是 in-memory;restore 应返回 ok(证明 snapshot 被自动创建)
    const restored = await snapshots.restore(userId, novelId, 1);
    expect(restored.ok).toBe(true);
  });

  it('弧进展派生:listByChapterRange 按 range 取摘要', async () => {
    // ch2 已存在(gate test 建了);给它加摘要
    const ch2 = await prisma.chapter.findFirst({
      where: { novelId, order: 2 },
    });
    if (ch2) {
      await summaries.upsert({
        userId,
        novelId,
        chapterId: ch2.id,
        summary: '陆青衫查到线索',
        roleChanges: [],
        entities: [],
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
    await chapters.update(userId, novelId, chapterId, {
      content: '正常正文一句。�',
    });
    const t = makeCheckProseTool({ userId, novelId, chapters, novels });
    await t.invoke({ chapterOrder: 1 });
    const ch = await prisma.chapter.findFirst({ where: { novelId, order: 1 } });
    expect(ch?.content).not.toContain('�');
  });

  it('大纲细粒度:patch 部分字段 → delete → assertHasPlan 卡住写章', async () => {
    const outlines = new OutlineService(
      prisma,
      new MasterOutlineService(prisma),
      new ArcService(prisma),
    );
    // 给 ch3 建细纲(ch1/2 已被前面 case 占用)
    await outlines.upsertChapterPlan(userId, novelId, 3, {
      title: '第3章原计划',
      cbn: { subject: '主角', action: '到达', target: '山门' },
      cpns: [{ subject: '主角', action: '遇到', target: '对手' }],
      cen: { subject: '主角', action: '离开', target: '山门' },
    });
    // patch 只改 cen
    const patchR = await outlines.patchChapterPlan(userId, novelId, 3, {
      cen: { subject: '主角', action: '宿夜', target: '山门' },
    });
    expect(patchR.ok).toBe(true);
    if (patchR.ok) expect(patchR.updatedFields).toEqual(['cen']);
    const plan = await prisma.chapterOutline.findFirst({
      where: { novelId, chapterOrder: 3 },
    });
    expect(plan?.title).toBe('第3章原计划'); // 未传字段零变更
    // delete 后写章卡住
    await outlines.deleteChapterPlan(userId, novelId, 3);
    const gate = await chapters.assertHasPlan(userId, novelId, 3);
    expect(gate.ok).toBe(false);
  });

  it('角色细粒度:clear_fields → delete(cascade=false 拒绝) → delete(cascade=true 连删) → clear 全书', async () => {
    const characters = new CharacterService(prisma);
    // 建 2 个角色 + 1 条变迁(给 c1)
    await characters.upsertCharacter(userId, novelId, {
      name: 'smoke-char-1',
      role: 'PROTAGONIST',
      appearance: '旧外貌',
      personality: '旧性格',
    });
    await characters.upsertCharacter(userId, novelId, {
      name: 'smoke-char-2',
      role: 'SUPPORTING',
    });
    await characters.recordChanges(userId, novelId, 1, [
      {
        name: 'smoke-char-1',
        field: 'personality',
        value: '从天真转冷峻',
        reason: '家变',
        significance: 'MAJOR',
      },
    ]);
    // clear_fields: 把 smoke-char-1 的 appearance 清空,改 personality
    await characters.upsertCharacter(userId, novelId, {
      name: 'smoke-char-1',
      personality: '新性格',
      clear_fields: ['appearance'],
    });
    const ch1 = await prisma.character.findFirst({
      where: { novelId, name: 'smoke-char-1' },
    });
    expect(ch1?.appearance).toBe('');
    expect(ch1?.personality).toBe('新性格');
    // delete smoke-char-1 with cascade=false → 拒绝(有 1 条变迁)
    const r1 = await characters.deleteCharacter(
      userId,
      novelId,
      'smoke-char-1',
      false,
    );
    expect(r1.ok).toBe(false);
    if (!r1.ok && 'error' in r1) expect(r1.error).toBe('HAS_CHANGES');
    // delete smoke-char-2 with cascade=false → ok(无变迁)
    const r2 = await characters.deleteCharacter(
      userId,
      novelId,
      'smoke-char-2',
      false,
    );
    expect(r2.ok).toBe(true);
    // delete smoke-char-1 with cascade=true → 连删
    const r3 = await characters.deleteCharacter(
      userId,
      novelId,
      'smoke-char-1',
      true,
    );
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.deletedChanges).toBe(1);
    // 此时表里应已无 smoke-char-*;再造一个然后 clear_characters
    await characters.upsertCharacter(userId, novelId, { name: 'smoke-char-3' });
    const r4 = await characters.clearCharacters(userId, novelId);
    expect(r4.ok).toBe(true);
    const total = await prisma.character.count({ where: { novelId } });
    expect(total).toBe(0);
  });

  it('参考资料细粒度:update/delete 单条不清空其他条目', async () => {
    // setup: replaceAll 建两条
    await references.replaceAll(userId, novelId, [
      { title: 'L1-Ref-A', content: 'a-content', injectTo: 'writer' },
      { title: 'L1-Ref-B', content: 'b-content', injectTo: 'writer' },
    ]);
    const all = await references.listAll(userId, novelId);
    expect(all.length).toBe(2);
    const target = all.find((r) => r.title === 'L1-Ref-B')!;

    // update 改 B 的 content(字段级 patch,不动 A)
    await references.update(userId, novelId, target.id, {
      content: 'b-updated',
    });

    const after = await references.listAll(userId, novelId);
    expect(after.length).toBe(2); // 关键:其他条目仍在,未触发 set_references 的清空
    const bAfter = after.find((r) => r.id === target.id)!;
    expect(bAfter.content).toBe('b-updated');
    const aAfter = after.find((r) => r.title === 'L1-Ref-A')!;
    expect(aAfter.content).toBe('a-content');

    // delete B → 只剩 A
    await references.deleteOne(userId, novelId, target.id);
    const final = await references.listAll(userId, novelId);
    expect(final.length).toBe(1);
    expect(final[0].title).toBe('L1-Ref-A');

    // title 唯一性:create 同名被拒
    await references.create(userId, novelId, {
      title: 'L1-Ref-A',
      content: 'dup',
    }).catch((e) => {
      // 预期抛 BadRequestException
      expect(String(e.message)).toMatch(/已存在/);
    });

    // 清理本测试造的数据,避免污染其他 case
    await references.replaceAll(userId, novelId, []);
  });
});
