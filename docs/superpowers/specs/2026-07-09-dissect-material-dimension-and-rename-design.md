# 拆解：素材维度（梗/名场面/金句/套路）+ 用途标签 + 卡片重命名 设计

> 给「拆解小说」加一个新维度 **MATERIAL（可复用素材）**，与现有 6 个分析维度（章节/剧情/节奏/情绪/人物/文风）正交：每张素材卡带 `kind`（素材种类）+ `purposes`（用途标签，固定枚举多值），写作时 agent 按「用途」拉对应素材参考手法。同时给所有拆解卡片加重命名能力（改 `entry.title`）。维度元数据顺手集中成单源，消灭现有 6 维度散落 ~10 处的硬编码。

## 背景

拆解模块（Phase 22）产出的 `BenchmarkEntry` 固定 6 类 `CHAPTER | PLOT | RHYTHM | EMOTION | CHARACTER | STYLE`——这是**分析视角**（这本书怎么运作）。但作者真正想要的是「**可复用素材**」：这本书的梗、名场面、金句、套路是什么，写自己的小说时能不能拿来参考。当前体系两个缺口：

1. **没有「素材」这一类**——梗/金句/名场面被揉进 CHAPTER 摘要或 EMOTION 分析里，没法单独检索复用。
2. **没有「用途」轴**——写作时想「写开篇/爽点/反转」找参考，但现有检索只能按 type + keyword 子串匹配，没法按「这个场景我正需要」精准拉。

此外两个工程问题：

3. **卡片不能改名**——`BenchmarkEntry.title` 由 agent 生成，无任何 `PATCH`/update 路径（全仓 `benchmarkEntry.update` 零命中），agent 起的标题（尤其 CHARACTER 用 canonical 名、PLOT/RHYTHM/EMOTION 用固定标签）作者无法修正。
4. **维度硬编码散落 ~10 处**——Prisma enum、5 个工具的 `z.enum`、FE `BenchmarkEntryType` union、`ENTRY_TYPE_LABEL`、`DIM_COLOR`、`TAB_LIST`、`groupByType` keys、`ReviewView.allDims` + 字面量 `6`。加一个维度要同步改 ~10 处，「漏改第 7 处」是真实 bug 源。

## 目标

- 新增 `MATERIAL` 维度：一张卡 = 一个可复用元素（梗/名场面/金句/套路），一元素一卡。
- 双轴检索：`kind`（素材种类，固定枚举单值）× `purposes`（用途，固定枚举多值），正交。
- 写作时 agent 自动按用途拉素材参考（扩展 `get_benchmark` + 更新 3 个写作 prompt）。
- 卡片重命名：所有维度卡（含 MATERIAL 与现有 6 类）的 `title` 可改，inline 编辑。
- 维度元数据集中单源（方案 2）：加新维度 = 改一处配置。

## 非目标

- ❌ 不加工作台「对标素材」FE 面板——写作时检索只走 agent 工具（已决）。
- ❌ 不重命名对标书标题（`BenchmarkBook.title`）、不改 `kind`/`purposes`（agent 产物，只读；要改走重拆或未来编辑能力）。
- ❌ 不做向量检索/语义 top-K（substring 匹配维持，向量是 deferred 终局方案）。
- ❌ kind/purposes 不建 Prisma enum 约束（zod 在 tool 层校验，匹配现有 `as never` 松散风格）。
- ⚠️ 重新拆解会重建 entries → 手动重命名丢失（重命名是事后标注，可接受；重拆前 UI 可提示）。

## 设计

### 1. 数据模型（Prisma + 迁移）

`BenchmarkEntryType` 加 `MATERIAL`；`BenchmarkEntry` 加两字段：

```prisma
enum BenchmarkEntryType { CHAPTER PLOT RHYTHM EMOTION CHARACTER STYLE MATERIAL }  // +MATERIAL

model BenchmarkEntry {
  ...
  type      BenchmarkEntryType
  title     String
  content   String    @default("")
  kind      String?              // 仅 MATERIAL: 梗|名场面|金句|套路 (TS zod 约束, DB 无 enum)
  purposes  String[]  @default([])  // 仅 MATERIAL: 用途标签数组
  chapterNo Int?
  order     Int       @default(0)
  ...
}
```

