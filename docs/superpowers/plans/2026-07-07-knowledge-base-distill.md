# 知识库提炼（发布脱敏）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `知识库/` 下 63 篇已整理文档做发布脱敏——删人物署名/头衔/整理思考小节、软化互链，原地覆盖，分批推进。

**Architecture:** 机械/语义/校验三段分离。先用确定性 node 脚本全量做"删🧠整节/去行内🧠/转互链"（幂等，可测），再逐篇 LLM 语义重写（署名→无主语陈述），每批用 lint 脚本校验（无🧠/无互链/tags在/非空/字数降幅≤40%）。git 分批提交，可粒度回滚。

**Tech Stack:** Node ≥18 内置（`node:fs` / `node:test` / `node:child_process`），无外部依赖。脚本是 `scripts/distill_kb/` 下的一次性工具，不进任何 build/CI。

**Spec:** [docs/superpowers/specs/2026-07-07-knowledge-base-distill-design.md](../specs/2026-07-07-knowledge-base-distill-design.md)

---

## 文件结构

| 路径 | 责任 | 创建/改 |
|---|---|---|
| `scripts/distill_kb/lib.mjs` | 纯函数：`stripThinkSection` / `unwrapInlineThink` / `softenWikiLinks` / `processContent` / `wordCount` / `checkRules` | Create |
| `scripts/distill_kb/lib.test.mjs` | `node:test` 单测上述纯函数 | Create |
| `scripts/distill_kb/clean_mechanics.mjs` | CLI：扫 6 分类，对每篇 `*.md` 跑 `processContent` 写回 | Create |
| `scripts/distill_kb/lint.mjs` | CLI：扫 6 分类，跑 `checkRules` + 字数降幅（对比 `git show HEAD:`） | Create |
| `知识库/<6 分类>/*.md` | 63 篇被提炼 | Modify |

---

## 语义重写统一规则（Task 5–9 共用）

每篇语义重写按此清单逐项过（机械清理 Task 4 已先全量跑过，互链/🧠已处理，这里只做"署名/头衔/陈述"语义判断）：

**删（人物署名 / 头衔 / 采访人）：**
- `**血红**（坚持论）：「现在网络创作环境不好…」` → 无主语陈述：`坚持：网络创作环境虽不好，但既然投入就应坚持。扛住攻击批评的耐力是动笔前提；初期不以物质利益为目标，当爱好坚持。`
- 表格 `| **血红** | 不写大纲、不构思… |` → 去"谁"留"知识"：`灵感流写法（天才型特例，新人不宜模仿）：不写大纲、随手流出文字、码字 6500–7500 字/时…`
- "各路大神习惯对照表"（本质是"谁的习惯"）→ 整表重构成"常见创作习惯"知识列表
- `起点主编` / `失落叶（网游）` / `老宫编辑` / `老宫` → 删头衔/人名，留陈述；"XX 说"直接引语 → 转客观陈述

**留（案例锚点）：**
- 作品名（《鬼吹灯》《小兵传奇》）、平台名（起点）、具体数据（月票 107 票）：**保留**
- frontmatter `tags`、开头 TL;DR blockquote、分级标题、表格、金句范例：**保留**
- TL;DR 文本里的人名（如"起点主编、血红、失落叶…的精华"）→ 脱敏成"资深作者与编辑的实战经验精华"

**判断准则：** 作品/平台/数据 → 留；人物名/笔名/头衔/采访人 → 删并改无主语陈述；以人名命名的分类组织（如"血红创作观"）→ 拆知识点去人名。

**收尾自检：** 通读一遍，确认无"XX 说"/"XX（标签）："/表格首列是人名 的残留。

---

## Task 1: 备份 + 建脚本目录

**Files:**
- Create: `scripts/distill_kb/`（目录）

- [ ] **Step 1: git 备份知识库现状（可回滚底线）**

```bash
git add 知识库/
git commit -m "chore(kb): 知识库提炼前快照备份" --allow-empty
```
若知识库无改动（已干净），`--allow-empty` 仍留一个可回滚锚点 commit。

- [ ] **Step 2: 建脚本目录**

```bash
mkdir -p scripts/distill_kb
```

- [ ] **Step 3: 确认 node 版本 ≥18（`node --test` 可用）**

Run: `node --version`
Expected: `v18.x` 或更高。

---

## Task 2: 机械清理纯函数 + 单测

