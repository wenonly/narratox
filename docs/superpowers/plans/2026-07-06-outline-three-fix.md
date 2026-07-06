# 大纲面板三处修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 实施(每 task 一个 fresh subagent + 两阶段 review)。agent-ui 无 jest 测试框架,验证靠 `pnpm --dir agent-ui validate`(lint + format + typecheck)+ 视觉自检。

**Goal:** 把 [OutlineView.tsx](agent-ui/src/components/workspace/views/OutlineView.tsx) 三处问题 fix 到位,与 Pencil 设计对齐(折叠态 `ZOkpY` / 展开态 `s9477h`)。

**Architecture:** 单文件纯展示层改动。① 删 `BeatDots` 5 离散点 → 新 `ArcProgress` 连续进度条;② Master 块加本地 `useState` 折叠态(默认折叠);③ 卷容器加 `bg-cardElevated` 实底框 + `BookOpen` 图标。

**Tech Stack:** Next.js 15 + React 18 + TypeScript + Tailwind(自定义 dark tokens)+ lucide-react。

参考 spec:[2026-07-06-outline-three-fix-design.md](../specs/2026-07-06-outline-three-fix-design.md)。

---

## File Structure

只动一个文件:[OutlineView.tsx](agent-ui/src/components/workspace/views/OutlineView.tsx)(当前 459 行)。

改动区域:
- `import`(第 4 行):加 `BookOpen`、`ChevronUp`
- `BeatDots` 组件(32-44):**删除**
- `ArcProgress` 组件:**新增**(替代 BeatDots,放在 ArcCard 上方)
- `ArcCard`(134-191):删 `beats` 计算 + `<BeatDots>`;标题行右侧换 `<ArcProgress>`
- `OutlineView` 主组件:
  - Master 块(287-346):包折叠态
  - 卷容器 div(354):加卷框
  - 卷标题行(360-374):加 BookOpen
  - 未分卷区(424-453):同款卷框

---

### Task 1:ArcProgress 替代 BeatDots(问题 3)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/OutlineView.tsx](agent-ui/src/components/workspace/views/OutlineView.tsx)

- [ ] **Step 1:在 `ArcCard` 上方新增 `ArcProgress` 组件**

在 `BeatDots` 组件位置(第 32 行起,替换 `BeatDots` 整个定义)改为:

```tsx
// 弧进度条:written/total 连续比例(替代旧的 5 离散点 BeatDots,
// 后者 Math.min(5, written) 把"5 拍单元循环"错实现成"已写章数封顶 5",
// 弧章数 >5 时 4/12 高亮 4 点 规律不明)。
const ArcProgress = ({ written, total }: { written: number; total: number }) => {
  const pct = total > 0 ? Math.round((written / total) * 100) : 0
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-1 w-12 overflow-hidden rounded-full bg-overlay-10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent-indigoLight"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-text-label">
        {written}/{total}
      </span>
    </div>
  )
}
```

- [ ] **Step 2:改 `ArcCard`,删 BeatDots 用法 + 换 ArcProgress**

`ArcCard` 里删 `beats` 计算(149-150 行):

```tsx
// 删掉这行:
const beats = Math.min(5, written)
```

`written` 计算保留(149 行前半 `const written = plans.filter((p) => p.status === 'WRITTEN').length` 保留)。

标题行右侧(原 163-168 行的 `<div className="flex shrink-0 items-center gap-1.5">` 块)整体替换:

```tsx
<div className="flex shrink-0 items-center gap-1.5">
  <ArcProgress written={written} total={plans.length} />
</div>
```

(原 `<BeatDots done={beats} />` + `<span>{written}/{plans.length}</span>` 都被 `ArcProgress` 整合替代。)

- [ ] **Step 3:验证**

```bash
pnpm --dir agent-ui typecheck
```

Expected: 通过(无 `BeatDots` / `beats` 残留引用,`ArcProgress` 类型正确)。

- [ ] **Step 4:Commit**

