# 确定性正文守卫层(prose-guard)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增确定性 `ProseGuardService` + `check_prose` 工具,挂在 CHAPTER_ORCH 的 settler 与 validator 之间,把 LLM 裁判管不了的退化/机械句式/字数/工程词泄漏下沉成确定性闸门,blocking 与 validator.blockingIssues 取并集驱动现有修订闭环。

**Architecture:** 纯函数模块 `prose-guard.ts`(检测 + 机械归一,无 DB,无 DI)被 `check-prose.tool.ts` 包裹(经 ChapterService 读正文/写回归一、NovelService 读 chapterWordTarget)。工具经 TOOL_REGISTRY + AGENT_TREE 挂到 CHAPTER_ORCH(与 snapshot_chapter/restore_chapter 同级)。提示词把 check_prose 插入章流程,修订闭环取并集。

**Tech Stack:** NestJS 11 + TypeScript + `@langchain/core/tools`(tool 工厂)+ zod。测试 jest(`*.spec.ts` 单测 + `test/smoke/l1-*` 集成)。

参考 spec:[2026-06-30-prose-guard-design.md](../specs/2026-06-30-prose-guard-design.md)。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `server/src/agentos/prose-guard.ts` (+spec) | 纯函数:类型 + `splitSentences` + 各 detector + `autoFix` + `check`。无 DB/无 DI |
| `server/src/agentos/tools/check-prose.tool.ts` (+spec) | `makeCheckProseTool` 工厂:读章正文 + chapterWordTarget,跑 `check`,auto-fix 写回,返回 report |
| `server/src/agentos/agent-registry.ts` | TOOL_REGISTRY 加 `check_prose` 条目 |
| `server/src/agentos/agent-tree.config.ts` | CHAPTER_ORCH `tools` 加 `'check_prose'` |
| `server/src/agentos/agent-tree.config.spec.ts` | 同步 CHAPTER_ORCH tools 断言 |
| `server/src/agentos/prompts/chapter-orchestrator.md` | 插入 check_prose 步 + 并集修订规则 |
| `server/src/agentos/prompts/writer.md` / `validator.md` | 小补:退化段重写 / 【守卫证据】 |
| `server/test/smoke/l1-integration.spec.ts` | 加 check_prose 端到端断言 |

---

## Task 1: 类型 + `splitSentences` 纯函数

**Files:**
- Create: `server/src/agentos/prose-guard.ts`
- Test: `server/src/agentos/prose-guard.spec.ts`

- [ ] **Step 1: 写失败测试(splitSentences)**

Create `server/src/agentos/prose-guard.spec.ts`:

```ts
import { splitSentences } from './prose-guard';

describe('splitSentences', () => {
  it('按中文终止标点切句,标注长度', () => {
    const s = splitSentences('陆青衫站在雨中。刀尖滴血。');
    expect(s.map((x) => x.len)).toEqual([7, 5]);
    expect(s.every((x) => !x.isDialogue)).toBe(true);
  });

  it('纯对话行标 isDialogue(不计入句长检测)', () => {
    const s = splitSentences('「你来啦。」');
    expect(s).toHaveLength(1);
    expect(s[0].isDialogue).toBe(true);
  });

  it('空内容返空数组', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('多行逐行处理', () => {
    const s = splitSentences('第一句。\n第二句。\n');
    expect(s).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- prose-guard.spec.ts`
Expected: FAIL("splitSentences is not defined" / 模块无导出)

- [ ] **Step 3: 写实现**

Create `server/src/agentos/prose-guard.ts`:

