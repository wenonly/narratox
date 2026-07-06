# 世界观模块视觉重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 实施(每 task 一个 fresh subagent + 两阶段 review)。agent-ui 无 jest 测试框架,验证靠 `pnpm --dir agent-ui validate`(lint + format + typecheck)+ 视觉自检。

**Goal:** 把 [WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx) 视觉重做,对齐 Pencil 设计(`wJNpY` roster / `nJZHq` 展开):8 type 归 3 族色(lore indigo / power amber / world emerald)+ 每 type 专属 lucide 图标 + 概览条 + 左族色带 + 展开 header tint。

**Architecture:** 单 FE 文件(`WorldviewView.tsx`)+ token 层(`globals.css` + `tailwind.config.ts`)。新增 `family` Tailwind 命名空间。沿用 character 范式的 JIT-safe 字面量 map(`FAMILY_BG`/`FAMILY_FG`/`FAMILY_BAND`)。展开态保留 `MarkdownRenderer`(worldview 内容是自由 markdown)。

**Tech Stack:** Next.js 15 + React 18 + TypeScript + Tailwind(自定义 dark tokens)+ lucide-react。

参考 spec:[2026-07-06-worldview-view-redesign-design.md](../specs/2026-07-06-worldview-view-redesign-design.md)。

---

## File Structure

- **Modify:** [agent-ui/src/app/globals.css](agent-ui/src/app/globals.css) —— 加 4 个 CSS 变量(`--family-power` / `--family-power-soft` / `--family-world` / `--family-world-soft`)
- **Modify:** [agent-ui/tailwind.config.ts](agent-ui/tailwind.config.ts) —— 新增 `family` 命名空间
- **Modify:** [agent-ui/src/components/workspace/views/WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx) —— 全文重写组件结构

零 DB / server / agent / 类型改动。`WorldEntry` 类型字段已齐(`id`/`type`/`name`/`content`)。

---

### Task 1:Tailwind tokens(family 命名空间)

**Files:**
- Modify: [agent-ui/src/app/globals.css](agent-ui/src/app/globals.css)
- Modify: [agent-ui/tailwind.config.ts](agent-ui/tailwind.config.ts)

- [ ] **Step 1:加 4 个 CSS 变量到 globals.css**

在 [globals.css](agent-ui/src/app/globals.css) 的 `--role-ant-soft: #f43f5e26;`(Task 1 of character redesign 加的)后追加 4 行:

```css
    --family-power: #f59e0b;
    --family-power-soft: #f59e0b26;
    --family-world: #10b981;
    --family-world-soft: #10b98126;
```

(放在 `--role-ant-soft` 之后,与其它 accent/role 变量同块。)

- [ ] **Step 2:tailwind.config.ts 新增 family 命名空间**

在 [tailwind.config.ts](agent-ui/tailwind.config.ts) 的 `role:` 命名空间块**之后**(character redesign 加的,第 ~36 行 `},` 之后,`bg:` 之前)插入:

```ts
        // family — 世界观 type 族色(lore 复用 accent.primary / power amber / world emerald)
        family: {
          power: 'var(--family-power)',
          powerSoft: 'var(--family-power-soft)',
          world: 'var(--family-world)',
          worldSoft: 'var(--family-world-soft)'
        },
```

> 说明:lore 族复用 `accent.primary` / `accent.primarySoft`(已存在),无需新 token。

- [ ] **Step 3:验证**

```bash
pnpm --dir agent-ui typecheck
```

Expected: 通过。

- [ ] **Step 4:Commit**