**Files:**
- Create: `scripts/distill_kb/lib.mjs`
- Test: `scripts/distill_kb/lib.test.mjs`

- [ ] **Step 1: 写测试（先红）**

Create `scripts/distill_kb/lib.test.mjs`：

```js
// 跑法: node --test scripts/distill_kb/lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripThinkSection,
  unwrapInlineThink,
  softenWikiLinks,
  processContent,
  checkRules,
} from './lib.mjs';

test('stripThinkSection 删末尾🧠整节（标题到文件尾）', () => {
  const body = '## A\n\n正文。\n\n### 🧠 整理思考\n\n结构判断：xx\n';
  assert.equal(stripThinkSection(body), '## A\n\n正文。\n');
});

test('stripThinkSection 无🧠整节时原样返回', () => {
  const body = '## A\n\n正文。\n';
  assert.equal(stripThinkSection(body), body);
});

test('unwrapInlineThink 去行内🧠前缀留内容', () => {
  assert.equal(unwrapInlineThink('> 🧠 旁注内容'), '旁注内容');
  assert.equal(unwrapInlineThink('> 🧠旁注'), '旁注');
  assert.equal(unwrapInlineThink('普通行'), '普通行');
});

test('softenWikiLinks 互链转书名号', () => {
  assert.equal(softenWikiLinks('见 [[某文件]]。'), '见《某文件》。');
  assert.equal(softenWikiLinks('a [[x]] b [[y]] c'), 'a 《x》 b 《y》 c');
});

test('processContent 保留 frontmatter + 正文三件清理', () => {
  const input =
    '---\ntags: [测试]\n---\n\n> **一句话**：tldr。\n\n## A\n\n见 [[某文件]]。\n\n> 🧠 旁注。\n\n### 🧠 整理思考\n\n结构判断：xx\n';
  const out = processContent(input);
  assert.ok(out.startsWith('---\ntags: [测试]\n---\n'), 'frontmatter 保留');
  assert.ok(!out.includes('🧠'), '无 🧠 残留');
  assert.ok(!out.includes('[['), '无 [[ 残留');
  assert.ok(out.includes('见《某文件》。'), '互链已转');
  assert.ok(out.includes('旁注。'), '行内旁注内容保留');
});

test('checkRules 干净内容通过', () => {
  const clean =
    '---\ntags: [x]\n---\n\n## 标题\n\n这是一段足够长的正文内容用于通过长度检查门槛。\n';
  assert.deepEqual(checkRules(clean), []);
});

test('checkRules 抓出 🧠 / [[ / 缺 tags', () => {
  const bad = '---\ntags: [x]\n---\n\n## A\n\n正文 🧠 残留 [[链]]。\n';
  const p = checkRules(bad);
  assert.ok(p.some((x) => x.includes('🧠')));
  assert.ok(p.some((x) => x.includes('[[')));
});
```

- [ ] **Step 2: 跑测试确认失败（lib.mjs 还不存在）**

Run: `node --test scripts/distill_kb/lib.test.mjs`
Expected: FAIL — 模块找不到 / 无法解析 `./lib.mjs`。

- [ ] **Step 3: 写 lib.mjs 实现**

Create `scripts/distill_kb/lib.mjs`：

