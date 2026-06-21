/**
 * LLM 冒烟测试 —— 预置数据(无 LLM) + agent 只写第1章(最小 token)。
 * 验证完整 agent 管道:chapter 编排 → writer → settler → validator。
 *
 * 用法(需 .env 有 DATABASE_URL + 模型环境变量):
 *   SMOKE_PROVIDER=openai-compatible \
 *   SMOKE_MODEL=glm-4-plus \
 *   SMOKE_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
 *   SMOKE_API_KEY=your-key \
 *   pnpm test:smoke
 *
 * 或把 SMOKE_* 放进 server/.env。
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DeepAgentService } from '../src/agentos/deep-agent.service';
import { OutlineService } from '../src/novel/outline.service';
import { WorldEntryService } from '../src/novel/world-entry.service';
import { CharacterService } from '../src/novel/character.service';
import { ContextAssembler } from '../src/agentos/context-assembler.service';
import { ModelConfigService } from '../src/settings/model-config.service';

const NODE = { subject: '少年', action: '到达', target: '铁铺' };
const TEST_EMAIL = 'smoke-test@narratox.test';

async function main() {
  const required = ['SMOKE_PROVIDER', 'SMOKE_MODEL', 'SMOKE_API_KEY'];
  for (const k of required)
    if (!process.env[k]) {
      console.error(`❌ 缺少环境变量 ${k}。用法见 test/smoke.ts 顶部注释。`);
      process.exit(1);
    }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const deepAgent = app.get(DeepAgentService);
  const outlines = app.get(OutlineService);
  const world = app.get(WorldEntryService);
  const characters = app.get(CharacterService);
  const contextAssembler = app.get(ContextAssembler);
  const modelConfigs = app.get(ModelConfigService);

  try {
    // ── 1. 清理旧数据 + 建测试用户 ──
    const old = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (old) await prisma.user.delete({ where: { id: old.id } });

    const user = await prisma.user.create({
      data: { email: TEST_EMAIL, passwordHash: 'smoke', username: 'smoke' },
    });
    const userId = user.id;
    console.log(`✅ 测试用户: ${userId}`);

    // ── 2. 建模型配置 ──
    const cfg = await modelConfigs.create(userId, {
      name: 'smoke-test',
      provider: process.env.SMOKE_PROVIDER!,
      model: process.env.SMOKE_MODEL!,
      baseUrl: process.env.SMOKE_BASE_URL,
      apiKey: process.env.SMOKE_API_KEY!,
      temperature: 0.7,
    });
    await modelConfigs.activate(userId, cfg.id);
    console.log(`✅ 模型配置: ${cfg.id}`);

    // ── 3. 建小说 + 会话 + 种子章 ──
    const session = await prisma.session.create({
      data: { id: `smoke-${userId}`, userId, agentId: 'deep-agent', name: '冒烟测试' },
    });
    const novel = await prisma.novel.create({
      data: {
        userId,
        sessionId: session.id,
        title: '冒烟测试小说',
        genre: '玄幻',
        synopsis: '少年寻剑',
        settings: {
          coreConflict: '寻剑 vs 天命',
          chapterWordTarget: 1000,
          worldviewText: '灵气世界',
          style: '沉稳',
        },
        status: 'ACTIVE',
      },
    });
    const novelId = novel.id;
    await prisma.chapter.create({
      data: { novelId, order: 1, title: '第1章', content: '', status: 'DRAFT' },
    });
    console.log(`✅ 小说: ${novelId}`);

    // ── 4. 预置世界观 + 大纲 + 角色(无 LLM) ──
    await world.upsertEntry(userId, novelId, { type: 'concept', name: '总览', content: '灵气修炼世界' });
    await world.upsertEntry(userId, novelId, { type: 'powerSystem', name: '灵气体系', content: '炼气→筑基→金丹' });
    await outlines.upsertVolume(userId, novelId, 1, { title: '第一卷', goal: '少年下山' });
    await outlines.upsertChapterPlan(userId, novelId, 1, {
      title: '初遇',
      cbn: NODE,
      cpns: [NODE, { subject: '掌柜', action: '算计', target: '少年' }],
      cen: { subject: '少年', action: '持刀', target: '离去' },
      mustCover: ['妖刀认主'],
      forbidden: ['不可暴露身世'],
    });
    await characters.upsertCharacter(userId, novelId, {
      name: '少年', role: 'PROTAGONIST', background: '铁铺学徒',
    });
    console.log(`✅ 预置数据完成`);

    // ── 5. 运行 agent「写第1章」(LLM) ──
    const { prompt } = await contextAssembler.forSession(userId, session.id);
    console.log(`🚀 发送「写第1章」到 agent...`);

    const activities: string[] = [];
    const startTime = Date.now();
    await deepAgent.runTurn({
      userId,
      novelId,
      threadId: session.id,
      userMessage: '写第1章',
      systemPrompt: prompt,
      readingChapterOrder: null,
      emit: (ev) => {
        if (ev.type === 'Act' && ev.act === 'stage')
          activities.push(ev.label as string);
        else if (ev.type === 'Act' && ev.act === 'tool')
          activities.push(`🔧 ${ev.label}`);
      },
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Agent 完成 (${elapsed}s)`);
    console.log(`   活动流: ${activities.join(' → ')}`);

    // ── 6. 验证结果 ──
    const ch = await prisma.chapter.findFirst({ where: { novelId, order: 1 } });
    const summary = await prisma.chapterSummary.findFirst({ where: { novelId, chapter: { order: 1 } } });
    const hooks = await prisma.storyEvent.findMany({ where: { novelId } });
    const charChanges = await prisma.characterChange.findMany({ where: { novelId } });

    console.log('\n═══ 冒烟测试结果 ═══');
    console.log(`章节正文: ${ch?.content?.length ?? 0} 字 ${ch && ch.content.length > 50 ? '✅' : '❌'}`);
    console.log(`已结算(ChapterSummary): ${summary ? '✅' : '❌'}`);
    console.log(`伏笔(StoryEvent): ${hooks.length} 条 ${hooks.length > 0 ? '✅' : '⚠️'}`);
    console.log(`角色变化(CharacterChange): ${charChanges.length} 条 ${charChanges.length > 0 ? '✅' : '⚠️'}`);
    if (hooks.length > 0)
      console.log(`  伏笔 payoffTiming 分布: ${hooks.map((h) => h.payoffTiming).join(', ')}`);

    const pass = ch && ch.content.length > 50 && summary;
    console.log(`\n${pass ? '🎉 冒烟测试通过' : '⚠️ 部分通过(检查上面的❌)'}`);

  } finally {
    // ── 7. 清理 ──
    const u = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (u) await prisma.user.delete({ where: { id: u.id } });
    await app.close();
    console.log('🧹 已清理测试数据');
  }
}

main().catch((err) => {
  console.error('❌ 冒烟测试失败:', err);
  process.exit(1);
});