```bash
git add agent-ui/src/components/workspace/views/OutlineView.tsx
git commit -m "feat(outline): 弧进度条改连续比例(替代 5 离散点)"
```

---

### Task 2:Master 折叠/展开(问题 1)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/OutlineView.tsx](agent-ui/src/components/workspace/views/OutlineView.tsx)

- [ ] **Step 1:加 import + useState**

第 4 行 import 改为:

```tsx
import { BookOpen, ChevronDown, ChevronRight, ChevronUp, GitBranch, Scroll } from 'lucide-react'
```

`OutlineView` 组件里(200 行附近,跟其他 useState 在一起)加:

```tsx
const [masterOpen, setMasterOpen] = useState(false)
```

- [ ] **Step 2:重写 Master 块为折叠/展开双态**

把现 Master 块(287-346 行的 `{data.master && (<div className="rounded-md border ...">...</div>)}`)整体替换为:

```tsx
{data.master && (
  <div className="rounded-md border border-overlay-15 bg-accent-primarySoft px-3 py-2.5">
    <button
      type="button"
      onClick={() => setMasterOpen((v) => !v)}
      className="flex w-full items-center gap-1.5 text-left"
    >
      <Scroll className="size-3.5 text-accent-indigoLight" />
      <span className="text-sm font-semibold text-accent-indigoLight">
        总纲 · 全书北极星
      </span>
      <span className="ml-auto">
        {masterOpen ? (
          <ChevronUp className="size-3.5 text-text-tertiary" />
        ) : (
          <ChevronDown className="size-3.5 text-text-tertiary" />
        )}
      </span>
    </button>
    {!masterOpen ? (
      <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">
        {data.master.theme}
        {data.master.ending ? ` · 结局:${data.master.ending}` : ''}
      </p>
    ) : (
      <div className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-text-secondary">
        {data.master.theme && <p>故事核:{data.master.theme}</p>}
        {data.master.mainLine && <p>主线:{data.master.mainLine}</p>}
        {data.master.ending && <p>结局:{data.master.ending}</p>}
        {data.master.powerProgression?.length > 0 && (
          <p>
            力量进阶:
            {data.master.powerProgression
              .map((p) => `卷${p.volume}:${p.level}`)
              .join(' · ')}
          </p>
        )}
        {data.master.hiddenLines?.length > 0 && (
          <p>
            暗线:
            {data.master.hiddenLines
              .map((h) => `${h.name}(埋${h.plant ?? '?'}→揭${h.reveal ?? '?'})`)
              .join(' / ')}
          </p>
        )}
        {data.master.threeAct &&
          (data.master.threeAct.act1Turn ||
            data.master.threeAct.act2Turn ||
            data.master.threeAct.act3Turn) && (
            <div className="space-y-0.5 pt-0.5">
              <p>三幕(大梁):</p>
              {data.master.threeAct.act1Turn && (
                <p className="pl-2">
                  ·一幕末(卷{data.master.threeAct.act1Turn.atVolume}):
                  {data.master.threeAct.act1Turn.beat}
                </p>
              )}
              {data.master.threeAct.act2Turn && (
                <p className="pl-2 text-accent-indigoLight">
                  ·二幕末·灵魂黑夜(卷
                  {data.master.threeAct.act2Turn.atVolume}):
                  {data.master.threeAct.act2Turn.beat}
                </p>
              )}
              {data.master.threeAct.act3Turn && (
                <p className="pl-2">
                  ·三幕末(卷{data.master.threeAct.act3Turn.atVolume}):
                  {data.master.threeAct.act3Turn.beat}
                </p>
              )}
            </div>
          )}
      </div>
    )}
  </div>
)}
```

> 说明:展开态的字段渲染与改前代码字节一致(只换了缩进/容器),保证不丢现有行为。折叠态是新逻辑:`theme` 必显,`ending` 有才拼。

- [ ] **Step 3:验证**

```bash
pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint
```

Expected: 通过。

- [ ] **Step 4:Commit**

```bash
git add agent-ui/src/components/workspace/views/OutlineView.tsx
git commit -m "feat(outline): 总纲默认折叠摘要,点击展开全字段"
```