`kind`/`purposes` 仅 MATERIAL 使用，其余 6 类留空——**老数据零回填**。**一条迁移 + 手动 `pnpm --dir server prisma generate`**（Prisma 7 坑：`migrate dev` 不自动 regenerate client，改 schema 后必须手动 generate）。

### 2. 维度单源（方案 2 集中化）

新建 **`server/src/benchmark/dimensions.ts`** —— 所有维度元数据的唯一源：

```ts
export const BENCHMARK_DIMENSIONS = [
  { key: 'CHAPTER',   label: '章节',  color: 'indigo',   tab: 'list' },
  { key: 'PLOT',      label: '剧情',  color: 'amber',    tab: 'reading' },
  { key: 'RHYTHM',    label: '节奏',  color: 'blue',     tab: 'reading' },
  { key: 'EMOTION',   label: '情绪',  color: 'indigoLt', tab: 'reading' },
  { key: 'CHARACTER', label: '人物',  color: 'green',    tab: 'list' },
  { key: 'STYLE',     label: '文风',  color: 'violet',   tab: 'reading' },
  { key: 'MATERIAL',  label: '素材',  color: 'rose',     tab: 'material' },
] as const;
export const BENCHMARK_TYPES = BENCHMARK_DIMENSIONS.map(d => d.key);  // 工具 z.enum 源

export const MATERIAL_KINDS   = ['梗', '名场面', '金句', '套路'] as const;
export const MATERIAL_PURPOSES = [
  '开篇钩子', '爽点', '打脸装逼', '反转', '高潮',
  '低谷', '转场', '伏笔铺设', '情感扣子', '悬念',
] as const;
```

消费点全部派生自此：
- 服务端：5 个工具的 `z.enum(BENCHMARK_TYPES)`（替掉散落的字面量 enum）；`write_benchmark` 的 `kind` 用 `z.enum(MATERIAL_KINDS)`、`purposes` 用 `z.array(z.enum(MATERIAL_PURPOSES))`。
- FE：`agent-ui/src/lib/benchmark-dimensions.ts` 镜像同份配置（key/label/color/tab），`BenchmarkEntryType` union、`ENTRY_TYPE_LABEL`、`DIM_COLOR`、`TAB_LIST`、`groupByType` keys、`ReviewView.allDims` 全部派生。`6 - missing.length` → `BENCHMARK_DIMENSIONS.length - missing.length`，字面量 `6` 全消。

加下一个维度 = `BENCHMARK_DIMENSIONS` 加一行（+ 镜像 FE 一行），不再散落改 ~10 处。

> kind(4 值) / purposes(10 值) 是初始草案，后续可增删——加值只改这两常量 + zod 自动跟上。

### 3. 拆解提取（material-extractor subagent + prompt）

**DISSECT_TREE**（`dissect-tree.config.ts`）加节点：

```ts
{
  name: 'material-extractor',
  description: '抽取可复用素材（梗/名场面/金句/套路）',
  promptKey: 'MATERIAL_EXTRACTOR',
  modelTier: 'short', recommendedTier: 'short',  // 抽取叶子，可用便宜模型
  tools: ['write_benchmark', 'get_raw_chapter', 'get_dissect_entries'],  // 读 CHAPTER 摘要定位 + 抽原文锚点
}
```

`DISSECT_PROMPTS` map 加 `MATERIAL_EXTRACTOR` key；`dissect-prompts.ts` loader 导出对应常量。

