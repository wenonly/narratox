# 提示词迁到 Markdown(运行时直读)— 实现计划

> spec: [2026-06-30-prompts-to-markdown-design.md](../specs/2026-06-30-prompts-to-markdown-design.md)

**目标:** 16 个提示词从单文件 `agent-prompts.ts` 拆到 `prompts/*.md`(frontmatter + 纯 body);`agent-prompts.ts` 退成 runtime loader;消费方零改动。

**保真核心:** 用一次性 `.mjs` 脚本从源文本抽取模板字面量真实值写 md(不手抄),再用现有内容断言 + 新增特征子串锁 + 构建验证三层证明逐字一致。

---

## Task 1: 一次性迁移脚本 + 生成 16 个 md

**Files:**
- Create(临时): `server/scripts/extract-prompts.mjs`

- [ ] **Step 1: 写 extract-prompts.mjs**

```js
// 一次性迁移脚本:把 agent-prompts.ts 里 16 个模板字面量常量的【真实运行时值】
// (按 JS 转义语义还原 \` → `)写进 src/agentos/prompts/<slug>.md(frontmatter + 纯 body)。
// 用完即删(迁移后 agent-prompts.ts 变 loader,本脚本不再适用)。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = join(here, '..', 'src', 'agentos', 'agent-prompts.ts');
const outDir = join(here, '..', 'src', 'agentos', 'prompts');
const src = readFileSync(srcPath, 'utf8');

// slug → {const, key?, title, description}
const META = [
  { slug: 'writer', c: 'WRITER_AGENT_PROMPT', key: 'WRITER', t: 'writer · 写作手', d: '工作台写/续/改/重写章节;chapter 编排器的叶子(promptAugment=writer)。' },
  { slug: 'main', c: 'MAIN_AGENT_PROMPT', key: 'MAIN', t: 'main · 交互式编排者', d: '主 agent:一步一停,每步给建议+问作者;委派 5 个编排器。' },
  { slug: 'main-role-reminder', c: 'MAIN_ROLE_REMINDER', t: 'main-role-reminder · 职责提醒', d: '每轮注入主 agent 的精简职责提醒(落历史之后最近处,对冲长对话稀释)。' },
  { slug: 'chapter-orchestrator', c: 'CHAPTER_ORCHESTRATOR_PROMPT', key: 'CHAPTER_ORCH', t: 'chapter · 章节编排', d: 'chapter 编排子 agent:聚焦上下文跑完 写→结算→校验(+修订)。' },
  { slug: 'settler', c: 'SETTLER_AGENT_PROMPT', key: 'SETTLER', t: 'settler · 结算手', d: '结算章节(摘要/角色/物品/伏笔/事件)。' },
  { slug: 'validator', c: 'VALIDATOR_AGENT_PROMPT', key: 'VALIDATOR', t: 'validator · 质检员', d: '12 维结构化审计(promptAugment=validator,拼作者画像校验切片)。' },
  { slug: 'curator', c: 'CURATOR_AGENT_PROMPT', key: 'CURATOR', t: 'curator · 参考资料策划', d: '立项时从全局 KB 提炼本书专属参考资料 + 为受益 agent 生成专属精要。' },
  { slug: 'worldbuilder-orchestrator', c: 'WORLDBUILDER_ORCHESTRATOR_PROMPT', key: 'WB_ORCH', t: 'worldbuilder · 世界观编排', d: '取KB→建条目→评审(+修订) 全流程。' },
  { slug: 'worldbuilder-writer', c: 'WORLDBUILDER_WRITER_PROMPT', key: 'WB_WRITER', t: 'wb-writer · 世界观构建手', d: '从 KB 取设定方法论后建/改世界观条目。' },
  { slug: 'worldbuilder-critic', c: 'WORLDBUILDER_CRITIC_PROMPT', key: 'WB_CRITIC', t: 'wb-critic · 世界观质检员', d: '6 维 KB-grounded 评审。' },
  { slug: 'outliner-orchestrator', c: 'OUTLINER_ORCHESTRATOR_PROMPT', key: 'OUTLINER_ORCH', t: 'outliner · 大纲编排', d: '建纲/补细纲/改写细纲 全流程。' },
  { slug: 'outline-writer', c: 'OUTLINE_WRITER_PROMPT', key: 'OUTLINE_WRITER', t: 'outline-writer · 大纲构建手', d: '取KB方法论后立总纲→分卷→分弧→建细纲。' },
  { slug: 'outline-critic', c: 'OUTLINE_CRITIC_PROMPT', key: 'OUTLINE_CRITIC', t: 'outline-critic · 大纲质检员', d: '6 维评审 + 总纲自检。' },
  { slug: 'character-orchestrator', c: 'CHARACTER_ORCHESTRATOR_PROMPT', key: 'CHAR_ORCH', t: 'character · 角色编排', d: '取KB→建档案→评审(+修订) 全流程。' },
  { slug: 'character-writer', c: 'CHARACTER_WRITER_PROMPT', key: 'CHAR_WRITER', t: 'char-writer · 角色构建手', d: '从 KB 取人物方法论后建/改角色档案。' },
  { slug: 'character-critic', c: 'CHARACTER_CRITIC_PROMPT', key: 'CHAR_CRITIC', t: 'char-critic · 角色质检员', d: '6 维评审。' },
];

