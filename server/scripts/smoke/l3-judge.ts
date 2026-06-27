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

  // 从 report_review 工具调用提取分数
  let score: number | null = null;
  let passed: boolean | null = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.event === 'Act' && f.label === 'report_review') {
      // ActTool 帧跟在后面,含 args(score/passed)
      for (let j = i + 1; j < Math.min(i + 5, frames.length); j++) {
        const tf = frames[j];
        if (tf.event === 'ActTool' && tf.args) {
          const args = tf.args as Record<string, unknown>;
          score = typeof args.score === 'number' ? args.score : null;
          passed = typeof args.passed === 'boolean' ? args.passed : null;
          break;
        }
      }
      break;
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

  // ── 3. 报告 ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`L3 评估报告`);
  console.log(`  validator score: ${score ?? 'N/A'}`);
  console.log(`  提取完整性: 摘要${summary?.summary ? '✓' : '✗'} 角色${(summary?.roleChanges?.length ?? 0) > 0 ? '✓' : '✗'} 事件${chEvents.length > 0 ? '✓' : '✗'}`);
  console.log(`  TODO:红队(注入不一致测 catch-rate)待实现`);
  console.log(`${'='.repeat(60)}`);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
