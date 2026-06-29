# 提示词迁到 Markdown 文件(运行时直读)— 设计

## 目标

把目前全仓改动最频繁的 [agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts)(单文件 498 行 / 16 个 `export const` 字符串)拆成 `prompts/*.md`——每文件一个 agent,带 YAML frontmatter 自描述,body 即 LLM 收到的提示词。让作者能像读文档一样浏览/编辑提示词。

## 现状

- `agent-prompts.ts` 导出 16 个常量:15 个进 [agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) 的 `PROMPTS` map(按 `promptKey` 取),`MAIN_ROLE_REMINDER` 单独注入。
- **消费方只有 3 个文件**:
  - [context-assembler.service.ts](../../../server/src/agentos/context-assembler.service.ts):`import { MAIN_AGENT_PROMPT }`
  - [agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts):`import * as P`(组 `PROMPTS` map)
  - [deep-agent.service.ts](../../../server/src/agentos/deep-agent.service.ts):`import { MAIN_ROLE_REMINDER }`
- 测试:`context-assembler.service.spec.ts` 断言 MAIN 的若干子串;`agent-tree.config.spec.ts` 断言每个 `promptKey` 都在 `PROMPTS` 里。

## 方案:运行时直读 md(已选定)

md 是**唯一源**。`agent-prompts.ts` 退成一个轻量 loader:模块加载时 `fs.readFileSync(join(__dirname,'prompts','<slug>.md'))` 读出,剥掉 frontmatter,导出**同名常量**。消费方零改动。

为什么不选另外两个:
- **codegen**:`@generated` 文件进库 + prebuild/pretest 防漂移——运行时等价但多一个生成物。
- **md 仅作文档镜像**:md 不可编辑(改了没用,得改 ts)、会和 ts 漂移,不满足「重构进 md」本意。

运行时直读的代价是 nest-cli asset 配置;收益是**零 npm script 改动、零中间文件、md 即所见即所得**。

### 三运行时 `__dirname` 正确性(已核实)

tsconfig 是 `module: nodenext` 但 package.json 无 `"type": "module"` → tsc 输出 **CJS**,`__dirname` 全场景可用:

| 运行时 | `__dirname` 解析到 | 读到的 md |
|---|---|---|
| jest(ts-jest,从 src) | `server/src/agentos` | `src/agentos/prompts/*.md` ✓ |
| `nest start --watch`(编译到 dist) | `server/dist/agentos` | `dist/agentos/prompts/*.md`(asset 复制) ✓ |
| prod(`node dist/main`) | `server/dist/agentos` | `dist/agentos/prompts/*.md`(build 复制) ✓ |

## 文件布局

```
server/src/agentos/
├── agent-prompts.ts        # 重写:runtime loader(读 prompts/*.md),同名 export
├── agent-prompts.spec.ts   # 新增:加载不变量 + 逐 prompt 字节保真
└── prompts/
    ├── README.md           # agent 树 + 每个 prompt 一行说明 + 编辑指引
    ├── main.md                       # MAIN_AGENT_PROMPT        (key MAIN)
    ├── main-role-reminder.md         # MAIN_ROLE_REMINDER       (无 key,单独注入)
    ├── chapter-orchestrator.md       # CHAPTER_ORCHESTRATOR_PROMPT (CHAPTER_ORCH)
    ├── writer.md                     # WRITER_AGENT_PROMPT      (WRITER)
    ├── settler.md                    # SETTLER_AGENT_PROMPT     (SETTLER)
    ├── validator.md                  # VALIDATOR_AGENT_PROMPT   (VALIDATOR)
    ├── curator.md                    # CURATOR_AGENT_PROMPT     (CURATOR)
    ├── worldbuilder-orchestrator.md  # WORLDBUILDER_ORCHESTRATOR_PROMPT (WB_ORCH)
    ├── worldbuilder-writer.md        # WORLDBUILDER_WRITER_PROMPT      (WB_WRITER)
    ├── worldbuilder-critic.md        # WORLDBUILDER_CRITIC_PROMPT      (WB_CRITIC)
    ├── outliner-orchestrator.md      # OUTLINER_ORCHESTRATOR_PROMPT    (OUTLINER_ORCH)
    ├── outline-writer.md             # OUTLINE_WRITER_PROMPT           (OUTLINE_WRITER)
    ├── outline-critic.md             # OUTLINE_CRITIC_PROMPT           (OUTLINE_CRITIC)
    ├── character-orchestrator.md     # CHARACTER_ORCHESTRATOR_PROMPT   (CHAR_ORCH)
    ├── character-writer.md           # CHARACTER_WRITER_PROMPT         (CHAR_WRITER)
    └── character-critic.md           # CHARACTER_CRITIC_PROMPT         (CHAR_CRITIC)
```