```bash
git add agent-ui/src/app/globals.css agent-ui/tailwind.config.ts
git commit -m "feat(theme): 加 family power/world 族色 token"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 2:TYPE_META + FAMILY_COLOR + TypeIconBox 子组件

**Files:**
- Modify: [agent-ui/src/components/workspace/views/WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx)

Task 2 只改顶部(import + 常量 + 新子组件),不动主组件 JSX。

- [ ] **Step 1:改 import,加 8 个 lucide 图标 + 类型**

把 [WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx) 第 4 行改为:

```tsx
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Dna,
  Flag,
  Gem,
  MapPin,
  Scale,
  Scroll,
  Zap,
  type LucideIcon
} from 'lucide-react'
```

第 8 行已 `import type { Novel, WorldEntry, WorldEntryType } from '@/types/novel'` —— 保留。

加 `cn` import(若文件无):

```tsx
import { cn } from '@/lib/utils'
```

(检查文件是否已有;character 文件没有,这个可能也没有。若已有则跳过。)

- [ ] **Step 2:替换 WORLD_TYPE_LABEL 为 TYPE_META + FAMILY_COLOR**

把第 15-24 行的 `WORLD_TYPE_LABEL` 整块替换为:

```tsx
type FamilyKey = 'lore' | 'power' | 'world'

const TYPE_META: Record<
  WorldEntryType,
  { label: string; icon: LucideIcon; family: FamilyKey }
> = {
  concept: { label: '设定 / 总览', icon: Scroll, family: 'lore' },
  history: { label: '历史 / 传说', icon: Clock, family: 'lore' },
  powerSystem: { label: '力量体系', icon: Zap, family: 'power' },
  rule: { label: '规则 / 禁忌', icon: Scale, family: 'power' },
  item: { label: '物品 / 资源', icon: Gem, family: 'power' },
  location: { label: '地点', icon: MapPin, family: 'world' },
  faction: { label: '势力 / 组织', icon: Flag, family: 'world' },
  race: { label: '种族 / 生物', icon: Dna, family: 'world' }
}

const FAMILY_COLOR: Record<FamilyKey, { color: string; soft: string }> = {
  lore: { color: 'accent-primary', soft: 'accent-primarySoft' },
  power: { color: 'family-power', soft: 'family-powerSoft' },
  world: { color: 'family-world', soft: 'family-worldSoft' }
}

// type 分组排序(同族相邻,与 Pencil roster 帧一致)。
const TYPE_ORDER: WorldEntryType[] = [
  'concept',
  'history',
  'powerSystem',
  'rule',
  'item',
  'location',
  'faction',
  'race'
]
```

(`TYPE_ORDER` 替换原第 74-83 行内联的 `typeOrder`。)

- [ ] **Step 3:加 FAMILY_BG / FAMILY_FG / FAMILY_BAND 字面量 map + TypeIconBox**

在 `essence` 工具函数之后、`WorldviewView` 主组件之前,新增:

```tsx
// Tailwind JIT 字面量 map:动态取色必须经此查找,模板字符串拼接会被 purge。
const FAMILY_BG: Record<string, string> = {
  'accent-primarySoft': 'bg-accent-primarySoft',
  'family-powerSoft': 'bg-family-powerSoft',
  'family-worldSoft': 'bg-family-worldSoft'
}
const FAMILY_FG: Record<string, string> = {
  'accent-primary': 'text-accent-primary',
  'family-power': 'text-family-power',
  'family-world': 'text-family-world'
}
const FAMILY_BAND: Record<string, string> = {
  'accent-primary': 'border-l-accent-primary',
  'family-power': 'border-l-family-power',
  'family-world': 'border-l-family-world'
}