**新 prompt `material-extractor.md`**（YAML frontmatter `name`/`key`/`title`/`description` + body）：
- 输入：所有 CHAPTER 摘要（经 `get_dissect_entries(type=CHAPTER)`）+ 需要时 `get_raw_chapter(N)` 取原文。
- 产出：每个值得复用的元素**一张 MATERIAL 卡**（一元素一卡，便于检索/重命名）。卡内容格式：

  ```
  【原文锚点】（摘录原句/原段，必带，<=150 字）
  【拆解】为什么好笑/好燃/好痛——手法拆解（视角/节奏/反差/信息差…）
  【套用场景】什么类型/什么情节节点能复用（与 purposes 呼应）
  ```
- 调用：`write_benchmark(type=MATERIAL, kind=梗, purposes=[爽点,打脸装逼], title=「学霸考完·单人应援」, content=…)`。`title` 用一句话点睛（便于浏览/重命名）；`kind` 单值；`purposes` 多值（一个梗可同时是爽点+名场面）。
- 抽取纪律：宁精勿滥——只抽有复用价值的元素（一个名场面、一句金句、一个可复用套路），不为凑数。金句/名场面本就稀疏，不强求数量。

**编排更新**：`dissect-main.md` 加 material 阶段——CHAPTER 之后启动，可与 PLOT/CHARACTER/STYLE 并行（只读 CHAPTER，无下游依赖）；critic 最后审。

**`write_benchmark` tool**（`write-benchmark.tool.ts`）：schema 加可选 `kind?` / `purposes?`；zod `.refine`：`type==='MATERIAL'` 时 `kind` 与 `purposes`（≥1）必填，其余 type 时忽略。

**`BenchmarkService.writeEntry`**：签名加 `kind?` / `purposes?`——顺手把位置参数改成 options 对象（消灭探索报告 flag 的位置参数坏味道，现有唯一调用点是 write-benchmark tool）。`type` cast `as never` 维持。

### 4. 拆解 critic + 上下文同步

- `dissect-critic.md`（纯 prompt 文本，不参与 TS 单源派生）：「6 type 齐全」→「7 type 齐全」，维度清单文字补 `MATERIAL`；MATERIAL 覆盖用软提示——「全书无任何可复用素材？复查」，不按数量硬拦（金句/名场面稀疏属正常）。FE 侧 `ReviewView.allDims` 与字面量 `6` 才走单源派生（见 §2/§7）。
- `dissect-context-assembler.service.ts` 产出规范 bullet 列表加 MATERIAL 一行（梗/名场面/金句/套路 + kind + purposes）。

### 5. 写作时检索（agent 工具，无 FE 面板）

**`get_benchmark` tool**（`get-benchmark.tool.ts`）—— 跨书写作参考工具：
- schema 加可选 `kind?` / `purpose?`（purpose 单值，命中 purposes 数组任一）。
- 过滤：`type` 可选（传 `MATERIAL` 走素材轴）；`kind` 精确匹配；`purpose` 走 `purposes.includes(purpose)` overlap；`query` 维持 substring。
- 返回：MATERIAL 卡带上 `kind` + `purposes` 字段（让 agent 看得到标签决定取舍）；content 截断维持 600 字。
- userId 跨书、多租户隔离维持。

**3 个写作 prompt 的【按需对标参考】段**（`main.md` / `writer.md` / `outline-writer.md`）加一条素材指引：
> 写具体场景（开篇/爽点/反转/低谷/转场）前，按 `purpose` 拉 `type=MATERIAL` 素材参考其手法（原文锚点+拆解+套用场景）；建人设可参考 `kind=梗` 看人设梗，`kind=金句` 看台词风格。素材是「怎么写好这一拍」的参考，不是抄录。

### 6. 卡片重命名（仅 entry.title）

**服务**：`BenchmarkService.updateEntryTitle(userId, bookId, entryId, title)` —— 所有权校验（book 归属 user + entry 归属 book），`title` trim 后非空 + 长度上限 120，返回更新后 entry。

**路由**：`PATCH /benchmarks/:bookId/entries/:entryId` body `{ title }`，全局 JWT 守卫（非 `@Public`），`ValidationPipe` whitelist。

