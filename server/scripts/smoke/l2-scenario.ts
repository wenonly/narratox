/**
 * L2 实况场景:真模型,HTTP 驱动,剧本式(像真人使用)。
 * 7 幕:立项→写ch1/2/3→改ch2→重写ch1→续写ch4。每幕轨迹+终态+边界断言。
 *
 * 用法:pnpm test:smoke
 * env:BASE=http://localhost:3001 EMAIL=... PASSWORD=... NOVEL_TITLE=L2-smoke
 * 需 server 跑 + 模型配好 + DATABASE_URL。
 */
import { FIXTURE } from '../../test/harness/fixture';
import {
  type ActivityFrame,
  toolsInOrder,
  assertBefore,
  assertRunCompleted,
  assertNoRunError,
  assertTotalToolsMax,
  assertNoClearWithoutSnapshot,
} from '../../test/harness/assertTrajectory';
import { runTurn } from '../../test/harness/runTurn';

const BASE = process.env.BASE || 'http://localhost:3001';
const EMAIL = process.env.EMAIL || '';
const PASSWORD = process.env.PASSWORD || '';
const TITLE = process.env.NOVEL_TITLE || `${FIXTURE.novelTitlePrefix}${Date.now()}`;

let token = '';
let novelId = '';
let sessionId = '';

// ── helpers ──

async function api(path: string, method = 'GET', body?: unknown) {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

async function login() {
  const r = await api('/auth/login', 'POST', { email: EMAIL, password: PASSWORD });
  token = r.token;
}

async function createNovel() {
  const r = await api('/novels', 'POST', { title: TITLE });
  novelId = r.id;
  sessionId = r.sessionId;
}

async function dbStatus() {
  const s = await api(`/novels/${novelId}/status`);
  return s;
}

interface ActResult { name: string; pass: boolean; detail: string; tools: number }

async function act(name: string, message: string, assert?: (frames: ActivityFrame[]) => void, timeoutMs?: number): Promise<ActResult> {
  console.log(`\n▶ ${name}`);
  try {
    const frames = await runTurn(BASE, token, novelId, sessionId, message, timeoutMs);
    const tools = toolsInOrder(frames);
    const checks: string[] = [];
    assertRunCompleted(frames); checks.push('RunCompleted ✓');
    assertNoRunError(frames); checks.push('NoRunError ✓');
    assertTotalToolsMax(frames, 80); checks.push(`工具 ${tools.length}≤80 ✓`);
    if (assert) { assert(frames); checks.push('轨迹断言 ✓'); }
    console.log(`  ✓ PASS | ${checks.join(' | ')}`);
    return { name, pass: true, detail: checks.join(' | '), tools: tools.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ FAIL | ${msg}`);
    return { name, pass: false, detail: msg, tools: -1 };
  }
}

// ── 剧本 7 幕 ──

async function main() {
  if (!EMAIL) { console.error('需要 EMAIL/PASSWORD env'); process.exit(1); }
  console.log(`L2 实况场景: ${TITLE}`);
  await login();
  await createNovel();
  console.log(`novel=${novelId} session=${sessionId}`);

  const results: ActResult[] = [];

  // 1. 立项(给齐概念,让 main 建世界/大纲/角色)
  results.push(await act('1.立项', [
    `写一本短篇武侠,5章。书名《${FIXTURE.title}》。`,
    `题材:${FIXTURE.genre}。简介:${FIXTURE.synopsis}。`,
    `核心冲突:${FIXTURE.coreConflict}。每章${FIXTURE.chapterWordTarget}字。`,
    `世界观:${FIXTURE.worldviewText}。文风:${FIXTURE.style}。`,
    `请收集基础信息,然后按流程建参考资料、世界观、大纲(含弧线)、角色。`,
  ].join('\n')));

  // 等 main 建完(一轮可能超时 → 给一个"继续"补全)
  const st = await dbStatus();
  if (!st.onboarding?.hasOutline) {
    results.push(await act('1b.补建', '基础信息齐了,请继续建世界观/大纲/角色。', (f) => {
      // Phase 27 重构后:onboarding 期间 main 自建世界观/大纲/角色,每个产物建完必
      // task 委派对应 critic(wb-critic/outline-critic/char-critic)跑结构化自检。
      // 三 critic 调各自 report_*_review 工具——若未出现,说明 main 没走自检闭环。
      const tools = toolsInOrder(f);
      const critics = ['report_worldview_review', 'report_outline_review', 'report_character_review'];
      const missing = critics.filter((c) => !tools.includes(c));
      if (missing.length) {
        console.log(`  NOTE: 未观测到 critic 自检工具被调用(缺 ${missing.join('/')});可能 main 跳过了某阶段或在 1b 之前已完成`);
      }
    }, 1_200_000));
  }

  // 2. 写 ch1
  results.push(await act('2.写ch1', '现在写第1章,写完结算校验后直接回复我,不要写别的。', (f) => {
    assertBefore(f, 'get_chapter_plan', 'append_section');
    assertBefore(f, 'append_section', 'write_summary');
    assertBefore(f, 'write_summary', 'report_review');
  }));

  // 3. 写 ch2
  results.push(await act('3.写ch2', '写第2章,写完结算校验就停。', (f) => {
    assertBefore(f, 'get_chapter_plan', 'append_section');
  }));

  // 4. 写 ch3
  results.push(await act('4.写ch3', '写第3章,写完结算校验就停。'));

  // 5. 改 ch2(定点修订,理想是 replace_text;若 agent 选 clear+重写,记 note)
  results.push(await act('5.改ch2', '把第2章里主角的对话改得更狠一些。写完结算校验就停。', (f) => {
    // 注:auto-snapshot 在 clear_chapter 工具内部(L1 已验证),stream 不可见;
    // 这里仅 note:若改章用了 clear(=整章重写而非定点修订)——行为可改进但不阻断。
    const usedClear = toolsInOrder(f).includes('clear_chapter');
    if (usedClear) console.log('  NOTE: 改章用了 clear_chapter(应优先 replace_text 定点修订)');
  }));

  // 6. 重写 ch1(clear 是预期行为;auto-snapshot 安全网由 L1 验证,stream 不可见)
  results.push(await act('6.重写ch1', '重写第1章,换个开篇切入。写完结算校验就停。'));

  // 7. 续写 ch4(顺序关卡:前驱 ch3 已结算)
  results.push(await act('7.续写ch4', '写第4章,写完结算校验就停。'));

  // ── 报告 ──
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`L2 报告: ${pass}/${results.length} 幕通过`);
  if (fail.length) {
    console.log(`失败:`);
    fail.forEach((r) => console.log(`  ✗ ${r.name}: ${r.detail}`));
  }
  console.log(`${'='.repeat(60)}`);

  // 最终 DB 快照
  const final = await dbStatus();
  console.log(`最终:status=${final.status} 字数=${final.totalWords} 章=${final.chapterCount} frontier=ch${final.frontierChapter}`);

  process.exit(fail.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