```ts
/**
 * 确定性正文守卫:把 LLM 裁判管不了的退化/机械句式/字数/工程词泄漏下沉成纯函数检测。
 * 无 DB、无 DI —— 由 check-prose.tool.ts 包裹读写。详见
 * docs/superpowers/specs/2026-06-30-prose-guard-design.md
 */

export type FindingType =
  | 'verbatim-repeat' | 'truncation' | 'refusal' | 'leak-tier1'
  | 'em-dash' | 'uniform-length' | 'period-stutter'
  | 'word-count' | 'ai-cliche' | 'leak-tier2';

export interface Finding {
  type: FindingType;
  severity: 'blocking' | 'advisory';
  evidence: string;
  location?: string;
  suggestion: string;
}

export interface ProseGuardReport {
  blocking: Finding[];
  advisory: Finding[];
  autoFixed: string[];
  normalizedContent: string; // auto-fix 后正文;autoFixed 空时 === 原文
  nextAction: 'pass' | 'proceed-validator' | 'revise';
  stats: { wordCount: number; dashPer1k: number; sentenceLens: number[] };
}

export interface Sentence {
  text: string;
  len: number;
  isDialogue: boolean;
}

const DIALOGUE_LINE = /^[「『"][\s\S]*[」』"]$/;

/**
 * 中文分句 + 对话感知。按行处理;每行按终止标点(。！？!?…)切句。
 * 「纯对话行」(整行被引号包裹)标 isDialogue=true —— 句长/碎句检测排除之,
 * 避免网文短促对话大量误伤。混合行(如「他说:"好。"然后走了。」非整行引号)
 * 计为叙述句(保守:只排除纯对话行)。
 */
export function splitSentences(content: string): Sentence[] {
  const out: Sentence[] = [];
  for (const raw of content.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const isDialogue = DIALOGUE_LINE.test(line);
    const parts = line.split(/(?<=[。！？!?…])/).map((p) => p.trim()).filter(Boolean);
    for (const text of parts) {
      out.push({ text, len: text.length, isDialogue });
    }
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- prose-guard.spec.ts`
Expected: PASS(4 用例)

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/prose-guard.ts server/src/agentos/prose-guard.spec.ts
git commit -m "feat(prose-guard): 类型 + splitSentences 中文分句(对话感知)"
```

---

## Task 2: BLOCKING 检测 + `check`(仅 blocking)

**Files:**
- Modify: `server/src/agentos/prose-guard.ts`(追加 detectors + `check`)
- Test: `server/src/agentos/prose-guard.spec.ts`

- [ ] **Step 1: 写失败测试(blocking detectors)**

追加到 `prose-guard.spec.ts`(顶部 import 行改为 `import { splitSentences, check } from './prose-guard';`):

```ts
import { splitSentences, check } from './prose-guard';