// 从源文本抽取某 const 的模板字面量真实值(扫描器:遇 \ 取下一字符字面量;遇未转义 ` 停)。
function extractBody(constName) {
  const startRe = new RegExp(`export const ${constName} = \\\``);
  const m = src.match(startRe);
  if (!m) throw new Error(`未找到 const ${constName}`);
  const start = m.index + m[0].length;
  let out = '';
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += src[i + 1] ?? ''; i++; continue; }
    if (c === '`') return out;
    out += c;
  }
  throw new Error(`${constName}: 未找到闭合反引号`);
}

mkdirSync(outDir, { recursive: true });
for (const { slug, c, key, t, d } of META) {
  const body = extractBody(c);
  const fm = ['---', `name: ${c}`, ...(key ? [`key: ${key}`] : []), `title: ${t}`, `description: ${d}`, '---', '', body, ''].join('\n');
  writeFileSync(join(outDir, `${slug}.md`), fm, 'utf8');
  console.log(`✓ ${slug}.md (${body.length} chars)`);
}
console.log(`done: ${META.length} files → ${outDir}`);
```

- [ ] **Step 2: 先确认源里只有 \` 转义(扫描器正确性前提)**

Run: `grep -n '\\\\' server/src/agentos/agent-prompts.ts`
Expected: 只出现 `` \` ``(反引号转义);无裸 `\\` 或其它。若发现其它转义,扫描器语义仍正确(遇 \ 取下一字面量),无需改。

- [ ] **Step 3: 运行脚本**

Run: `node server/scripts/extract-prompts.mjs`
Expected: 打印 16 行 `✓ <slug>.md (N chars)`,末尾 `done: 16 files`。

- [ ] **Step 4: 抽查 1 个 md 与原 TS 逐字一致**

抽 `writer.md`:body 开头应是「你是一位小说写作手…」,含「【写前必读 step 0 — 动笔前一次性把上下文读齐】」;原 TS 里 `` \`- 名称:\` `` 类内联反引号在 md 里应是单反引号。人工对一眼。

---

## Task 2: README.md

**Files:**
- Create: `server/src/agentos/prompts/README.md`

- [ ] **Step 1: 写 README**

内容:agent 树示意(main → chapter/writer/settler/validator + curator + worldbuilder/wb-writer/wb-critic + outliner/… + character/…)+ 16 个 prompt 一行表(slug / 角色 / key / 一句话)+ 「如何编辑:改 md → 重启 dev(nest watch 重编译 + watchAssets 重复制)」+ 「frontmatter 仅给人看,loader 只取 body」。

---

## Task 3: agent-prompts.ts 重写为 loader

**Files:**
- Modify(整体替换): `server/src/agentos/agent-prompts.ts`

- [ ] **Step 1: 整体替换为 loader**(见 spec 的 Loader 设计块)

要点:`import { readFileSync } from 'node:fs'` + `join(__dirname,'prompts',\`${slug}.md\`)`;`load(slug)` 剥 frontmatter(正则 `^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$`)+ 裁头尾空白;16 个同名 `export const`;读失败抛清晰错误。

- [ ] **Step 2: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 干净(loader 类型简单)。

---

## Task 4: nest-cli.json 加 assets

**Files:**
- Modify: `server/nest-cli.json`

- [ ] **Step 1: 加 assets + watchAssets**

```jsonc
"assets": ["agentos/prompts/**/*.md"],
"watchAssets": true
```

- [ ] **Step 2: 构建验证 md 进了 dist**

Run: `pnpm --dir server build && ls server/dist/agentos/prompts/ | wc -l`
Expected: `16`(README 不在 glob 里,只 16 个 prompt md)。

- [ ] **Step 3: 回退预案**(仅当 Step 2 ≠ 16)

把 glob 改显式 `"src/agentos/prompts/**/*.md"` 重 build 再 ls。仍不行 → 查 nest CLI 版本对 sourceRoot 相对 glob 的解析。

---

## Task 5: agent-prompts.spec.ts

**Files:**
- Create: `server/src/agentos/agent-prompts.spec.ts`

- [ ] **Step 1: 写 spec**

断言:
1. 16 常量都是非空字符串。
2. body 不泄漏 frontmatter:`startsWith('---')` 全 false;`MAIN_AGENT_PROMPT.startsWith('你是')` true;`WRITER_AGENT_PROMPT.startsWith('你是一位')` true。
3. 每个 prompt 锁一个特征子串(独特、不日常改动):
   - WRITER 含「【写前必读 step 0 — 动笔前一次性把上下文读齐】」
   - MAIN 含「你是【交互式编排者】」
   - MAIN_ROLE_REMINDER 含「每轮【只做一件事】」
   - CHAPTER_ORCH 含「写→结算→校验」
   - SETTLER 含「每个必标 payoffTiming」
   - VALIDATOR 含「细纲兑现」
   - CURATOR 含「按需索引」
   - WB_ORCH 含「取KB→建条目→评审」
   - WB_WRITER 含「力量体系/金手指 — 遵循 KB 五字诀」
   - WB_CRITIC 含「report_worldview_review」
   - OUTLINER_ORCH 含「改写细纲(因正文偏离)」
   - OUTLINE_WRITER 含「立总纲(全书北极星」
   - OUTLINE_CRITIC 含「report_outline_review」
   - CHAR_ORCH 含「取KB→建档案→评审」
   - CHAR_WRITER 含「弧光目标 arcGoal」
   - CHAR_CRITIC 含「report_character_review」
4. `PROMPTS` 的 key 集合 == `AGENT_TREE` 所有 `promptKey` 集合(用 `collectSpecs`)。

- [ ] **Step 2: 跑全量测试**

Run: `pnpm --dir server test`
Expected: 全绿(现有 345 + 新增 agent-prompts.spec)。**这是迁移逐字保真的主证据**(context-assembler 断 MAIN 子串、agent-tree 断结构都会验证 loader)。

---

## Task 6: 删迁移脚本 + 提交 + CLAUDE.md

- [ ] **Step 1: 删一次性脚本**

`rm server/scripts/extract-prompts.mjs`

- [ ] **Step 2: typecheck + build 收尾**

`pnpm --dir server typecheck && pnpm --dir server build` 全过。

- [ ] **Step 3: 提交**

```
refactor(prompts): 16 个提示词迁 prompts/*.md(运行时直读)

agent-prompts.ts 退成 runtime loader(fs.readFileSync + 剥 frontmatter),
16 个同名 export 不变 → agent-tree.config/context-assembler/deep-agent 零改动。
nest-cli 加 assets+watchAssets 把 md 复制到 dist。零 npm script 改动。
迁移用一次性脚本按 JS 转义语义抽真实值写 md,现有测试 + 新增 spec 锁特征子串
三层证明逐字保真。
```

- [ ] **Step 4: CLAUDE.md 记一笔**(agentos 段:prompts 现在是 md,改 md 后重启 dev)