```js
// scripts/distill_kb/lib.mjs
// 知识库提炼的纯函数（机械清理 + lint 规则）。无副作用，便于 node:test 单测。

/** 删末尾「### 🧠 整理思考」整节：从该标题行到文件尾。 */
export function stripThinkSection(body) {
  const re = /\n#{2,4}\s*🧠[^\n]*\n[\s\S]*$/;
  const m = body.match(re);
  if (!m) return body;
  return body.slice(0, m.index).replace(/\s+$/, '\n');
}

/** 行内「> 🧠 X」去前缀留内容（单行 blockquote 旁注）。 */
export function unwrapInlineThink(body) {
  return body
    .split('\n')
    .map((line) => {
      const m = line.match(/^>\s*🧠\s?(.*)$/);
      return m ? m[1] : line;
    })
    .join('\n');
}

/** 「[[文件名]]」→「《文件名》」。 */
export function softenWikiLinks(text) {
  return text.replace(/\[\[([^\]]+)\]\]/g, '《$1》');
}

/** 拆 frontmatter，对正文做三件机械清理，frontmatter 不动。 */
export function processContent(content) {
  const fm = content.match(/^---\n[\s\S]*?\n---\n/);
  if (!fm) {
    let body = content;
    body = stripThinkSection(body);
    body = unwrapInlineThink(body);
    body = softenWikiLinks(body);
    return body.replace(/^\n+/, '');
  }
  const frontmatter = fm[0];
  let body = content.slice(frontmatter.length);
  body = stripThinkSection(body);
  body = unwrapInlineThink(body);
  body = softenWikiLinks(body);
  return frontmatter + body.replace(/^\n+/, '\n');
}

/** 正文字数（去 frontmatter + 去所有空白后的字符数）。 */
export function wordCount(content) {
  const fm = content.match(/^---\n[\s\S]*?\n---\n/);
  const body = fm ? content.slice(fm[0].length) : content;
  return body.replace(/\s/g, '').length;
}

/** 硬规则检查：返回违规字符串数组（空 = 通过）。 */
export function checkRules(content) {
  const problems = [];
  if (content.includes('🧠')) problems.push('残留 🧠');
  if (/\[\[[^\]]+\]\]/.test(content)) problems.push('残留 [[互链]]');
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) problems.push('缺 frontmatter');
  else if (!/^\s*tags\s*:/m.test(fm[1])) problems.push('frontmatter 缺 tags');
  const body = fm ? content.slice(fm[0].length) : content;
  if (body.replace(/[#>\-\s|]/g, '').length < 50) problems.push('正文过短');
  return problems;
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `node --test scripts/distill_kb/lib.test.mjs`
Expected: PASS — 7 tests pass。

- [ ] **Step 5: Commit**

```bash
git add scripts/distill_kb/lib.mjs scripts/distill_kb/lib.test.mjs
git commit -m "feat(kb-distill): 机械清理纯函数 + 单测"
```

---

## Task 3: clean_mechanics + lint CLI

**Files:**
- Create: `scripts/distill_kb/clean_mechanics.mjs`
- Create: `scripts/distill_kb/lint.mjs`

- [ ] **Step 1: 写 clean_mechanics.mjs（全量机械清理 CLI）**

Create `scripts/distill_kb/clean_mechanics.mjs`：

```js
// scripts/distill_kb/clean_mechanics.mjs
// 跑法: node scripts/distill_kb/clean_mechanics.mjs
// 全量机械清理 知识库/<6分类>/*.md：删🧠整节 / 去行内🧠 / 转互链。确定性，幂等。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processContent } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../知识库/', import.meta.url));
const CATEGORIES = ['人设档案', '公式模板', '创作须知', '拆文案例', '方法论教程', '词汇素材库'];

let changed = 0;
let total = 0;
for (const cat of CATEGORIES) {
  let files;
  try {
    files = await readdir(join(ROOT, cat));
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    total++;
    const p = join(ROOT, cat, f);
    const before = await readFile(p, 'utf8');
    const after = processContent(before);
    if (after !== before) {
      await writeFile(p, after, 'utf8');
      changed++;
      console.log(`cleaned: ${cat}/${f}`);
    }
  }
}
console.log(`\n${changed}/${total} files cleaned.`);
```

- [ ] **Step 2: 写 lint.mjs（校验 CLI）**

Create `scripts/distill_kb/lint.mjs`：

```js
// scripts/distill_kb/lint.mjs
// 跑法: node scripts/distill_kb/lint.mjs
// 校验 知识库/<6分类>/*.md：硬规则（无🧠/无互链/tags在/非空）+ 字数降幅（对比 HEAD）。
import { readdir, readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRules, wordCount } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../知识库/', import.meta.url));
const REPO = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const CATEGORIES = ['人设档案', '公式模板', '创作须知', '拆文案例', '方法论教程', '词汇素材库'];
const MAX_DROP = 0.4;