16 个 prompt md + 1 个 README。

### frontmatter schema

每个 md 顶部一段 frontmatter(只给人看 + 给 loader 的健壮性检查用),紧跟空行后是**纯 body**(LLM 收到的就是这个,逐字等于原常量):

```md
---
name: WRITER_AGENT_PROMPT
key: WRITER
title: writer · 写作手
description: 工作台写/续/改/重写章节;chapter 编排器的叶子 agent(promptAugment=writer)。
---

你是一位小说写作手,在工作台里和作者一起写一本小说的章节。

【写前必读 step 0 — 动笔前一次性把上下文读齐】
...
```

- `name`:导出常量名(给人交叉引用 + spec 校验「所有 const 都有 md」)。
- `key`:AGENT_TREE 里的 `promptKey`;`MAIN_ROLE_REMINDER` 无 key(省略)。
- `title` / `description`:纯人类阅读用;README 由此组织。
- loader **不解析** frontmatter 的字段值,只剥掉 frontmatter 块取 body(见下)。

## Loader 设计(`agent-prompts.ts` 重写)

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, 'prompts');

/**
 * 读 prompts/<slug>.md,剥掉 YAML frontmatter(以 `---` 起始到下一个独立 `---` 行),
 * 返回纯 body。body 头尾空白裁掉(原常量本就无语义性头尾空白)→ 与迁移前逐字一致。
 * 读不到 → 启动即抛(快速失败,信息含 slug 与路径)。
 */
function load(slug: string): string {
  let raw: string;
  try {
    raw = readFileSync(join(DIR, `${slug}.md`), 'utf8');
  } catch (e) {
    throw new Error(`[agent-prompts] 读取 prompts/${slug}.md 失败 (${DIR}): ${e instanceof Error ? e.message : e}`);
  }
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const body = fm ? fm[2] : raw;
  return body.replace(/^\r?\n+/, '').replace(/\s+$/, '');
}

export const WRITER_AGENT_PROMPT = load('writer');
export const MAIN_ROLE_REMINDER = load('main-role-reminder');
export const MAIN_AGENT_PROMPT = load('main');
export const CHAPTER_ORCHESTRATOR_PROMPT = load('chapter-orchestrator');
export const SETTLER_AGENT_PROMPT = load('settler');
export const VALIDATOR_AGENT_PROMPT = load('validator');
export const CURATOR_AGENT_PROMPT = load('curator');
export const WORLDBUILDER_ORCHESTRATOR_PROMPT = load('worldbuilder-orchestrator');
export const WORLDBUILDER_WRITER_PROMPT = load('worldbuilder-writer');
export const WORLDBUILDER_CRITIC_PROMPT = load('worldbuilder-critic');
export const OUTLINER_ORCHESTRATOR_PROMPT = load('outliner-orchestrator');
export const OUTLINE_WRITER_PROMPT = load('outline-writer');
export const OUTLINE_CRITIC_PROMPT = load('outline-critic');
export const CHARACTER_ORCHESTRATOR_PROMPT = load('character-orchestrator');
export const CHARACTER_WRITER_PROMPT = load('character-writer');
export const CHARACTER_CRITIC_PROMPT = load('character-critic');
```

**关键不变量**:
- 导出的 16 个常量**名与类型(字符串)与迁移前完全一致** → `agent-tree.config.ts` 的 `PROMPTS` map、`context-assembler`、`deep-agent` **零改动**。
- body 逐字等于原常量内容(迁移保真见「测试」)。
- frontmatter 剥离用正则 `^---\r?\n...\r?\n---\r?\n`;无 frontmatter 的文件原样返回(向后兼容)。已知 16 个 prompt body 内部均无独立 `---` 行,正则不会误剥。

## `nest-cli.json` 改动

```jsonc
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true },
  "assets": ["agentos/prompts/**/*.md"],
  "watchAssets": true
}
```

- `assets` glob 相对 `sourceRoot`(src) → 复制 `src/agentos/prompts/*.md` 到 `dist/agentos/prompts/*.md`(`src/` 前缀剥除,路径保留)。
- `watchAssets: true`:dev 下 md 变更触发重复制(注意:prompt 在模块加载时读入内存,改 md 后仍需 dev 重启才生效——与改任何模块级常量一致;`watchAssets` 让重启后读到的就是最新)。
- **零 package.json script 改动**(运行时直读无需 prebuild/pretest)。

> 验证门槛:`pnpm --dir server build` 后必须 `ls server/dist/agentos/prompts/` 能看到 16 个 md。glob 写法若不生效(某些 nest CLI 版本对 sourceRoot 相对路径解析有差异),回退用显式 `"src/agentos/prompts/**/*.md"`。实现步骤里有专门验证 + 回退动作。

