# Benchmark Search Tools Redesign

**Date:** 2026-07-14
**Status:** Design approved, pending implementation plan
**Scope:** `server/src/agentos/` (writing-agent tool layer only; DISSECT_TREE and FE untouched)

## 背景

写作 agent 当前**只有一个**对标访问入口 `get_benchmark` ([get-benchmark.tool.ts](../../../server/src/agentos/tools/get-benchmark.tool.ts)),它同时承担了「列书 / 搜书 / 拉条目」三件事,导致几个硬伤:

1. **没有按书名过滤的能力。** `bookTitle` 不是 schema 字段,agent 想找《XXX》这本书时,只能把整本书名当 `query` 传。但 `query` 的语义是「条目标题/正文关键词模糊匹配」([L40-41](../../../server/src/agentos/tools/get-benchmark.tool.ts#L40)),而 `BenchmarkEntry.title/content` 不会包含整本书名 → 全部过滤光。
2. **没有「列出拆解书」的能力。** agent 不知道当前用户名下有几本拆解书、各书拆解到什么状态。
3. **没有单书深度钻取入口。** 跨书聚合 + 默认 `take: 10`,单书条目容易被截断或被其他书稀释。

**真实复现案例**(2026-07-14 用户反馈):用户已成功拆解《我的超能力每周刷新》,写作时让 agent 查对标,agent 调用 `get_benchmark({ query: "我的超能力每周刷新", limit: 20 })` 返回 `{ entries: [] }`,因为书名匹配不到任何条目的 title/content。

## 设计目标

把单一工具拆成 **3 个职责清晰的工具**,形成「**列 → 选 → 搜**」的层次,让 agent 有足够多的方式访问对标库:

```
T1 list_benchmark_books          列书 — 概览,挑书
T2 get_benchmark_entries         单书钻取 — bookId + type/chapterNo
T3 search_benchmark              跨书搜索 — bookTitle/type/kind/purpose/query
```

T1/T2 是固定路径(先列书单 → 挑一本深挖);T3 是兜底任意维度模糊搜索,也能反向找书(bookTitle 模糊)。

## 不做(YAGNI 边界)

- **不动 DISSECT_TREE 工具** — `write_benchmark` / `get_dissect_entries` / `get_raw_chapter` / `report_dissect_review` 是拆解内部使用,职责不同。
- **不动 `/dissect` 前端 UI** — 拆解页面对标库浏览是另一回事。
- **不在写作 workspace 加对标搜索面板** — 本期只改工具层,prompt 引导 agent 自主调用;FE 集成留待后续。
- **不加全文检索/向量检索** — Prisma `contains` 模糊匹配 + 内存侧 `filterBenchmarkEntries` 已足够当前数据量(单用户百条级)。
- **不改 `BenchmarkEntry` / `BenchmarkBook` 表结构** — 现有 schema 完全够用。
- **不做旧 `get_benchmark` 兼容 alias** — 直接删除替换,新工具完全覆盖旧能力。

## 工具设计

### T1: `list_benchmark_books`

**职责:** 列出当前用户名下所有拆解书,带 metadata 让 agent 判断哪本值得对标。

**Schema:**
```ts
z.object({
  limit: z.number().int().min(1).max(100).optional()
         .describe('最多返回几本书,默认 20'),
})
```

**返回:**
```ts
{
  books: Array<{
    id: string;                       // cuid,用作 T2 的 bookId
    title: string;
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'INTERRUPTED';
    chapterCount: number;             // book.chapters JSON 数组长度
    entryCountByType: Partial<Record<string, number>>; // { CHAPTER:5, PLOT:12, ... }
    updatedAt: string;                // ISO datetime
  }>
}
```

**实现路径:**
1. `prisma.benchmarkBook.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: limit ?? 20 })`
2. 提取 bookIds
3. `prisma.benchmarkEntry.groupBy({ by: ['bookId', 'type'], where: { bookId: { in: bookIds } }, _count: { _all: true } })` — 一次聚合拿全部 (bookId, type, count) 三元组
4. 内存里组装:每本书的 `entryCountByType` 用 groupBy 结果分桶;`chapterCount` 从 `book.chapters`(Json 字段,运行时是 array)取 `.length`(若非数组则 0)
5. 按 `updatedAt desc` 排序返回(与 prisma 排序一致)

**工具 description(给 LLM 看):**
```
列出当前用户名下所有对标拆解书,返回每本书的 id、标题、拆解状态、章数、各拆解维度(PLOT/RHYTHM/EMOTION/CHARACTER/STYLE/MATERIAL/CHAPTER)的条目数。写作时动笔前先调一次,确认对标库有哪些可用。
```

---

### T2: `get_benchmark_entries`

**职责:** 单书深度钻取,按 type/chapterNo 过滤。

**Schema:**
```ts
z.object({
  bookId: z.string().describe('对标书 id(来自 list_benchmark_books 的返回)'),
  type: z.enum(BENCHMARK_TYPES).optional().describe('按拆解维度过滤'),
  chapterNo: z.number().int().nullable().optional()
              .describe('按章节号过滤(仅 CHAPTER/PLOT 等带章节的条目)'),
  limit: z.number().int().min(1).max(100).optional().describe('默认 30'),
})
```

**返回:**
```ts
{
  entries: Array<{
    type: string;
    title: string;
    content: string;        // 截断到 600 字符
    chapterNo: number | null;
    kind: string | null;
    purposes: string[];
  }>
}
```

**bookId 归属校验(安全关键):**
- 先 `prisma.benchmarkBook.findUnique({ where: { id: bookId } })`
- 若 book 不存在 **或** `book.userId !== d.userId` → 返回 `{ entries: [], error: 'book_not_found' }`
- **不抛异常,不区分「不存在」与「不属于你」** — 避免向 LLM 泄露其他用户书的存在性

**实现路径:**
1. 归属校验(上述)
2. `prisma.benchmarkEntry.findMany({ where: { bookId, type?, chapterNo? }, orderBy: { order: 'asc' }, take: limit ?? 30 })`
3. content `.slice(0, 600)`

**工具 description:**
```
单书深挖:按 type/chapterNo 过滤某一本对标书的拆解条目。bookId 必须来自 list_benchmark_books 的返回。典型场景:看这本书的所有 STYLE 条目,或看第 3 章的 PLOT。
```

---

### T3: `search_benchmark`

**职责:** 跨书模糊搜索,支持按书名 / type / kind / purpose / 关键词任意组合。

**Schema:**
```ts
z.object({
  bookTitle: z.string().optional()
              .describe('书名模糊匹配(大小写不敏感),如"超能力"可匹配《我的超能力每周刷新》'),
  type: z.enum(BENCHMARK_TYPES).optional(),
  kind: z.enum(MATERIAL_KINDS).optional()
          .describe('仅 MATERIAL:按素材种类(梗|名场面|金句|套路)过滤'),
  purpose: z.enum(MATERIAL_PURPOSES).optional()
             .describe('仅 MATERIAL:用途标签(开篇钩子|爽点|反转|...)'),
  query: z.string().optional()
          .describe('条目标题/正文关键词(内存侧模糊匹配)'),
  limit: z.number().int().min(1).max(50).optional().describe('默认 10'),
})
```

**返回:**
```ts
{
  entries: Array<{
    book: string;           // 书名(来自 BenchmarkBook.title)
    type: string;
    title: string;
    content: string;        // 截断到 600 字符
    chapterNo: number | null;
    kind: string | null;
    purposes: string[];
  }>
}
```

**实现路径:**
1. `prisma.benchmarkBook.findMany({ where: { userId: d.userId, ...(bookTitle ? { title: { contains: bookTitle, mode: 'insensitive' } } : {}) } })` — 拿 bookIds + 构建 `bookIdToTitle` Map
2. 若 bookIds 为空 → 直接返回 `{ entries: [] }`(用户名下无书或 bookTitle 无匹配)
3. `prisma.benchmarkEntry.findMany({ where: { bookId: { in: bookIds }, ...(type ? { type } : {}) }, orderBy: { order: 'asc' }, take: (limit ?? 10) * 3 })` — take 放大,因为内存侧还会过滤
4. 复用纯函数 `filterBenchmarkEntries(entries, { kind, purpose, query })` 做内存侧过滤(从旧 `get-benchmark.tool.ts` 迁移)
5. 截取前 `limit ?? 10` 条
6. 每条 entry 的 `book` 字段从 `bookIdToTitle` 映射回来

**工具 description:**
```
跨书搜索对标库条目,支持书名模糊 / 拆解维度 / 素材种类 / 用途 / 关键词任意组合。书名匹配用 bookTitle(如"超能力"),条目内容关键词用 query。典型场景:找所有书里"反转"类型的素材 → type=MATERIAL & purpose=反转。
```

---

## AGENT_TREE 变更

文件:[agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts)

| Agent | 旧 tools 数 | 新 tools 数 | 移除 | 新增 |
|---|---|---|---|---|
| `main` | 36 | 38 | `get_benchmark` | `list_benchmark_books`, `get_benchmark_entries`, `search_benchmark` |
| `writer` | 21 | 23 | `get_benchmark` | 同上 |

**其他 agent 不变。** `chapter`/`settler`/`validator`/`curator`/critics 不需要直接访问对标库(对标数据由 main/writer 在 contextAssembler 层或主动调用时拉取)。

## Prompt 变更

文件:[prompts/main.md](../../../server/src/agentos/prompts/main.md) L104-112 与 [prompts/writer.md](../../../server/src/agentos/prompts/writer.md) L128-137 的【按需对标参考】节同步重写。新文案:

```
【按需对标参考】
你可用三个工具从对标库(其他小说的拆解产物)取参考:
- list_benchmark_books() — 列出当前用户名下所有拆解书,看每本书的状态和各维度条目数。**动笔前先调一次**,确认对标库有什么。
- get_benchmark_entries(bookId, type?, chapterNo?) — 单书深挖某维度。bookId 必须来自 list_benchmark_books。典型:看这本书的所有 STYLE,或看第 3 章的 PLOT。
- search_benchmark(bookTitle?, type?, kind?, purpose?, query?) — 跨书搜索。书名模糊匹配用 bookTitle(如"超能力"),条目标题/正文关键词用 query。

写作场景参考:
- 写大纲/分卷 → get_benchmark_entries(bookId, type: PLOT 或 RHYTHM 或 EMOTION)
- 写正文 → get_benchmark_entries(bookId, type: STYLE 或 RHYTHM)
- 建角色 → get_benchmark_entries(bookId, type: CHARACTER)
- 写具体场景(开篇/爽点/反转/低谷)→ search_benchmark(type: MATERIAL, purpose: <对应标签>)

对标是参考不是照抄,产物不进入本小说设定表。无对标书时跳过此节。
```

## 数据流示例

```
场景 A:agent 想知道对标库有什么
  → list_benchmark_books()
  → 看到 3 本书,挑一本 status=DONE 且 entryCountByType.PLOT 较多的
  → get_benchmark_entries(bookId=xxx, type: PLOT)

场景 B:用户在 prompt 里提了"我想像《超能力》那样"
  → search_benchmark(bookTitle: "超能力")
  → 跨书模糊匹配书名,返回该书的全部条目(各 type 混排)

场景 C:写正文时想找"反转"素材
  → search_benchmark(type: MATERIAL, purpose: '反转')
  → 跨所有书找反转素材

场景 D:看对标书的第 5 章是怎么写的
  → get_benchmark_entries(bookId=xxx, chapterNo: 5)
```

## 错误处理矩阵

| 工具 | 场景 | 返回 |
|---|---|---|
| T1 | 用户名下无书 | `{ books: [] }` |
| T1 | groupBy 失败(异常) | 工具异常上抛(langgraph 捕获) |
| T2 | bookId 不存在 | `{ entries: [], error: 'book_not_found' }` |
| T2 | bookId 属于他人 | `{ entries: [], error: 'book_not_found' }`(不区分,不泄露存在性) |
| T2 | type/chapterNo 过滤后无条目 | `{ entries: [] }` |
| T3 | bookTitle 模糊无匹配 | `{ entries: [] }` |
| T3 | type 过滤后无条目 | `{ entries: [] }` |
| T3 | kind/purpose/query 内存过滤掉所有 | `{ entries: [] }` |

## BenchmarkService 扩展

为了保持工具层薄、归属校验单点集中,在 [BenchmarkService](../../../server/src/benchmark/benchmark.service.ts) 新增 3 个方法:

```ts
/** T1 用:列出用户名下所有书 + 各 type 条目数聚合 */
async listBooksWithEntryCounts(userId: string, limit: number = 20): Promise<
  Array<{
    id: string;
    title: string;
    status: string;
    chapterCount: number;
    entryCountByType: Record<string, number>;
    updatedAt: Date;
  }>
>

/** T2 用:带归属校验的单书钻取(book 不存在或非本人 → 返回 null) */
async findEntriesForUser(
  userId: string,
  bookId: string,
  opts: { type?: string; chapterNo?: number | null; limit?: number },
): Promise<{ entries: BenchmarkEntry[] } | { error: 'book_not_found' }>

/** T3 用:跨书搜索(已带 userId 隔离) */
async searchEntries(
  userId: string,
  opts: {
    bookTitle?: string;
    type?: string;
    kind?: string;
    purpose?: string;
    query?: string;
    limit?: number;
  },
): Promise<Array<{ entry: BenchmarkEntry; bookTitle: string }>>
```

工具层只负责 schema 定义、参数透传、返回形态组装;所有 Prisma 查询和归属校验走 service。

## 测试策略

### 新建 3 个工具 spec

参照 [list-chapters.tool.spec.ts](../../../server/src/agentos/tools/list-chapters.tool.spec.ts) 的风格(构造 mock service → 调 `t.invoke(...)` → 断言 mock 调用参数 + 返回结构)。

**`list-benchmark-books.tool.spec.ts`:**
- empty 库 → `{ books: [] }`
- 多本书的 `entryCountByType` 聚合正确
- `chapterCount` 从 `chapters` JSON 数组长度取
- limit 参数透传
- 闭包绑定 userId,不读 input

**`get-benchmark-entries.tool.spec.ts`:**
- bookId 不存在 → `{ entries: [], error: 'book_not_found' }`
- bookId 属于他人 → 同上(归属校验,不泄露存在性)
- 正常返回:type/chapterNo 过滤正确,content 截断到 600
- limit 透传

**`search-benchmark.tool.spec.ts`:**
- 复用从旧文件迁移的纯函数 `filterBenchmarkEntries`(原 5 个 case 全保留)
- bookTitle 模糊匹配(含大小写不敏感)
- 跨书聚合正确
- query 内存过滤
- 闭包绑定 userId

### BenchmarkService 扩展 spec

在 [benchmark.service.spec.ts](../../../server/src/benchmark/benchmark.service.spec.ts)(若不存在则新建)增加:
- `listBooksWithEntryCounts` 的 groupBy 聚合
- `findEntriesForUser` 的归属校验(他人书 → error)
- `searchEntries` 的 bookTitle contains + mode insensitive

### 集成测试更新

- **`agent-tree.config.spec.ts`** — 现有断言 `"main/writer 都能拉对标(get_benchmark)"`(L292)替换为对 3 个新工具的断言;main/writer 的完整 tools 列表断言更新。
- **`agent-prompts.spec.ts`** — main.md 的【按需对标参考】substring 锁改为新工具名(`list_benchmark_books` 等)。

### 删除的旧 spec

- `get-benchmark.tool.spec.ts` 删除(其 `filterBenchmarkEntries` 用例迁移到 `search-benchmark.tool.spec.ts`)。

## 实现顺序(给 writing-plans 参考)

1. `BenchmarkService` 新增 3 个方法 + 单测
2. 新建 `list-benchmark-books.tool.ts` + spec
3. 新建 `get-benchmark-entries.tool.ts` + spec(含归属校验路径)
4. 新建 `search-benchmark.tool.ts` + spec(迁移 `filterBenchmarkEntries`)
5. 更新 `agent-registry.ts`:删 `get_benchmark` 注册,加 3 个新注册(注意 deps 注入:`{ userId, prisma }` → `{ userId, benchmark }`,因为新工具走 service)
6. 更新 `agent-tree.config.ts`:main/writer tools 替换
7. 更新 `agent-tree.config.spec.ts` 断言
8. 更新 `prompts/main.md` + `prompts/writer.md`
9. 更新 `agent-prompts.spec.ts` 断言
10. 删除 `get-benchmark.tool.ts` + `get-benchmark.tool.spec.ts`
11. `pnpm test` + `pnpm typecheck` 全绿

## 影响范围清单

**新增文件:**
- `server/src/agentos/tools/list-benchmark-books.tool.ts`
- `server/src/agentos/tools/get-benchmark-entries.tool.ts`
- `server/src/agentos/tools/search-benchmark.tool.ts`
- 对应 3 个 `.spec.ts`

**修改文件:**
- `server/src/benchmark/benchmark.service.ts`(3 个新方法)
- `server/src/benchmark/benchmark.service.spec.ts`(若不存在则新建)
- `server/src/agentos/agent-registry.ts`(工具注册)
- `server/src/agentos/agent-tree.config.ts`(AGENT_TREE main/writer tools)
- `server/src/agentos/agent-tree.config.spec.ts`(断言)
- `server/src/agentos/prompts/main.md`(【按需对标参考】节)
- `server/src/agentos/prompts/writer.md`(同上)
- `server/src/agentos/agent-prompts.spec.ts`(substring 断言)

**删除文件:**
- `server/src/agentos/tools/get-benchmark.tool.ts`
- `server/src/agentos/tools/get-benchmark.tool.spec.ts`

**不动:**
- DISSECT_TREE 相关工具(write_benchmark / get_dissect_entries / get_raw_chapter / report_dissect_review)
- Prisma schema(`BenchmarkBook` / `BenchmarkEntry` 表结构)
- 前端(`agent-ui/`)

## Open Questions

无。设计已收敛。Brainstorming 阶段确认的三个 trade-off:
- T2 入参用 `bookId`(精确无歧义,符合 T1→T2 层次)
- T3 返回扁平 entries(简单,与旧 `get_benchmark` 形态一致)
- 旧 `get_benchmark` 直接删除替换(无兼容 alias)
