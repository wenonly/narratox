/**
 * 管道集成测试 —— 模拟 agent 的完整工具调用序列,用真实 DB 验证数据管道。
 * 无 LLM、无 UI、确定性、秒级。pnpm test:pipeline 运行。
 *
 * 覆盖:建小说 → 世界观 → 大纲 → 角色 → 写章(关卡) → 结算(伏笔+角色时间线)
 *       → ContextAssembler 注入 → 清理。
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChapterService } from '../src/novel/chapter.service';
import { OutlineService } from '../src/novel/outline.service';
import { WorldEntryService } from '../src/novel/world-entry.service';
import { CharacterService } from '../src/novel/character.service';
import { NovelReferenceService } from '../src/novel/novel-reference.service';
import { SummaryService } from '../src/memory/chapter-summary.service';
import { StoryEventService } from '../src/memory/story-event.service';
import { ContextAssembler } from '../src/agentos/context-assembler.service';

const TEST_EMAIL = 'pipeline-test@narratox.test';

const prisma = new PrismaService();
const chapters = new ChapterService(prisma);
const outlines = new OutlineService(prisma);
const world = new WorldEntryService(prisma);
const characters = new CharacterService(prisma);
const references = new NovelReferenceService(prisma);
const summaries = new SummaryService(prisma);
const events = new StoryEventService(prisma);
const contextAssembler = new ContextAssembler(prisma, summaries, events, world, references);

describe('Pipeline integration (real DB, no LLM)', () => {
  let userId: string;
  let novelId: string;
  let sessionId: string;
  let chapter1Id: string;

  beforeAll(async () => {
    // 清理可能残留的旧测试数据
    const old = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (old) await prisma.user.delete({ where: { id: old.id } }); // cascade 删一切

    // 建测试用户
    const user = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        passwordHash: 'test',
        username: 'pipeline-test',
      },
    });
    userId = user.id;

    // 建会话 + 小说 + 种子章节(模拟 NovelService.create)
    const session = await prisma.session.create({
      data: {
        id: `test-session-${user.id}`,
        userId,
        agentId: 'deep-agent',
        name: '测试小说会话',
      },
    });
    sessionId = session.id;
    const novel = await prisma.novel.create({
      data: {
        userId,
        sessionId,
        title: '管道测试小说',
        genre: '玄幻',
        synopsis: '一个测试主角的冒险',
        settings: {
          coreConflict: '主角寻剑 vs 天命',
          chapterWordTarget: 1000,
          worldviewText: '灵气世界',
          style: '沉稳',
        },
        status: 'ACTIVE',
      },
    });
    novelId = novel.id;
    const ch1 = await prisma.chapter.create({
      data: { novelId, order: 1, title: '第1章', content: '', status: 'DRAFT' },
    });
    chapter1Id = ch1.id;
  });

  afterAll(async () => {
    // 清理:删用户(cascade 删小说/章节/一切)
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ── 基础设施 ──────────────────────────────────────────────
  describe('foundation', () => {
    it('builds worldview entries', async () => {
      await world.upsertEntry(userId, novelId, {
        type: 'concept',
        name: '总览',
        content: '灵气修炼世界',
      });
      await world.upsertEntry(userId, novelId, {
        type: 'powerSystem',
        name: '灵气体系',
        content: '炼气→筑基→金丹→元婴',
      });
      await world.upsertEntry(userId, novelId, {
        type: 'rule',
        name: '天道禁忌',
        content: '不可逆改生死',
      });

      const core = await world.listCore(userId, novelId);
      expect(core).toHaveLength(2); // concept + powerSystem
      const all = await world.listEntries(userId, novelId);
      expect(all).toHaveLength(3);
    });

    it('builds outline (volume + 2 chapter plans)', async () => {
      await outlines.upsertVolume(userId, novelId, 1, {
        title: '初入江湖',
        goal: '主角下山',
      });
      const NODE = { subject: '主角', action: '到达', target: '铁铺' };
      await outlines.upsertChapterPlan(userId, novelId, 1, {
        title: '夺刀',
        cbn: NODE,
        cpns: [NODE, { subject: '掌柜', action: '算计', target: '主角' }],
        cen: { subject: '主角', action: '持刀', target: '逃' },
        mustCover: ['妖刀认主'],
        forbidden: ['不可露身世'],
        volumeId: undefined,
      });
      await outlines.upsertChapterPlan(userId, novelId, 2, {
        title: '追兵',
        cbn: NODE,
        cpns: [NODE],
        cen: NODE,
        mustCover: ['逃脱追击'],
      });

      const { volumes, chapterOutlines } = await outlines.listOutline(
        userId,
        novelId,
      );
      expect(volumes).toHaveLength(1);
      expect(chapterOutlines).toHaveLength(2);
    });

    it('creates characters', async () => {
      await characters.upsertCharacter(userId, novelId, {
        name: '沈砚',
        role: 'PROTAGONIST',
        aliases: ['沈少'],
        background: '棺材铺少掌柜',
      });
      await characters.upsertCharacter(userId, novelId, {
        name: '陆青棠',
        role: 'SUPPORTING',
        background: '镇妖司女修士',
      });
      const list = await characters.listCharacters(userId, novelId);
      expect(list).toHaveLength(2);
      expect(list.find((c) => c.name === '沈砚')?.role).toBe('PROTAGONIST');
    });
  });

  // ── 写章关卡 ──────────────────────────────────────────────
  describe('write chapter 1 + gates', () => {
    it('appendSection passes (ch1 has plan, ch1 is first → frontier OK)', async () => {
      const res = await chapters.appendSection(
        userId,
        novelId,
        1,
        '沈砚推开铺门，冷风灌入。',
      );
      expect(res.ok).toBe(true);
    });

    it('appendSection ch2 blocked by assertFrontier (ch1 has content but no summary)', async () => {
      const res = await chapters.appendSection(
        userId,
        novelId,
        2,
        '追兵到了。',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('predecessor_not_settled');
    });

    it('appendSection ch1 without plan blocked (delete plan, test, restore)', async () => {
      // 暂时删除 ch1 的细纲
      await prisma.chapterOutline.deleteMany({
        where: { novelId, chapterOrder: 1 },
      });
      const res = await chapters.appendSection(
        userId,
        novelId,
        1,
        '再写一段。',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('no_chapter_plan');
      // 恢复细纲
      await outlines.upsertChapterPlan(userId, novelId, 1, {
        title: '夺刀',
        cbn: { subject: '主角', action: '到', target: '铁铺' },
        cpns: [{ subject: '主角', action: '夺', target: '刀' }],
        cen: { subject: '主角', action: '逃', target: '夜' },
        mustCover: ['妖刀认主'],
      });
    });
  });

  // ── 结算(伏笔 + 角色时间线) ─────────────────────────────
  describe('settle chapter 1', () => {
    it('writes summary + hooks (with payoffTiming) + character changes', async () => {
      // 模拟 settler 的 write_summary:
      // 1. ChapterSummary
      await summaries.upsert({
        userId,
        novelId,
        chapterId: chapter1Id,
        summary: '沈砚获得妖刀，初显异象',
        roleChanges: [
          {
            name: '沈砚',
            field: 'personality',
            value: '开始警觉',
            reason: '目睹异象',
          },
          { name: '沈砚', field: 'appearance', value: 'appeared', reason: '' },
        ],
        entities: [{ type: 'item', name: '妖刀', note: '抵债所得' }],
      });
      // 2. CharacterChange
      await characters.recordChanges(userId, novelId, 1, [
        {
          name: '沈砚',
          field: 'personality',
          value: '开始警觉',
          reason: '目睹异象',
        },
        { name: '沈砚', field: 'appearance', value: 'appeared', reason: '' },
      ]);
      // 3. Hooks (B1 lifecycle)
      await events.createHooks(
        userId,
        novelId,
        [
          { description: '妖刀的来历', payoffTiming: 'SLOW_BURN', core: true },
          { description: '老人的身份', payoffTiming: 'MID_ARC' },
        ],
        1,
      );
    });

    it('ChapterSummary exists with correct data', async () => {
      const s = await summaries.findByChapter(userId, novelId, chapter1Id);
      expect(s).toBeTruthy();
      expect(s!.summary).toBe('沈砚获得妖刀，初显异象');
    });

    it('hooks tracked with payoffTiming + coreHook', async () => {
      const open = await events.listOpen(userId, novelId);
      expect(open).toHaveLength(2);
      const core = open.find((h) => h.coreHook);
      expect(core?.description).toBe('妖刀的来历');
      expect(core?.payoffTiming).toBe('SLOW_BURN');
    });

    it('character timeline has changes + current state derived', async () => {
      const ch = await characters.getCharacter(userId, novelId, '沈砚');
      expect(ch).toBeTruthy();
      expect(ch!.currentState.personality).toEqual({
        value: '开始警觉',
        chapterOrder: 1,
        reason: '目睹异象',
      });
    });
  });

  // ── 关卡:结算后写 ch2 ────────────────────────────────────
  describe('after settle, ch2 gate passes', () => {
    it('appendSection ch2 passes (ch1 now settled)', async () => {
      const res = await chapters.appendSection(
        userId,
        novelId,
        2,
        '追兵赶到巷口。',
      );
      expect(res.ok).toBe(true);
    });
  });

  // ── ContextAssembler 注入 ────────────────────────────────
  describe('context injection', () => {
    it('forSession injects 前情 + 伏笔 + 世界观', async () => {
      const { prompt, novelId: nid } = await contextAssembler.forSession(
        userId,
        sessionId,
      );
      expect(nid).toBe(novelId);
      expect(prompt).toContain('【前情】');
      expect(prompt).toContain('沈砚获得妖刀');
      expect(prompt).toContain('【未回收伏笔】');
      expect(prompt).toContain('妖刀的来历'); // 核心伏笔
      expect(prompt).toContain('【世界观】');
      expect(prompt).toContain('灵气体系');
    });
  });
});