// type 图标盒:族 soft 底 + 族色图标。size='sm'(折叠 26)/ 'md'(展开 34)。
const TypeIconBox = ({
  type,
  size = 'sm'
}: {
  type: WorldEntryType
  size?: 'sm' | 'md'
}) => {
  const meta = TYPE_META[type]
  const fam = FAMILY_COLOR[meta.family]
  const Icon = meta.icon
  const px = size === 'md' ? 34 : 26
  const fs = size === 'md' ? 16 : 13
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        FAMILY_BG[fam.soft]
      )}
      style={{ width: px, height: px }}
    >
      <Icon
        className={FAMILY_FG[fam.color]}
        style={{ width: fs, height: fs }}
      />
    </div>
  )
}
```

> 说明:`FAMILY_BG`/`FAMILY_FG`/`FAMILY_BAND` 的 key 与 `FAMILY_COLOR.{family}.soft`/`.color` 值一一对应。Task 3 的分组色点 + Task 4 的卡色带也都复用 `FAMILY_BG[soft]` / `FAMILY_BAND[color]`。

- [ ] **Step 4:验证**

```bash
pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint
```

Expected: 通过(可能 lint 报 `TYPE_META`/`TYPE_ORDER`/`FAMILY_*`/`TypeIconBox` 未使用 —— 预期,Task 3-5 用)。

- [ ] **Step 5:Commit**

```bash
git add agent-ui/src/components/workspace/views/WorldviewView.tsx
git commit -m "feat(worldview): TYPE_META + TypeIconBox 子组件"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 3:概览条 + type 分组标签(主组件 JSX 上半部分)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx)

- [ ] **Step 1:加 OverviewBar 子组件**

在 `TypeIconBox` 之后、`WorldviewView` 之前,新增:

```tsx
// 头部概览条:X 条目 · Y 类型。
const OverviewBar = ({ entries }: { entries: WorldEntry[] }) => {
  const total = entries.length
  const types = new Set(entries.map((e) => e.type)).size
  return (
    <div className="flex items-center gap-2 rounded-md bg-overlay-5 px-2.5 py-2 text-xs">
      <span className="font-semibold text-text-primary">{total}</span>
      <span className="text-text-tertiary">条目</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-accent-indigoLight">{types}</span>
      <span className="text-text-tertiary">类型</span>
    </div>
  )
}
```

- [ ] **Step 2:主组件 return 顶部加 OverviewBar + 替换 type 分组标签**

找到 `WorldviewView` 的 `return (` 后的 `<div className="space-y-3">`。在其后插入 `<OverviewBar entries={entries} />`。

把原 type 分组标签(原第 94-96 行):

```tsx
<p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
  {WORLD_TYPE_LABEL[type]} · {items.length}
</p>
```

替换为(分组标签里用内联 16px 小图标圆,不直接用 26px 的 `<TypeIconBox>`——那是给卡内用的):

```tsx
<div className="mb-1.5 flex items-center gap-1.5 px-1">
  <span
    className={cn(
      'size-1.5 rounded-full',
      FAMILY_BG[FAMILY_COLOR[TYPE_META[type].family].soft]
    )}
  />
  {(() => {
    const meta = TYPE_META[type]
    const fam = FAMILY_COLOR[meta.family]
    const Icon = meta.icon
    return (
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded-full',
          FAMILY_BG[fam.soft]
        )}
      >
        <Icon className={cn('size-2.5', FAMILY_FG[fam.color])} />
      </span>
    )
  })()}
  <span className="text-[10px] font-semibold tracking-wide text-text-tertiary">
    {TYPE_META[type].label}
  </span>
  <span className="text-[10px] text-text-label">· {items.length}</span>
</div>
```

同时把 `.map((type) => ...)` 上方的 `const typeOrder: WorldEntryType[] = [...]`(原第 74-83 行)**删除**(已被模块级 `TYPE_ORDER` 替代),并把 `typeOrder.map(...)` 改为 `TYPE_ORDER.map(...)`。

- [ ] **Step 3:验证**

```bash
pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint
```

Expected: 通过。`WORLD_TYPE_LABEL` / `typeOrder` 已无引用。

- [ ] **Step 4:Commit**