## 消费方(零改动)

门面保持同名 named exports,三处 import 一字不改:
- `agent-tree.config.ts`:`import * as P` + `PROMPTS` map 原样。
- `context-assembler.service.ts`:`MAIN_AGENT_PROMPT` 原样。
- `deep-agent.service.ts`:`MAIN_ROLE_REMINDER` 原样。

## 测试

1. **现有测试全绿 = 迁移保真的主证据**:
   - `context-assembler.service.spec.ts`:断言 MAIN 含「交互式编排者」「立项中」「update_novel」「settler」等。
   - `agent-tree.config.spec.ts`:断言每个 `promptKey` 都在 `PROMPTS` 里。
   - 这些直接验证 md body 与原常量一致 + loader 正确加载。

2. **新增 `agent-prompts.spec.ts`**:
   - 16 个常量都是非空字符串。
   - body 未泄漏 frontmatter:`expect(WRITER_AGENT_PROMPT.startsWith('---')).toBe(false)`、`expect(MAIN_AGENT_PROMPT.startsWith('你是')).toBe(true)`。
   - 每个 prompt 锁一个**特征子串**(body 里独特、不会日常改动的一句话),逐个核对——迁移逐字保真的硬证据。例:`WRITER` 含「【写前必读 step 0 — 动笔前一次性把上下文读齐】」、`MAIN_ROLE_REMINDER` 含「每轮【只做一件事】」。
   - `PROMPTS` 的 key 集合 == AGENT_TREE 里所有 `promptKey` 集合(防「加了 promptKey 却没建 md」)。

3. **构建 asset 验证**(非 jest,手动一步):`pnpm --dir server build && ls server/dist/agentos/prompts/` 见 16 md。

4. `pnpm --dir server typecheck` 干净。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| nest-cli `assets` glob 在某些版本解析差异 → prod 缺 md → 运行时首读即崩 | 实现里显式 `pnpm build && ls dist/...` 验证;不生效则回退显式 `src/...` glob;loader 缺文件抛清晰错误 |
| 迁移时手抖改了 body → 提示词行为漂移 | 现有内容断言测试 + 新增特征子串锁;body 从原 TS 逐字复制,不做任何改写 |
| frontmatter 正则误剥 body(若某 prompt 含独立 `---` 行) | 已核实 16 个 body 均无 `---` 行;spec 显式断言 `startsWith('---')===false` |
| dev 改 md 不热重载(模块加载时读入内存) | 文档化「改 md 需重启 dev」(同改任何常量);`watchAssets` 保证重启后是最新 |
| `module: nodenext` 下 `__dirname` 可疑 | 已核实 package.json 无 `type:module` → CJS 输出 → `__dirname` 全场景可用;jest 从 src 跑路径也对 |

## 不在本期范围

- 不改任何 prompt **内容**(纯搬迁;PE 优化是上一期的事)。
- 不改 `PROMPTS` map 位置(留 `agent-tree.config.ts`)。
- 不引入 codegen / 不加 npm pre-hook / 不动 package.json scripts。
- 不做 prompt 版本化或 A/B。
- 不改前端(agent-ui 不读这些 md)。
