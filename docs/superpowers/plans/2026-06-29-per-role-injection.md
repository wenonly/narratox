# 按角色重分配注入 实施计划

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** main 只注入 {态势, 总纲};writer augment 补【前情】(last 5 摘要)。ContextAssembler 构造器瘦到 3 参。

**Spec:** [2026-06-29-per-role-injection-design.md](../specs/2026-06-29-per-role-injection-design.md)

---

## Task 1:fore-slice 纯函数 + spec

**Files:** Create `server/src/agentos/fore-slice.ts` + `server/src/agentos/fore-slice.spec.ts`

- [ ] **Step 1: 测试**
```ts
import { buildForeSlice } from './fore-slice';
describe('buildForeSlice', () => {
  it('空返 ""', () => expect(buildForeSlice([])).toBe(''));
  it('格式化 + 早→晚(listRecent 返 desc,reverse)', () => {
    const s = buildForeSlice([
      { chapterOrder: 2, summary: '觉醒' },
      { chapterOrder: 1, summary: '下山' },
    ]);
    expect(s).toBe('【前情】第1章:下山 / 第2章:觉醒');
  });
});
```
- [ ] **Step 2: 跑→失败** `pnpm --dir server test -- fore-slice.spec.ts`
- [ ] **Step 3: 实现** `fore-slice.ts`(见 spec 设计代码)
- [ ] **Step 4: 跑→过**
- [ ] **Step 5: 提交** `git commit -m "feat(fore-slice): buildForeSlice 纯函数(writer 前情注入用)"`

---

## Task 2:ContextAssembler 瘦身(构造器 3 参 + forSession 只 {态势,总纲})

**Files:** `server/src/agentos/context-assembler.service.ts`