let total = 0;
const problems = [];
for (const cat of CATEGORIES) {
  let files;
  try {
    files = await readdir(join(ROOT, cat));
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    total++;
    const p = join(ROOT, cat, f);
    const rel = `知识库/${cat}/${f}`;
    const content = await readFile(p, 'utf8');
    for (const rp of checkRules(content)) problems.push(`${rel}: ${rp}`);
    let head = null;
    try {
      head = execSync(`git show HEAD:${rel}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      /* 新文件无 HEAD，跳过降幅检查 */
    }
    if (head != null) {
      const before = wordCount(head);
      const after = wordCount(content);
      const drop = (before - after) / Math.max(1, before);
      if (drop > MAX_DROP) {
        problems.push(`${rel}: 字数降幅 ${Math.round(drop * 100)}% > ${MAX_DROP * 100}%（复查是否误删）`);
      }
    }
  }
}
console.log(`checked ${total} files.`);
if (problems.length) {
  console.error(`\n❌ ${problems.length} problem(s):`);
  for (const x of problems) console.error('  ' + x);
  process.exit(1);
} else {
  console.log('✅ all good.');
}
```

- [ ] **Step 3: 冒烟跑一次 clean_mechanics（dry，先不写回 —— 用 git diff 验）**

实际 clean_mechanics 会直接写回。为安全先跑一次，再用 `git diff --stat` 看影响面。

Run: `node scripts/distill_kb/clean_mechanics.mjs`
Expected: 打印 `cleaned: <分类>/<文件>` 列表 + `N/63 files cleaned.`

- [ ] **Step 4: 看影响面**

Run: `git diff --stat 知识库/`
Expected: 改动文件数 = Step 3 报告的 changed 数；每篇改动行数合理（删🧠整节 + 转互链）。

- [ ] **Step 5: 跑 lint（机械清理后应全绿，因🧠/互链已清、字数降幅是机械清理本身造成、对比 HEAD 是 Task1 备份前？—— 注意：Task 4 才提交机械清理，此步 lint 在 Task 4 前，HEAD 仍是 Task 1 快照，降幅会偏大，属预期）**

此步 lint 仅看"硬规则"列是否全绿（无🧠/无互链/tags在/非空）；字数降幅此阶段会误报，忽略降幅项，**只看硬规则**。

Run: `node scripts/distill_kb/lint.mjs`
Expected: 硬规则部分全绿（不出现"残留 🧠 / 残留 [[ / 缺 tags / 正文过短"）；降幅项可能有，本轮忽略。

- [ ] **Step 6: Commit 脚本 + 机械清理成果**

```bash
git add scripts/distill_kb/clean_mechanics.mjs scripts/distill_kb/lint.mjs 知识库/
git commit -m "feat(kb-distill): 机械清理 CLI + 全量清理（删🧠整节/转互链/去行内🧠）"
```

---

## Task 4: 批 1 语义重写（5 篇样板）

**目标：** 把署名最密集的 5 篇做掉，作为判断准则样板，做完与用户对齐再推进。

**Files (Modify):**
- `知识库/方法论教程/大神经验与主编讲座精华.md`
- `知识库/拆文案例/拆文方法论合集.md`
- `知识库/拆文案例/世情文拆文合集.md`
- `知识库/拆文案例/其他题材拆文合集.md`
- `知识库/创作须知/上架审核与投稿运营.md`

- [ ] **Step 1: 逐篇 Read + 按"语义重写统一规则"用 Edit/Write 改写**

对每篇执行：Read 全文 → 找出所有人物署名/头衔/采访人引用 → 按规则改写为无主语陈述 → 保留作品名/平台/数据 → TL;DR 脱敏 → Write 回。

`方法论教程/大神经验与主编讲座精华.md` 的改写范例（已读，作为本批风格基准）：

before（第二节"心态"）：
```
**血红**（坚持论）：「现在网络创作环境不好，但既然投入了就努力坚持。当年遭受攻击我就是坚持下来的——如果没有面对攻击批评的心态和耐力，干脆别动笔。一开始写书不应针对物质利益，作为爱好坚持。」
**血红**（不跟风）：「尽量不要流俗，永远不要跟风…」
**血红**（平常心）：「不要成天钻营更新、稿费谈判…」
```
after：
```
**坚持**：网络创作环境虽不好，但既然投入就应坚持。扛住攻击批评的心态与耐力是动笔的前提——没有就干脆别动笔；初期不应针对物质利益，当作爱好坚持。
**不跟风**：尽量不流俗、永远不跟风、不跟着别人走。跟风很难出优秀作品，应让作品有特点。
**平常心**：不要成天钻营更新、稿费谈判（交给编辑），认真码字即可。
```

before（第三节"创作习惯"表格）：
```
| 大神 | 习惯 |
| **血红** | 不写大纲、不构思，随手流出来的就是文字…码字 6500-7500/时…醉酒时写酣畅淋漓的打斗… |
```
after（整表重构成知识列表，删"大神"列）：
```
- **灵感流写法（特例）**：不写大纲、不构思，随手流出文字；码字 6500–7500 字/时；人物原型取自自身潜在性格；醉酒时写酣畅淋漓的打斗。属天才型/灵感型，绝大多数作者仍需大纲，新人不宜模仿。
```

TL;DR 脱敏 before：`起点主编、血红、失落叶、月关、跳舞等大神与编辑的实战经验精华` → after：`资深网文作者与编辑的实战经验精华`。

其余 4 篇：Read 后按同一规则处理（拆文合集多为"某文拆解"，注意保留被拆作品名作案例、删作者署名；上架审核运营含"血红说/主编说"等引语，转客观陈述）。

- [ ] **Step 2: 跑 lint**

Run: `node scripts/distill_kb/lint.mjs`
Expected: 硬规则全绿。字数降幅若超 40%（访谈类删署名正常）→ 人工确认是预期删减而非误删。

- [ ] **Step 3: Commit 批 1**

```bash
git add 知识库/
git commit -m "feat(kb-distill): 批1语义重写（方法论教程+拆文案例3+上架运营）"
```

- [ ] **Step 4: 暂停与用户对齐**

把批 1 的 5 篇改动（尤其方法论教程那篇）展示给用户，确认判断准则（哪些作品名留、哪些署名删、陈述风格）符合预期，再推进批 2–5。**这是 design 约定的对齐 checkpoint。**

---

## Task 5: 批 2 人设档案（27 篇）

**Files (Modify):** `知识库/人设档案/*.md`（27 篇）

清单（来自 `kb_index.md`）：
- 定义型人设 21 篇：反差萌 / 傲娇毒舌 / 咸鱼 / 小太阳 / 斯文败类 / 沙雕 / 温润如玉 / 病娇 / 白切黑 / 白莲花 / 绿茶 / 美强惨 / 腹黑心机 / 软萌小白兔 / 锦鲤 / 阴冷孤僻 / 霸道强势 / 风流不羁 / 高冷禁欲 / 高岭之花 / 鲜衣怒马少年郎
- 访谈型 3 篇：给美强惨人物做访谈 / 给咸鱼人设做采访 / 给绿茶人物做访谈
- 塑造法型 2 篇：三步塑造高岭之花 / 三步塑造外冷内热的冰山男
- 集合型 1 篇：短篇小说——热门人设

- [ ] **Step 1: 逐篇 Read + 按"语义重写统一规则"改写**

重点：
- **访谈型 3 篇**：本质是"采访人物模板"，把"采访人/受访者"等角色名脱敏成中性（"提问/回答"或"设定访谈"），保留访谈技法本身。
- **定义型人设**：若正文里举例用了某部作品的角色名（如"像 X 剧的 Y"），作品名/角色名作案例锚点可留；若是"某作者写的 Z"则去作者留角色。
- 塑造法/集合型：同规则。

- [ ] **Step 2: 跑 lint**

Run: `node scripts/distill_kb/lint.mjs`
Expected: 硬规则全绿；降幅超 40% 项人工确认。

- [ ] **Step 3: Commit 批 2**

```bash
git add 知识库/
git commit -m "feat(kb-distill): 批2人设档案27篇语义重写"
```

---

## Task 6: 批 3 创作须知剩余（14 篇）

**Files (Modify):** `知识库/创作须知/*.md` 除"上架审核与投稿运营"（批 1 已做）外 14 篇

清单：网文入门与签约指南 / 书名与简介 / 叙述术语与工具 / 设定三技人物世界观金手指 / 情节伏笔铺垫节奏 / 描写技法大全 / 对话描写技法 / 文笔与文采 / 人称视角与语境 / 爽点设计全解 / 情色描写技法与过审底线 / 后宫文写作 / 女频言情创作 / 深度单行本补遗

- [ ] **Step 1: 逐篇 Read + 按"语义重写统一规则"改写**

重点：多为技法教程，署名较少；主要处理散落的"XX 说"/引语 + 机械清理后的残留检查。

- [ ] **Step 2: 跑 lint + Commit**

Run: `node scripts/distill_kb/lint.mjs` → 全绿后：

```bash
git add 知识库/
git commit -m "feat(kb-distill): 批3创作须知14篇语义重写"
```

---

## Task 7: 批 4 公式模板（16 篇）

**Files (Modify):** `知识库/公式模板/*.md`（16 篇）

清单：短篇写作公式×11（甜宠/虐/虐点/复仇/世情虐渣打脸/悬疑/替身/破镜重圆/脑洞甜/权谋/追妻火葬场）+ 小说大纲写作总集 + 大纲范例集锦 + 爽文套路库 + 打斗七公式 + 拆文模板

- [ ] **Step 1: 逐篇 Read + 按"语义重写统一规则"改写**

重点：公式/大纲类署名极少；主要处理"大纲范例集锦"等若引用了具体作品作范例（作品名作案例留）。

- [ ] **Step 2: 跑 lint + Commit**

Run: `node scripts/distill_kb/lint.mjs` → 全绿后：

```bash
git add 知识库/
git commit -m "feat(kb-distill): 批4公式模板16篇语义重写"
```

---

## Task 8: 批 5 词汇素材库（1 篇）

**Files (Modify):** `知识库/词汇素材库/人物描写综合词库.md`

- [ ] **Step 1: Read + 按"语义重写统一规则"改写**

重点：词库类，几乎无署名；机械清理（Task 3）应已删🧠小节+转互链，本步主要确认无残留 + 少量引语脱敏。

- [ ] **Step 2: 跑 lint + Commit**

Run: `node scripts/distill_kb/lint.mjs` → 全绿后：

```bash
git add 知识库/
git commit -m "feat(kb-distill): 批5词汇素材库语义重写"
```

---

## Task 9: 收尾验证

- [ ] **Step 1: 全量 lint 终检**

Run: `node scripts/distill_kb/lint.mjs`
Expected: `checked 63 files.` + `✅ all good.`（硬规则全绿；降幅项均已人工确认）。

- [ ] **Step 2: 验证 KnowledgeService 仍能解析（启动 server 或跑相关单测）**

Run: `pnpm --dir server test -- knowledge 2>&1 | tail -20`（若有 knowledge 单测）；否则：

Run: `pnpm --dir server typecheck`
Expected: 通过（未改 server 代码，仅确认未误碰）。

若想真实验证扫描：`pnpm --dir server start:dev` 启动后 `curl localhost:3001/knowledge`（需带 JWT），看 list 正常返回 63 篇 + tags/description 解析正常。

- [ ] **Step 3: 检查 meta 文件（整理规范/kb_index/_stats）**

Run: `grep -l '🧠\|\[\[' 知识库/*.md` （顶层 meta 文件）
Expected: 若有残留（kb_index 等可能含 `[[ ]]` 作内部导航），按"meta 性质最小脱敏"判断 —— kb_index.md 里的 `[文件名](路径)` 是 markdown 链接非 `[[ ]]` 互链，保留；只在确有 `[[ ]]` 时转 `《》`。

- [ ] **Step 4: 删除一次性脚本（可选 —— 保留也无害，不进 build）**

```bash
# 保留脚本以便复查 / 未来重跑；如确要删：
# rm -rf scripts/distill_kb
```

默认保留（spec 约定脚本是一次性工具，跑完即可，不进 CI）。

- [ ] **Step 5: 最终 Commit（若 Step 3 改了 meta）**

```bash
git add 知识库/
git commit -m "chore(kb-distill): 收尾 meta 最小脱敏 + 终检"
```

---

## Self-Review

**Spec coverage：**
- 删人物署名/头衔 → Task 4–8（批 1–5 全覆盖）✓
- 删末尾🧠整节 → Task 2 `stripThinkSection` + Task 3 全量跑 ✓
- 行内🧠去标记 → Task 2 `unwrapInlineThink` + Task 3 ✓
- 互链软化 → Task 2 `softenWikiLinks` + Task 3 ✓
- 保留 tags/TL;DR/作品案例 → "语义重写统一规则" + Task 9 lint 验 tags ✓
- 原地覆盖、分批、git 回滚 → Task 1 备份 + 每批 commit ✓
- lint 校验（无🧠/无互链/tags在/非空/降幅≤40%）→ Task 2 `checkRules` + Task 3 lint CLI ✓
- KnowledgeService 不破 → Task 9 Step 2 验证 ✓
- 批 1 对齐 checkpoint → Task 4 Step 4 ✓

**Placeholder scan：** 无 TBD/TODO；脚本代码完整；语义重写给了确切 before/after 范例 + 每批文件清单 ✓

**Type consistency：** 纯函数名 `stripThinkSection`/`unwrapInlineThink`/`softenWikiLinks`/`processContent`/`wordCount`/`checkRules` 在 lib/test/cli 中一致 ✓