describe('check · blocking', () => {
  it('逐字复读:相邻整行完全相同且≥8字 → blocking', () => {
    const r = check('陆青衫站在雨中看着远方。\n陆青衫站在雨中看着远方。');
    expect(r.blocking.some((f) => f.type === 'verbatim-repeat')).toBe(true);
    expect(r.nextAction).toBe('revise');
  });

  it('排比(相似非全等)不命中复读', () => {
    const r = check('他笑了,笑得很大声。\n他哭了,哭得很伤心。');
    expect(r.blocking.some((f) => f.type === 'verbatim-repeat')).toBe(false);
  });

  it('落盘失败:<500字节 且 末行无终止标点 → blocking truncation', () => {
    const r = check('他走进了房间'); // 6字,无终止标点
    expect(r.blocking.some((f) => f.type === 'truncation')).toBe(true);
  });

  it('正常短章不误判 truncation(有终止标点)', () => {
    const r = check('他走进了房间。');
    expect(r.blocking.some((f) => f.type === 'truncation')).toBe(false);
  });

  it('拒绝语(非对话行)→ blocking refusal', () => {
    const r = check('作为人工智能,我无法继续生成。');
    expect(r.blocking.some((f) => f.type === 'refusal')).toBe(true);
  });

  it('对话行里的 Sure 不命中拒绝语', () => {
    const r = check('「Sure,为什么不可以。」');
    expect(r.blocking.some((f) => f.type === 'refusal')).toBe(false);
  });

  it('工程词泄漏 tier1(CBN/任务描述等)→ blocking leak-tier1', () => {
    const r = check('本章的 CBN 是主角觉醒。');
    expect(r.blocking.some((f) => f.type === 'leak-tier1')).toBe(true);
  });

  it('干净正文无 blocking,nextAction 非 revise', () => {
    const r = check('陆青衫站在雨中。刀尖滴血。他抬头望向远方的城楼,心中升起一股不安。');
    expect(r.blocking).toHaveLength(0);
    expect(r.nextAction).not.toBe('revise');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- prose-guard.spec.ts`
Expected: FAIL(check 未导出)

- [ ] **Step 3: 写实现(追加到 prose-guard.ts 末尾)**

```ts
// ── 共用 ──
const DIALOGUE_LINE_RE = /^[「『"][\s\S]*[」』"]$/;
const nonDialogueLines = (content: string): string[] =>
  content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !DIALOGUE_LINE_RE.test(l));

// ── BLOCKING 检测 ──
const REFUSAL_RE = /作为(AI|人工智能|大?语言模型)|^(Sure|Certainly|Here's|Of course|当然可以)|我无法(继续|生成)/;
const LEAK_TIER1_RE = /CBN|CPN|CEN|功能标签|章首钩子|任务描述/;

function detectVerbatimRepeat(content: string): Finding[] {
  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1] && lines[i].length >= 8) {
      return [{
        type: 'verbatim-repeat', severity: 'blocking',
        evidence: lines[i].slice(0, 30), location: `第${i}段`,
        suggestion: '相邻整行逐字复读,重写其中一段',
      }];
    }
  }
  return [];
}

function detectTruncation(content: string): Finding[] {
  if (Buffer.byteLength(content, 'utf8') >= 500) return [];
  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  if (last && !/[。！？!?…」』"]$/.test(last)) {
    return [{
      type: 'truncation', severity: 'blocking',
      evidence: last.slice(0, 30),
      suggestion: '正文过短且末尾无终止标点,疑似截断/落盘失败,补完本章',
    }];
  }
  return [];
}

function detectRefusal(content: string): Finding[] {
  for (const l of nonDialogueLines(content)) {
    if (REFUSAL_RE.test(l)) {
      return [{
        type: 'refusal', severity: 'blocking',
        evidence: l.slice(0, 40), suggestion: '正文出现模型拒绝语,重写该段',
      }];
    }
  }
  return [];
}

function detectLeakTier1(content: string): Finding[] {
  for (const l of nonDialogueLines(content)) {
    if (LEAK_TIER1_RE.test(l)) {
      return [{
        type: 'leak-tier1', severity: 'blocking',
        evidence: l.slice(0, 40), suggestion: '正文泄漏作者工具元词汇,删除',
      }];
    }
  }
  return [];
}

/**
 * 确定性正文守卫主入口。纯函数。opts.chapterWordTarget 缺省则跳过字数检测。
 * v1 阶段(blocking 已接,advisory/autofix 在 Task 3 补全):此处 advisory/autoFixed
 * 暂为空壳,Task 3 填充。
 */
export function check(content: string, opts: { chapterWordTarget?: number } = {}): ProseGuardReport {
  const blocking: Finding[] = [
    ...detectVerbatimRepeat(content),
    ...detectTruncation(content),
    ...detectRefusal(content),
    ...detectLeakTier1(content),
  ];
  const wordCount = content.length;
  const dashPer1k = (content.match(/——/g) || []).length / ((wordCount || 1) / 1000);
  return {
    blocking,
    advisory: [],          // Task 3 填充
    autoFixed: [],         // Task 3 填充
    normalizedContent: content, // Task 3 填充(auto-fix 后)
    nextAction: blocking.length ? 'revise' : 'pass',
    stats: { wordCount, dashPer1k, sentenceLens: [] }, // Task 3 填 sentenceLens
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- prose-guard.spec.ts`
Expected: PASS(全 12 用例)

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/prose-guard.ts server/src/agentos/prose-guard.spec.ts
git commit -m "feat(prose-guard): blocking 检测(复读/截断/拒绝语/工程词)+ check 骨架"
```

---

## Task 3: autoFix + ADVISORY 检测 + 补全 `check`

**Files:**
- Modify: `server/src/agentos/prose-guard.ts`
- Test: `server/src/agentos/prose-guard.spec.ts`

- [ ] **Step 1: 写失败测试(autofix + advisory)**

追加到 `prose-guard.spec.ts`:

```ts
describe('check · autoFix', () => {
  it('删除 \\uFFFD 替换字符', () => {
    const r = check('正文�正文。');
    expect(r.autoFixed.some((s) => s.includes('\\uFFFD'))).toBe(true);
    expect(r.normalizedContent).not.toContain('�');
  });

  it('残留 -- 归一为 ——', () => {
    const r = check('他走了--再没回来。');
    expect(r.normalizedContent).toContain('——');
    expect(r.normalizedContent).not.toMatch(/--/);
  });

  it('合法 —— 不被 autofix(仅泛滥时 advisory)', () => {
    const r = check('他走了——再没回来。');
    expect(r.autoFixed).toHaveLength(0);
    expect(r.normalizedContent).toBe('他走了——再没回来。');
  });
});

describe('check · advisory', () => {
  it('破折号 >2/千字 → advisory em-dash', () => {
    // 短文本里 2 个 —— 即超 2/千字
    const r = check('他走了——回头——叹息——离去。');
    expect(r.advisory.some((f) => f.type === 'em-dash')).toBe(true);
  });

  it('连续三句同长(叙述句)→ advisory uniform-length', () => {
    const r = check('他走进了屋子。她走进了屋子。它走进了屋子。');
    expect(r.advisory.some((f) => f.type === 'uniform-length')).toBe(true);
  });

  it('对话短句不计入 uniform-length/period-stutter', () => {
    const r = check('「好。」「好。」「好。」');
    expect(r.advisory.some((f) => f.type === 'uniform-length')).toBe(false);
    expect(r.advisory.some((f) => f.type === 'period-stutter')).toBe(false);
  });

  it('连续≥3 短叙述句 → advisory period-stutter', () => {
    const r = check('他来了。她笑了。它跑了。风停了。');
    expect(r.advisory.some((f) => f.type === 'period-stutter')).toBe(true);
  });

  it('字数欠账(<90%)→ advisory word-count', () => {
    const r = check('短正文。', { chapterWordTarget: 1000 });
    expect(r.advisory.some((f) => f.type === 'word-count')).toBe(true);
  });

  it('无 chapterWordTarget 时跳过 word-count', () => {
    const r = check('短正文。');
    expect(r.advisory.some((f) => f.type === 'word-count')).toBe(false);
  });

  it('AI 套话 → advisory ai-cliche', () => {
    const r = check('此外,这标志着他命运的转折。');
    expect(r.advisory.some((f) => f.type === 'ai-cliche')).toBe(true);
  });

  it('工程词 tier2(细纲/情节点/卷纲)→ advisory leak-tier2(非 blocking)', () => {
    const r = check('他在心里盘算着细纲。');
    expect(r.advisory.some((f) => f.type === 'leak-tier2')).toBe(true);
    expect(r.blocking.some((f) => f.type === 'leak-tier1')).toBe(false);
  });

  it('nextAction:blocking空、advisory非空 → proceed-validator', () => {
    const r = check('此外,这很重要。');
    expect(r.blocking).toHaveLength(0);
    expect(r.advisory.length).toBeGreaterThan(0);
    expect(r.nextAction).toBe('proceed-validator');
  });

  it('stats 含 sentenceLens', () => {
    const r = check('一句。两句。');
    expect(r.stats.sentenceLens.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- prose-guard.spec.ts`
Expected: FAIL(autofix/advisory 未实现)

- [ ] **Step 3: 写实现(autofix + advisory,替换 Task 2 的 check)**

在 `prose-guard.ts` 的 `check` 函数**之前**追加 autoFix + advisory detectors:

```ts
// ── AUTO-FIX(机械归一,只动无歧义垃圾)──
export function autoFix(content: string): { content: string; fixed: string[] } {
  const fixed: string[] = [];
  let out = content;

  const ffd = (out.match(/�/g) || []).length;
  if (ffd) { out = out.replace(/�/g, ''); fixed.push(`删除 ${ffd} 处 \\uFFFD`); }

  // 先处理独立行 --- (markdown 分割线残留),再处理 --,避免误吞
  const dashLine = (out.match(/(^|\n)\s*-{3}\s*(?=\n|$)/g) || []).length;
  if (dashLine) { out = out.replace(/(^|\n)\s*-{3}\s*(?=\n|$)/g, '\n'); fixed.push(`归一 ${dashLine} 处独立 ---`); }

  const dd = (out.match(/--/g) || []).length;
  if (dd) { out = out.replace(/--/g, '——'); fixed.push(`归一 ${dd} 处 -- 为 ——`); }

  return { content: out, fixed };
}

// ── ADVISORY 检测 ──
const AI_CLICHE_RE = /此外|至关重要|值得注意的是|然而|综上|仿佛.{0,8}一般|作为.{0,8}的证明|标志着|象征着/;
const LEAK_TIER2_RE = /细纲|情节点|卷纲/;

function detectEmDash(content: string): Finding[] {
  const per1k = (content.match(/——/g) || []).length / ((content.length || 1) / 1000);
  if (per1k > 2) {
    return [{
      type: 'em-dash', severity: 'advisory',
      evidence: `${per1k.toFixed(1)}/千字`, suggestion: `破折号 >2/千字,精简`,
    }];
  }
  return [];
}

function detectUniformLength(sents: Sentence[]): Finding[] {
  const narr = sents.filter((s) => !s.isDialogue);
  for (let i = 2; i < narr.length; i++) {
    const lens = [narr[i - 2].len, narr[i - 1].len, narr[i].len];
    if (Math.max(...lens) - Math.min(...lens) <= 2 && narr[i].len >= 6) {
      return [{
        type: 'uniform-length', severity: 'advisory',
        evidence: `${lens.join('/')} 字`, suggestion: '连续三句长度接近,打破匀速',
      }];
    }
  }
  return [];
}

function detectPeriodStutter(sents: Sentence[]): Finding[] {
  const narr = sents.filter((s) => !s.isDialogue);
  let run = 0;
  for (const s of narr) {
    if (s.len <= 8) {
      run++;
      if (run >= 3) {
        return [{
          type: 'period-stutter', severity: 'advisory',
          evidence: '连续短叙述句', suggestion: '连续≥3 短句无呼吸,合并成中长句',
        }];
      }
    } else run = 0;
  }
  return [];
}

function detectWordCount(content: string, target?: number): Finding[] {
  if (!target) return [];
  if (content.length < target * 0.9) {
    return [{
      type: 'word-count', severity: 'advisory',
      evidence: `${content.length}/${target} 字`, suggestion: '字数欠账(<90%),按细纲补情节',
    }];
  }
  return [];
}

function detectAiCliche(content: string): Finding[] {
  const m = content.match(AI_CLICHE_RE);
  if (m) {
    return [{
      type: 'ai-cliche', severity: 'advisory',
      evidence: m[0], suggestion: `AI 套话"${m[0]}",换说法`,
    }];
  }
  return [];
}

function detectLeakTier2(content: string): Finding[] {
  for (const l of nonDialogueLines(content)) {
    if (LEAK_TIER2_RE.test(l)) {
      return [{
        type: 'leak-tier2', severity: 'advisory',
        evidence: l.slice(0, 40), suggestion: '正文出现结构词(细纲/情节点/卷纲),确认非元小说后删除',
      }];
    }
  }
  return [];
}
```

替换 Task 2 的 `check` 函数为完整版:

```ts
export function check(content: string, opts: { chapterWordTarget?: number } = {}): ProseGuardReport {
  const sents = splitSentences(content);
  const { content: normalizedContent, fixed: autoFixed } = autoFix(content);

  const blocking: Finding[] = [
    ...detectVerbatimRepeat(content),
    ...detectTruncation(content),
    ...detectRefusal(content),
    ...detectLeakTier1(content),
  ];
  const advisory: Finding[] = [
    ...detectEmDash(content),
    ...detectUniformLength(sents),
    ...detectPeriodStutter(sents),
    ...detectWordCount(content, opts.chapterWordTarget),
    ...detectAiCliche(content),
    ...detectLeakTier2(content),
  ];

  const wordCount = content.length;
  const dashPer1k = (content.match(/——/g) || []).length / ((wordCount || 1) / 1000);
  const nextAction: ProseGuardReport['nextAction'] = blocking.length
    ? 'revise'
    : advisory.length ? 'proceed-validator' : 'pass';

  return {
    blocking, advisory, autoFixed, normalizedContent, nextAction,
    stats: { wordCount, dashPer1k, sentenceLens: sents.map((s) => s.len) },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- prose-guard.spec.ts`
Expected: PASS(全用例)

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/prose-guard.ts server/src/agentos/prose-guard.spec.ts
git commit -m "feat(prose-guard): autoFix + advisory 检测 + 补全 check(stats/nextAction)"
```

---

## Task 4: `check_prose` 工具(DB 读写包裹)

**Files:**
- Create: `server/src/agentos/tools/check-prose.tool.ts`
- Test: `server/src/agentos/tools/check-prose.tool.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/tools/check-prose.tool.spec.ts`:

```ts
import { makeCheckProseTool } from './check-prose.tool';

const chapters = {
  findByOrder: jest.fn(),
  update: jest.fn(),
};
const novels = { get: jest.fn() };

describe('check_prose tool', () => {
  it('无正文 → ok:false,空 report', async () => {
    chapters.findByOrder.mockResolvedValue({ id: 'c1', content: '' });
    const t = makeCheckProseTool({ userId: 'u', novelId: 'n', chapters: chapters as never, novels: novels as never });
    const r = await t.invoke({ chapterOrder: 1 });
    expect(r).toMatchObject({ ok: false, chapterOrder: 1 });
    expect(r.blocking).toHaveLength(0);
  });

  it('退化正文 → ok:true + blocking + nextAction revise', async () => {
    chapters.findByOrder.mockResolvedValue({
      id: 'c1',
      content: '陆青衫站在雨中看着远方。\n陆青衫站在雨中看着远方。',
    });
    novels.get.mockResolvedValue({ settings: { chapterWordTarget: 2000 } });
    const t = makeCheckProseTool({ userId: 'u', novelId: 'n', chapters: chapters as never, novels: novels as never });
    const r = await t.invoke({ chapterOrder: 1 });
    expect(r.ok).toBe(true);
    expect(r.blocking.length).toBeGreaterThan(0);
    expect(r.nextAction).toBe('revise');
  });

  it('auto-fix 命中 → 调 chapters.update 写回归一正文', async () => {
    chapters.findByOrder.mockResolvedValue({ id: 'c1', content: '正文�正文。' });
    novels.get.mockResolvedValue({ settings: {} });
    chapters.update.mockResolvedValue({});
    const t = makeCheckProseTool({ userId: 'u', novelId: 'n', chapters: chapters as never, novels: novels as never });
    await t.invoke({ chapterOrder: 1 });
    expect(chapters.update).toHaveBeenCalledWith('u', 'n', 'c1', { content: '正文正文。' });
  });

  it('chapterWordTarget 缺省时 novels.get 仍被调用且不报错', async () => {
    chapters.findByOrder.mockResolvedValue({ id: 'c1', content: '正常的一句正文。' });
    novels.get.mockResolvedValue({ settings: null });
    const t = makeCheckProseTool({ userId: 'u', novelId: 'n', chapters: chapters as never, novels: novels as never });
    const r = await t.invoke({ chapterOrder: 1 });
    expect(r.ok).toBe(true);
    expect(r.nextAction).toBe('pass');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- check-prose.tool.spec.ts`
Expected: FAIL(makeCheckProseTool 未定义)

- [ ] **Step 3: 写实现**

Create `server/src/agentos/tools/check-prose.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';
import { check } from '../prose-guard';

/**
 * CHAPTER_ORCH 的「确定性正文守卫」工具,settler 与 validator 之间执行。
 * 读章正文 + Novel.settings.chapterWordTarget,跑纯函数 check,auto-fix 命中则写回。
 * userId/novelId 闭包注入(不从 LLM 入参取)。返回 report;orchestrator 据 nextAction
 * 路由:blocking 非空 → 与 validator.blockingIssues 取并集驱动修订。
 */
export function makeCheckProseTool({
  userId,
  novelId,
  chapters,
  novels,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  novels: NovelService;
}) {
  return tool(
    async ({ chapterOrder }) => {
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      if (!ch?.content) {
        return {
          ok: false as const,
          chapterOrder,
          message: `第 ${chapterOrder} 章无正文,跳过守卫。`,
          blocking: [], advisory: [], autoFixed: [], nextAction: 'pass' as const,
        };
      }
      const novel = await novels.get(userId, novelId);
      const settings = (novel.settings ?? {}) as { chapterWordTarget?: number };
      const report = check(ch.content, { chapterWordTarget: settings.chapterWordTarget });

      if (report.autoFixed.length) {
        await chapters.update(userId, novelId, ch.id, { content: report.normalizedContent });
      }
      return { ok: true as const, chapterOrder, ...report };
    },
    {
      name: 'check_prose',
      description:
        '确定性正文守卫:settler 之后、validator 之前对第 chapterOrder 章跑机械检测(复读/截断/拒绝语/工程词泄漏=blocking;破折号泛滥/句长过匀/碎句号/字数欠账/AI套话=advisory),并自动归一机械残留(\\uFFFD/--)。返回 nextAction:revise=有blocking需修订;proceed-validator=仅advisory进校验;pass=干净。blocking 与 validator.blockingIssues 取并集驱动 writer 修订。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- check-prose.tool.spec.ts`
Expected: PASS(4 用例)

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/tools/check-prose.tool.ts server/src/agentos/tools/check-prose.tool.spec.ts
git commit -m "feat(prose-guard): check_prose 工具(DB 读写包裹)"
```

---

## Task 5: 注册工具(TOOL_REGISTRY + AGENT_TREE)

**Files:**
- Modify: `server/src/agentos/agent-registry.ts`
- Modify: `server/src/agentos/agent-tree.config.ts`
- Modify: `server/src/agentos/agent-tree.config.spec.ts`(同步断言)

- [ ] **Step 1: 写失败测试(AGENT_TREE 断言含 check_prose)**

修改 `server/src/agentos/agent-tree.config.spec.ts`:

(a) 第 119 行(deep-equal 期望树里的 CHAPTER_ORCH tools 数组):

把
```ts
            tools: ['snapshot_chapter', 'restore_chapter'],
```
改为
```ts
            tools: ['snapshot_chapter', 'restore_chapter', 'check_prose'],
```

(b) 文件末尾(第 321 行 `expect(validator.tools).toContain('get_chapter_plan');` 所在 `it` 之后)追加一个可读聚焦断言:

```ts
    it('CHAPTER_ORCH 持确定性守卫工具 check_prose', () => {
      const orch = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      expect(orch.tools).toContain('check_prose');
    });
```

> 该 spec 第 ~307 行有 `expect(AGENT_TREE).toEqual({...期望树...})` 的 deep-equal,期望树第 119 行的 tools 数组会被严格比对;故 (a) 改期望树、(b) 加聚焦断言,二者任一都会在真实 config 未含 check_prose 时判 FAIL。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- agent-tree.config.spec.ts`
Expected: FAIL(deep-equal:期望树含 check_prose 而真实 config 不含;聚焦断言同理)

- [ ] **Step 3: 改真实 config(AGENT_TREE CHAPTER_ORCH tools)**

修改 `server/src/agentos/agent-tree.config.ts` 第 94 行:

把
```ts
      tools: ['snapshot_chapter', 'restore_chapter'],
```
改为
```ts
      tools: ['snapshot_chapter', 'restore_chapter', 'check_prose'],
```

- [ ] **Step 4: 注册 TOOL_REGISTRY**

修改 `server/src/agentos/agent-registry.ts`:

在 import 区(第 46 行 `makeRestoreChapterTool` 之后)追加:
```ts
import { makeCheckProseTool } from './tools/check-prose.tool';
```

在 `TOOL_REGISTRY`(第 186 行 `restore_chapter` 条目之后)追加:
```ts
  check_prose: (d) =>
    makeCheckProseTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
      novels: d.novels,
    }),
```

- [ ] **Step 5: 跑相关测试确认通过**

Run: `cd server && pnpm test -- agent-tree.config.spec.ts agent-registry.spec.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add server/src/agentos/agent-registry.ts server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "feat(prose-guard): 注册 check_prose 到 TOOL_REGISTRY + CHAPTER_ORCH"
```

---

## Task 6: 提示词接入(chapter-orchestrator 为主)

**Files:**
- Modify: `server/src/agentos/prompts/chapter-orchestrator.md`
- Modify: `server/src/agentos/prompts/writer.md`
- Modify: `server/src/agentos/prompts/validator.md`

> 锁约束:`agent-prompts.spec.ts:72` 锁 `CHAPTER_ORCHESTRATOR_PROMPT` 含 `'写→结算→校验'`。本任务的编辑**保留该短语**(不改动顶部第 8 行的「写→结算→校验(+修订) 全流程」),只插入步骤,故该 spec 不需改。

- [ ] **Step 1: chapter-orchestrator.md —— 插入 check_prose 步 + 并集修订**

把 `prompts/chapter-orchestrator.md` 第 10–20 行的【写章流程】替换为:

```markdown
【写章流程】严格按序:
1. 用 task 委派 writer 子 agent:「写/改/续/重写第 N 章」+ 作者具体要求(改/重写附原因)。writer 会自行按其 step 0 读细纲/相邻章接缝/伏笔(query_memory kind=hook 查开放伏笔,刻意推进或回收至少一个)/角色,并对齐字数目标。你不必重复嘱托这些——只传任务与作者要求。
2. writer 返回后,【立即】用 task 委派 settler 子 agent 结算(调 write_summary 提取摘要/角色/伏笔)。
3. 结算后,调 check_prose(N) 跑确定性守卫(复读/截断/拒绝语/工程词泄漏=blocking;破折号/句长/碎句/字数/AI套话=advisory;机械残留自动归一)。记下它的 blocking 与 advisory。
4. 调 check_prose 后,用 task 委派 validator 子 agent 校验;委派消息里把 check_prose 的 advisory 格式化成【守卫证据】(如「破折号 2.3/千字;第3段连续三句同长」)一并传入,供其 dim10/dim7 参考。validator 会调 report_review 给 passed/score/blockingIssues。
5. 【修订闭环,最多 1 轮】unionBlocking = check_prose.blocking ∪ validator.blockingIssues;若非空:
   a. snapshot_chapter(N) 存修订前原版;
   b. 委派 writer 定点修订(把 unionBlocking 传给它;退化类[复读/截断/拒绝语/工程词]→重写受影响段;质感/爽点/钩子类→重写干瘪段落、补爽点、改章末钩;不要整章重写);
   c. 复跑 check_prose + validator(得新 score + 新 blocking);
   d. 若复跑 check_prose 仍有 blocking,或新 score < 原 score(越改越差):restore_chapter(N) 回滚原版。
   unionBlocking 为空或已修订 1 轮即结束,不为满分反复改。
6. 回复主 agent 一句结论(如「第N章已写完+结算+守卫+校验,score 88」或「发现退化,已修订复校通过」)。
```

- [ ] **Step 2: writer.md —— 小补:check_prose blocking = 退化段重写**

在 `prompts/writer.md` 第 33 行(【重写整章】路线说明之后、新空行)追加一段:

```markdown

【守卫退化段 — 收到 check_prose blocking 时】
- 编排器若把 check_prose 的 blocking(逐字复读/末尾截断/拒绝语/工程词泄漏)回传给你,说明某些段落模型退化。按 evidence/定位【只重写受影响的那些段】(replace_text 定点改,或该段局部重写),不要整章重写。退化是局部事故,定点清除即可。
```

- [ ] **Step 3: validator.md —— 小补:可能见【守卫证据】**

在 `prompts/validator.md` 第 10 行(12 维清单之前)追加一句:

```markdown
若编排器在委派消息里给了【守卫证据】(check_prose 的 advisory:破折号/句长/碎句/字数/AI套话计数),据其在 dim10/dim7 作硬证据参考,不必自己重新数。
```

- [ ] **Step 4: 跑 prompt 锁测试确认通过**

Run: `cd server && pnpm test -- agent-prompts.spec.ts`
Expected: PASS(保留 '写→结算→校验' 短语;prompt 数仍 16)

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/prompts/chapter-orchestrator.md server/src/agentos/prompts/writer.md server/src/agentos/prompts/validator.md
git commit -m "feat(prose-guard): 提示词接入 check_prose 步 + 并集修订闭环"
```

---

## Task 7: L1 集成冒烟扩展

**Files:**
- Modify: `server/test/smoke/l1-integration.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `test/smoke/l1-integration.spec.ts` 顶部 import 区追加:

```ts
import { NovelService } from '../../src/novel/novel.service';
import { makeCheckProseTool } from '../../src/agentos/tools/check-prose.tool';
```

在 `beforeAll`(第 30–41 行)内,`snapshots = new RevisionSnapshotService(prisma);` 之后追加:

```ts
    novels = new NovelService(prisma, summaries, events);
```

并在 describe 块顶部的 `let` 声明区(第 20–28 行)追加:

```ts
  let novels: NovelService;
```

在 describe 块末尾(`弧进展派生` 测试之后、闭合 `})` 之前)追加新测试:

```ts
  it('check_prose:退化正文(逐字复读)→ blocking + 写回归一', async () => {
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
```

- [ ] **Step 2: 跑测试确认失败/通过**

Run: `cd server && pnpm test -- l1-integration.spec.ts`
Expected: 需 DB(DATABASE_URL);若已配 → PASS。若环境无 DB,本任务在 CI/local 有 DB 时验证,记一笔。

- [ ] **Step 3: 提交**

```bash
git add server/test/smoke/l1-integration.spec.ts
git commit -m "test(prose-guard): L1 集成冒烟加 check_prose 退化+autofix 断言"
```

---

## Task 8: 全量校验

- [ ] **Step 1: typecheck**

Run: `cd server && pnpm typecheck`
Expected: PASS(0 error)

- [ ] **Step 2: lint**

Run: `cd server && pnpm lint`
Expected: PASS(eslint --fix 后无 error)

- [ ] **Step 3: 全量单测**

Run: `cd server && pnpm test`
Expected: PASS(原有 61+ 套 + 新增 prose-guard.spec / check-prose.tool.spec;L1 需 DB)

- [ ] **Step 4: agent-prompts 锁 + tree 一致性复跑**

Run: `cd server && pnpm test -- agent-prompts.spec.ts agent-tree.config.spec.ts agent-registry.spec.ts`
Expected: PASS

- [ ] **Step 5: 提交(若有 lint 修复)**

```bash
git add -A
git commit -m "chore(prose-guard): lint/typecheck 收尾"
```

---

## 自检(spec 覆盖对照)

- §2 架构(check_prose 挂 CHAPTER_ORCH、settler 与 validator 之间、并集修订)→ Task 4/5/6 ✓
- §3.1 BLOCKING(复读/截断/拒绝语/leak-tier1)→ Task 2 ✓
- §3.2 AUTO-FIX(\\uFFFD/---/--)→ Task 3 ✓
- §3.3 ADVISORY(破折号/匀句/碎句/字数/AI套话/leak-tier2)→ Task 3 ✓
- §3.4 中文分句 + 对话感知 → Task 1 ✓
- §4 数据结构(Finding/ProseGuardReport/nextAction/stats)→ Task 1/2/3 ✓
- §5 改动面(2 新增 + config/registry + 3 prompt + L1)→ Task 1–7 ✓
- §6.2 auto-fix 早于 snapshot(顺序由 prompt step 5 保证:check_prose 在 step 3,snapshot 在 step 5a)→ Task 6 ✓
- §8 验收(单测正负例 + L1 + e2e 不回归)→ Task 1–8 ✓