- [ ] **Step 1: import 清理** —— 删 `SummaryService/StoryEventService/WorldEntryService/NovelReferenceService/CharacterService/EventService/ArcService` import + `buildReferenceSlice` import。保留 `PrismaService/MasterOutlineService/buildMasterOutlineSlice/MAIN_AGENT_PROMPT/SYSTEM_PROMPT`。
- [ ] **Step 2: 构造器 10→3 参**:
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly statusService: StatusService,
  private readonly masterOutlines: MasterOutlineService,
) {}
```
- [ ] **Step 3: forSession 重写** —— 只保留:novel findFirst → buildSystemPrompt;`overview = statusService.getOverview`;`master = masterOutlines.get`;slices = [masterSlice?, 态势?];插 marker 前。删其余 fetch(listRecent/listOpen/listCore/listIndex/listRecentMajor/findArcByChapter/listByChapterRange/listAll/currentChapter)+ slice push + `buildCharacterIndexSlice` 方法。
```ts
// forSession 主体(精简后):
const novel = await this.prisma.novel.findFirst({ where: { sessionId, userId }, select: { title, genre, synopsis, settings, id, status } });
if (!novel) return { prompt: SYSTEM_PROMPT, novelId: null };
const base = this.buildSystemPrompt(novel, novel.status);
const overview = await this.statusService.getOverview(userId, novel.id);
const master = await this.masterOutlines.get(userId, novel.id);
const masterSlice = buildMasterOutlineSlice(master as never);
const slices: string[] = [];
if (masterSlice) slices.push(masterSlice);
if (overview) {
  slices.push(`【小说态势】${overview.totalWords}字·${overview.chapterCount}章·frontier第${overview.frontierChapter}章${overview.currentVolume ? `·${overview.currentVolume.title}` : ''}${overview.currentArc ? `·弧${overview.currentArc.order}「${overview.currentArc.title}」` : ''} | 立项:基础${...}参考${...}世界${...}大纲${...}弧${...}角色${...} | 细纲剩${overview.coverage.plannedRemaining}章 | 开放伏笔${overview.health.openHooks}(⚠️${overview.health.staleHooks}) | 下一步:${overview.nextStep}`);
}
if (!slices.length) return { prompt: base, novelId: novel.id };
const marker = '规则:不要编造与设定冲突的情节';
const idx = base.indexOf(marker);
if (idx === -1) return { prompt: base, novelId: novel.id };
return { prompt: base.slice(0, idx) + slices.join('\n') + '\n' + base.slice(idx), novelId: novel.id };
```
> 态势那一行的 `basicsAll/flags` 逻辑保留原样。
- [ ] **Step 4: typecheck**(此时所有 `new ContextAssembler(...)` 测试点会报「期望 3 参」——下一 Task 修)

---

## Task 3:ContextAssembler 测试同步

**Files:** `context-assembler.service.spec.ts`(改)、`context-assembler.memory.spec.ts`(删)、`test/pipeline.spec.ts`(改 1 处)

- [ ] **Step 1: service.spec 顶部 stub** —— 删 stubSummaries/stubEvents/stubWorld/stubReferences/stubCharacters/stubEventService/stubArcService;留/改:
```ts
const stubStatusService = { getOverview: jest.fn().mockResolvedValue(null) } as never;
const stubMasterOutlines = { get: jest.fn().mockResolvedValue(null) } as never;
```
- [ ] **Step 2: 所有 `new ContextAssembler(...)` 改 3 参** `new ContextAssembler({} as unknown as PrismaService, stubStatusService, stubMasterOutlines)`(forSession 用真 prisma mock 的那些,第 1 参保留各自 prisma mock)。
- [ ] **Step 3: 删过时用例** —— 删「injects 写作参考」「does not inject 写作参考」「injects 角色 索引」三条(main 不再注入这些)。「does not inject character slice」改为泛断言 `expect(prompt).not.toContain('【前情】')` 之类,或并进新用例。
- [ ] **Step 4: 加 main 瘦身断言** —— 一个用例:mock overview 返一个对象 + master 返一个对象 → `expect(prompt).toContain('【小说态势】')` + `toContain('【总纲】')` + `not.toContain('【前情】')` + `not.toContain('【角色】')` + `not.toContain('【未回收伏笔】')` + `not.toContain('【写作参考】')`。
- [ ] **Step 5: 删 `context-assembler.memory.spec.ts`**(整文件)。
- [ ] **Step 6: `test/pipeline.spec.ts`** 的 `new ContextAssembler(prisma, summaries, events, world, references, characters, eventService, arcService, statusService, masterOutlines)` → `new ContextAssembler(prisma, statusService, masterOutlines)`。
- [ ] **Step 7: typecheck + test** → 全绿。

---

## Task 4:writer 补前情(DeepAgentService)

**Files:** `server/src/agentos/deep-agent.service.ts`

- [ ] **Step 1: import** `import { buildForeSlice } from './fore-slice';`
- [ ] **Step 2: runTurn** 取前情(与 masterSlice 同区):
```ts
const fore = await this.summaries.listRecent(userId, novelId, 5);
const foreSliceRaw = buildForeSlice(fore);
const foreSlice = foreSliceRaw ? '\n\n' + foreSliceRaw : '';
```
`buildAgentGraph` 入参对象加 `foreSlice,`。
- [ ] **Step 3: buildAgentGraph 签名** 加 `foreSlice?: string;`;解构加 `foreSlice = '',`;resolvePrompt writer:
```ts
if (spec.promptAugment === 'writer') prompt += masterSlice + foreSlice + voiceSlice;
```
rewind 入参补 `foreSlice: '',`。
- [ ] **Step 4: typecheck + test** → 全绿(deep-agent.service.spec 测 buildTurnMessages,不受影响)。
- [ ] **Step 5: 提交 Task 2-4 合并**:
```bash
git add server/src/agentos/context-assembler.service.ts server/src/agentos/context-assembler.service.spec.ts server/src/agentos/deep-agent.service.ts server/test/pipeline.spec.ts
git rm server/src/agentos/context-assembler.memory.spec.ts
git commit -m "feat(context): main 瘦身(只态势+总纲)+ writer 补前情(按角色重分配注入)"
```

---

## Task 5:全量回归 + CLAUDE.md

- [ ] `pnpm --dir server test && pnpm --dir server typecheck` 全绿。
- [ ] CLAUDE.md Phase 19 条补:main 瘦身到 {态势+总纲}(删 7 个 writer 导向/dynamic slice,main 按需 tool 拉);writer augment 补【前情】(last 5 摘要,补 N-1 全文与 query_memory 间中程视野);ContextAssembler 构造器 10→3 参;新增 fore-slice 纯函数;删 context-assembler.memory.spec。链 spec/plan。
- [ ] 提交 CLAUDE.md。

---

## Self-Review
- fore-slice → Task1;ContextAssembler 瘦身 → Task2;测试同步 → Task3;writer 前情 → Task4。✅
- 一致性:buildForeSlice Task1 定义 / Task4 消费;ContextAssembler 3 参 Task2 定义 / Task3 测试消费 / pipeline 同步;foreSlice arg 贯穿 runTurn→buildAgentGraph→resolvePrompt。✅
- 删 memory.spec 因其测的行为(main 注入 前情/伏笔)已不存在;前情移至 writer(Task4)。✅