```bash
git add agent-ui/src/components/workspace/views/WorldviewView.tsx
git commit -m "feat(worldview): 概览条 + type 分组色点图标"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 4:折叠卡重做(TypeIconBox + 左族色带)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx)

- [ ] **Step 1:重写折叠卡 JSX**

找到 `items.map((e) => {...})` 块(原第 98-146 行)。把整段 `{items.map((e) => { const isOpen = openId === e.id; return (<div ...>{isOpen ? <button>A</button> : <button>B</button>}{isOpen && e.content && <div>markdown</div>}</div>) })}` 替换为:

```tsx
{items.map((e) => {
  const isOpen = openId === e.id
  const fam = FAMILY_COLOR[TYPE_META[e.type].family]
  return (
    <div
      key={e.id}
      className={cn(
        'rounded-md border border-overlay-15 border-l-2 bg-bg-cardElevated px-3 py-2',
        FAMILY_BAND[fam.color]
      )}
    >
      <button
        type="button"
        onClick={() => setOpenId((cur) => (cur === e.id ? null : e.id))}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <TypeIconBox type={e.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-text-primary">
            {e.name}
          </span>
          {e.content && (
            <p className="truncate text-xs text-text-tertiary">
              {essence(e.content)}
            </p>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0 text-text-label" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-text-label" />
        )}
      </button>
      {isOpen && e.content && (
        <ExpandedBody entry={e} />
      )}
    </div>
  )
})}
```

> 关键变化:① 卡容器加 `border-l-2` + `FAMILY_BAND[fam.color]`(族色带);② header 加 `<TypeIconBox type={e.type} />`;③ chevron 合并到 header 末尾(折叠 right / 展开 down),不再双 button 分支;④ 展开内容抽到 `<ExpandedBody>` 子组件(Task 5 实现)。
>
> **暂时**留一个空 `ExpandedBody` 占位(Task 5 填充):

```tsx
const ExpandedBody = ({ entry }: { entry: WorldEntry }) => {
  const meta = TYPE_META[entry.type]
  const fam = FAMILY_COLOR[meta.family]
  const Icon = meta.icon
  return (
    <div className="mt-2 border-t border-overlay-10 pt-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className={cn(
            'flex size-4 items-center justify-center rounded-full',
            FAMILY_BG[fam.soft]
          )}
        >
          <Icon className={cn('size-2.5', FAMILY_FG[fam.color])} />
        </span>
        <span
          className={cn(
            'rounded-full px-1.5 py-px text-[9px] font-semibold',
            FAMILY_BG[fam.soft],
            FAMILY_FG[fam.color]
          )}
        >
          {meta.label}
        </span>
      </div>
      <div className="prose prose-invert max-w-none text-xs leading-relaxed text-text-secondary">
        <MarkdownRenderer>{entry.content}</MarkdownRenderer>
      </div>
    </div>
  )
}
```

(把 `ExpandedBody` 定义在 `TypeIconBox` 之后、`OverviewBar` 之前,与其它子组件同区。`MarkdownRenderer` import 已存在。)

- [ ] **Step 2:验证**

```bash
pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint
```

Expected: 通过。

- [ ] **Step 3:Commit**

```bash
git add agent-ui/src/components/workspace/views/WorldviewView.tsx
git commit -m "feat(worldview): 折叠卡重做(type 图标 + 左族色带)"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 5:展开态增强(header 行 + 概述 tint 块)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx)

Task 4 的 `ExpandedBody` 已经能渲染 markdown body。Task 5 把 header 升级为「大图标 + 名字 + type 徽章」一行(对齐 Pencil `nJZHq`),并加一个概述 tint 块(取 content 首段)。

- [ ] **Step 1:加 extractIntro 工具函数**

在 `essence` 函数之后,新增:

