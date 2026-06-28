/**
 * L3 LLM-Judge 质量评估:用系统自带 validator(真模型)给章节打分 + 提取完整性。
 *
 * 用法:pnpm test:eval
 * env:BASE=http://localhost:3001 EMAIL=... PASSWORD=... NOVEL_ID=... CHAPTER=2
 * 需 server 跑 + 模型配好。
 *
 * 产出:eval-report(validator 分数 + settler 提取完整性 + 工具轨迹)。
 * 红队(注入不一致测 catch-rate)TODO——需 PATCH 注入 + 复跑 validator + 恢复。
 */
import {
  type ActivityFrame,
  toolsInOrder,
} from '../../test/harness/assertTrajectory';
import { runTurn } from '../../test/harness/runTurn';

const BASE = process.env.BASE || 'http://localhost:3001';
const EMAIL = process.env.EMAIL || '';
const PASSWORD = process.env.PASSWORD || '';
const NOVEL_ID = process.env.NOVEL_ID || '';
const CHAPTER = Number(process.env.CHAPTER || 2);

let token = '';
let sessionId = '';

async function api(path: string, method = 'GET', body?: unknown) {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

async function main() {
  if (!EMAIL || !NOVEL_ID) { console.error('需要 EMAIL/PASSWORD/NOVEL_ID env'); process.exit(1); }

  // login + 找 session
  const loginResp = await api('/auth/login', 'POST', { email: EMAIL, password: PASSWORD });
  token = loginResp.token;
  const novel = await api(`/novels/${NOVEL_ID}`);
  sessionId = novel.sessionId;
  console.log(`L3 评估:novel=${NOVEL_ID} ch=${CHAPTER}`);

  // ── 1. validator 复检(让系统自带 validator 给分)──
  console.log('\n▶ validator 复检');
  const frames: ActivityFrame[] = await runTurn(
    BASE, token, NOVEL_ID, sessionId,
    `请严格检查第${CHAPTER}章的正文质量,逐维 0-100 打分,给出 blockingIssues。`,
  );
  const tools = toolsInOrder(frames);

  // 从所有 ActTool 帧扫描 score/passed(report_review 的结构化输出,可能不在预期位置)
  let score: number | null = null;
  let passed: boolean | null = null;
  let blockingCount = -1;
  for (const f of frames) {
    if (f.event === 'ActTool' && f.args && typeof f.args === 'object') {
      const args = f.args as Record<string, unknown>;
      if (typeof args.score === 'number') score = args.score;
      if (typeof args.passed === 'boolean') passed = args.passed;
      if (Array.isArray(args.blockingIssues)) blockingCount = args.blockingIssues.length;
    }
  }

  console.log(`  validator score: ${score ?? '(未提取到)'}`);
  console.log(`  passed: ${passed ?? '(未提取到)'}`);
  console.log(`  工具数: ${tools.length}`);
  console.log(`  含 get_chapter_plan: ${tools.includes('get_chapter_plan')}`);
  console.log(`  含 get_character: ${tools.includes('get_character')}`);
  console.log(`  含 get_events: ${tools.includes('get_events')}`);

  // ── 2. settler 提取完整性(查 DB)──
  console.log('\n▶ settler 提取完整性');
  const summary = await api(`/novels/${NOVEL_ID}/chapters/${CHAPTER}/summary`);
  const events = await api(`/novels/${NOVEL_ID}/events`);
  const chEvents = Array.isArray(events) ? events.filter((e: any) => e.chapterOrder === CHAPTER) : [];
  console.log(`  摘要: ${summary?.summary ? `"${String(summary.summary).slice(0, 50)}..."` : '(空)'}`);
  console.log(`  角色变化: ${summary?.roleChanges?.length ?? 0} 条`);
  console.log(`  事件: ${chEvents.length} 条`);

  // ── 3. 红队:注入不一致(越级飞升)→ 看 validator 抓不抓 ──
  console.log('\n▶ 红队:注入「炼气→元婴越级」');
  const chapterRow = await api(`/novels/${NOVEL_ID}`);
  const ch = chapterRow.chapters?.find((c: any) => c.order === CHAPTER);
  if (ch) {
    const original = ch.content;
    const inject = '\n\n突然，陆青衫体内涌起一股前所未有的磅礴力量——他突破了！直接从炼气期飞升至元婴期，天降异象。';
    await api(`/novels/${NOVEL_ID}/chapters/${ch.id}`, 'PATCH', { content: original + inject });
    console.log('  已注入越级段落,跑 validator(不告诉它)...');
    const rtFrames: ActivityFrame[] = await runTurn(
      BASE, token, NOVEL_ID, sessionId,
      `请检查第${CHAPTER}章一致性,逐维打分。`,
    );
    // 恢复原文
    await api(`/novels/${NOVEL_ID}/chapters/${ch.id}`, 'PATCH', { content: original });
    // 扫 blockingIssues
    let rtBlocking = -1;
    let rtScore: number | null = null;
    for (const f of rtFrames) {
      if (f.event === 'ActTool' && f.args && typeof f.args === 'object') {
        const a = f.args as Record<string, unknown>;
        if (Array.isArray(a.blockingIssues)) rtBlocking = a.blockingIssues.length;
        if (typeof a.score === 'number') rtScore = a.score;
      }
    }
    const caught = rtBlocking > 0;
    console.log(`  validator ${caught ? '✓ 抓到了' : '✗ 没抓到'} | blockingIssues=${rtBlocking} | score=${rtScore ?? 'N/A'}`);
  } else {
    console.log('  (找不到章节,跳过红队)');
  }

  // ── 4. 报告 ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`L3 评估报告`);
  console.log(`  validator score: ${score ?? 'N/A'} | blockingIssues: ${blockingCount >= 0 ? blockingCount : 'N/A'}`);
  console.log(`  提取完整性: 摘要${summary?.summary ? '✓' : '✗'} 角色${(summary?.roleChanges?.length ?? 0) > 0 ? '✓' : '✗'} 事件${chEvents.length > 0 ? '✓' : '✗'}`);
  console.log(`  红队(越级注入): ${typeof rtBlocking === 'number' && rtBlocking > 0 ? '✓ validator 抓到' : (typeof rtBlocking === 'number' ? '✗ 漏报' : 'N/A')}`);
  console.log(`${'='.repeat(60)}`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