**FE**：
- `api/benchmark.ts` 加 `renameBenchmarkEntry(bookId, entryId, title)`；`routes.ts` 加 `BenchmarkEntryRename` 项。
- 交互：卡片标题处加铅笔图标（hover 显）/双击 → inline `<input>`（受控，回车提交、Esc 取消、失焦提交）→ 乐观更新 `resultBook.entries` 里该 entry 的 title + 失败回滚 + 静默 refetch 兜底。
- 三处标题都接：`EntryDetail`（line ~1285）、`ReadingView` 头（line ~1087）、`ListView` 列表项（line ~1031）。MATERIAL 卡 + 现有 6 类卡都能改。

### 7. FE 结果浏览器（MATERIAL tab + 集中化）

- 集中化（见 §2）：FE 镜像 `benchmark-dimensions.ts`，`ENTRY_TYPE_LABEL`/`DIM_COLOR`/`TAB_LIST`/`groupByType` keys/`ReviewView.allDims`/字面量 `6` 全派生。
- 新增「素材」tab（`tab: 'material'`）：MATERIAL 是**多卡维度**（像 CHARACTER），不复用 `ReadingView`（它假设一维度一卡）；新建 `MaterialView`——左列卡列表（title + kind badge + purposes chips），右列 `EntryDetail`（原文锚点/拆解/套用场景 sections）。
- tab 内加 **kind filter + purpose filter chips**（两轴筛，对应「两个轴」决策）。
- `BenchmarkEntryType` FE union 加 `MATERIAL`；`BenchmarkEntry` type 加 `kind?: string` / `purposes: string[]`。

## 执行结构（按层推进，每层可独立验证）

1. **DB 层**：schema 加 MATERIAL + kind + purposes → 迁移 → `prisma generate`。
2. **单源层**：建 `dimensions.ts`（server）+ FE 镜像；5 工具 z.enum 改派生；FE 元数据改派生。此步应**不改行为**（纯重构），现有 6 维度全绿即过。
3. **写入层**：`write_benchmark` 加 kind/purposes + refine；`writeEntry` 改 options 对象 + 加参。
4. **提取层**：material-extractor 节点 + prompt + DISSECT_PROMPTS；dissect-main 编排；critic + context-assembler 同步。
5. **检索层**：`get_benchmark` 加 kind/purpose 过滤；3 写作 prompt 加素材指引。
6. **重命名层**：service + PATCH 路由 + FE client + inline 编辑交互。
7. **浏览层**：MATERIAL tab + MaterialView + filter chips。

## 测试

- **server unit**：
  - `updateEntryTitle` 所有权（跨 user/跨 book 拒）+ 空标题/超长拒。
  - `get_benchmark` kind/purpose 过滤（命中/不命中/组合）。
  - `writeEntry` options 对象 + kind/purposes 落库。
  - `dimensions.ts` 单源一致性锁（`BENCHMARK_TYPES` 含 MATERIAL；与各工具 z.enum 同源——可用一个 spec 导入常量比对）。
- **prompt spec**：`agent-prompts.spec.ts` 风格，锁 `material-extractor.md` 含特征子串（如「原文锚点」「套用场景」）。
- **L1 smoke**（可选）：`l1-integration.spec.ts` 加一条——直接 `writeEntry(MATERIAL, kind, purposes)` 落库 + `getEntries` 取回断言 kind/purposes。
- **FE**：`pnpm validate`（lint + format + typecheck；无 test runner）。
- **手验**：跑一本对标书的完整拆解，确认 MATERIAL tab 有卡、kind/purposes 正确、卡片能改名、改名后 refetch 持久。

## 风险与回滚

- **维度集中化重构**是纯重构层（步骤 2），应零行为变化——先落地并确认现有 6 维度全绿，再做后续增量。若重构出问题，git 回滚步骤 2 不影响 DB（MATERIAL 迁移独立）。
- **material-extractor 抽取质量**靠 prompt——首跑后据实调 prompt（kind/purposes 词条、抽取纪律）。
- **迁移**：加 enum 值 + 加列，向后兼容（老数据 kind=null/purposes=[]），无数据丢失风险。