```tsx
// 提取 content 的首段(到第一个空行),作为展开态概述 tint 块。返回 '' 表示无。
const extractIntro = (content: string): string => {
  const firstPara = content.split(/\n\s*\n/)[0] ?? ''
  const text = firstPara
    .replace(/^#+\s*/m, '')
    .replace(/[*_`>-]/g, '')
    .trim()
  return text.length > 120 ? text.slice(0, 120) + '…' : text
}
```

- [ ] **Step 2:ExpandedBody 加 tint 概述 + 大 header**

把 Task 4 的 `ExpandedBody` 替换为:

```tsx
const ExpandedBody = ({ entry }: { entry: WorldEntry }) => {
  const meta = TYPE_META[entry.type]
  const fam = FAMILY_COLOR[meta.family]
  const Icon = meta.icon
  const intro = extractIntro(entry.content)
  return (
    <div className="mt-2 space-y-2.5 border-t border-overlay-10 pt-2.5">
      {/* header row:大图标 + type 徽章 */}
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full',
            FAMILY_BG[fam.soft]
          )}
        >
          <Icon className={cn('size-3.5', FAMILY_FG[fam.color])} />
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
            FAMILY_BG[fam.soft],
            FAMILY_FG[fam.color]
          )}
        >
          {meta.label}
        </span>
      </div>

      {/* 概述 tint 块 */}
      {intro && (
        <div
          className={cn(
            'rounded-md px-2.5 py-2 text-xs leading-relaxed text-text-secondary',
            FAMILY_BG[fam.soft]
          )}
        >
          {intro}
        </div>
      )}

      {/* markdown body */}
      <div className="prose prose-invert max-w-none text-xs leading-relaxed text-text-secondary">
        <MarkdownRenderer>{entry.content}</MarkdownRenderer>
      </div>
    </div>
  )
}
```

> 关键点:
> - header 行:大 TypeIconBox(28px)+ type 徽章(族 soft pill + 族色字)。
> - 概述 tint 块:取 `extractIntro(content)` 首段,族 soft 底,作为视觉锚点。**仅当 intro 非空才渲染**。
> - markdown body:完整 `MarkdownRenderer(content)` 保留(worldview 内容含列表/标题/加粗,tint 块只是首段预览,完整内容仍在 body)。
> - Pencil `nJZHq` 里的「等阶 grid / 备注 bullets」是示意,**本期不做**(需 type 专属结构化数据)。

- [ ] **Step 3:验证**

```bash
pnpm --dir agent-ui validate
```

Expected: lint + format + typecheck 全过。

- [ ] **Step 4:Commit**

```bash
git add agent-ui/src/components/workspace/views/WorldviewView.tsx
git commit -m "feat(worldview): 展开态加 header 行 + 概述 tint 块"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

## 验证(整分支,subagent 跑完 5 task 后)

1. `pnpm --dir agent-ui validate` 全过。
2. 视觉自检:`pnpm --dir agent-ui dev` 打开 `/novels/:id` 右侧世界观 tab:
   - **概览条**:头部显示 `X 条目 · Y 类型`。
   - **type 分组**:每组有族色点 + type 小图标 + label + count。3 族色清晰可辨(设定+历史 indigo / 力量+规则+物品 amber / 地点+势力+种族 emerald)。
   - **折叠卡**:左族色带 + TypeIconBox(type 图标)+ name + essence + chevron-right。
   - **展开卡**:点任意条目 → 展开 header(大图标 + type 徽章)+ 概述 tint 块(族色)+ markdown body。
3. 对比 Pencil 帧:折叠对 `wJNpY`,展开对 `nJZHq`(注意:`nJZHq` 等阶 grid 是示意,本期用 markdown body)。

## 不在范围

- **type 专属结构化渲染**(powerSystem 等阶 grid 等)—— 需 schema 扩展,本期不做。
- **meta 尾(关联/出处)** —— 无数据源。
- **手动条目 CRUD / 搜索 / 筛选** —— 不动。
- **其它资源面板** —— 不动。

## 实施者注意

- WorldviewView.tsx 行号基于改前版本(当前 155 行);Edit 时按 old_string 唯一匹配。
- Tailwind 动态 class 必须用字面量 map(`FAMILY_BG`/`FAMILY_FG`/`FAMILY_BAND`)—— 模板拼接会被 purge。
- Task 1 的 token 要先于 Task 2-5 的 class 使用落地。
- Task 2-5 同文件,**串行执行**,不并行。
- 真实浏览器测试如需要:**只用新建 fixture 账户**(见 memory `subagent-test-no-real-account.md`)。
- `MarkdownRenderer` import 保留(展开态仍用)。