---

### Task 3:卷框升级 + BookOpen 图标(问题 2)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/OutlineView.tsx](agent-ui/src/components/workspace/views/OutlineView.tsx)

- [ ] **Step 1:卷容器加框**

把卷 `<div key={v.id} className="flex flex-col gap-2">`(第 354 行)改为:

```tsx
<div
  key={v.id}
  className="flex flex-col gap-2 rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2.5"
>
```

- [ ] **Step 2:卷标题行加 BookOpen 图标**

卷标题行里 `<span className="flex items-center gap-1.5 truncate">`(360-365 行,内含 ChevronDown/Right + 卷标题)改为在最前加 `BookOpen`:

```tsx
<span className="flex items-center gap-1.5 truncate">
  {isOpen ? (
    <ChevronDown className="size-3 shrink-0 text-text-tertiary" />
  ) : (
    <ChevronRight className="size-3 shrink-0 text-text-tertiary" />
  )}
  <BookOpen className="size-3 shrink-0 text-text-tertiary" />
  <span
    className={cn(
      'truncate text-sm text-text-primary',
      isOpen ? 'font-semibold' : 'font-medium'
    )}
  >
    {v.title}
  </span>
</span>
```

- [ ] **Step 3:未分卷区同款卷框 + 图标**

未分卷区(424-453 行)外层 `<div className="flex flex-col gap-2">` 加同款 className:

```tsx
<div className="flex flex-col gap-2 rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2.5">
```

未分卷标题(427-430 行 `<p className="flex items-center gap-1.5 py-1 text-sm font-medium text-text-primary">`)加 `BookOpen` 在 ChevronRight 后:

```tsx
<p className="flex items-center gap-1.5 py-1 text-sm font-medium text-text-primary">
  <ChevronRight className="size-3 text-text-tertiary" />
  <BookOpen className="size-3 text-text-tertiary" />
  未分卷
</p>
```

- [ ] **Step 4:验证**

```bash
pnpm --dir agent-ui validate
```

Expected: lint + format + typecheck 全过。

- [ ] **Step 5:Commit**

```bash
git add agent-ui/src/components/workspace/views/OutlineView.tsx
git commit -m "feat(outline): 卷分组加 cardElevated 框 + BookOpen 图标"
```

---

## 验证(整分支,subagent 跑完三 task 后)

1. `pnpm --dir agent-ui validate` 全过。
2. 视觉自检:`pnpm --dir agent-ui dev` 打开 `/novels/:id` → 右侧大纲 tab:
   - **Master 默认折叠**(一行 `theme · 结局:...`)→ 点击展开 → 全字段(故事核/主线/结局/力量/暗线/三幕,灵魂黑夜 indigo 高亮)→ 再点折叠。
   - **卷有深色实底框** + `BookOpen` 图标;折叠/展开同款。
   - **弧右上角是连续进度条**(非 5 离散点),`1/3` → ~33% indigo 填充;`0/4` → 空条。
3. 对比 Pencil 帧:折叠态对 `ZOkpY`,展开态对 `s9477h`。

## 不在范围

- 弧进度反映「正在写」半进度(可后续打磨)
- 卷标题加进度条(Pencil 也没画)
- Master 折叠态持久化(本地 useState 即可)
- 弧卡 / 章卡视觉改动
- server / DB / agent 改动

## 实施者注意

- OutlineView.tsx 是已 Read 文件,行号基于改前版本;Edit 时按 old_string 唯一匹配,不要硬靠行号。
- `bg-bg-cardElevated` 是 agent-ui 自定义 Tailwind token(`#27272A`),代码里已有同款用法(ChapterPlanCard)。
- Task 1/2/3 改动相对独立,但都在同一文件 → **串行执行**(一个 subagent 跑完一个 task 再下一个),不要并行。
- 真实浏览器测试如需要:**只用新建 fixture 账户**,禁 reset 既有账户密码(见 memory `subagent-test-no-real-account.md`)。
