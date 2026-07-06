# 角色模块视觉重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 实施(每 task 一个 fresh subagent + 两阶段 review)。agent-ui 无 jest 测试框架,验证靠 `pnpm --dir agent-ui validate`(lint + format + typecheck)+ 视觉自检。

**Goal:** 把 [CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx) 视觉重做,对齐 Pencil 设计(`ReT0F` roster / `wR61w` 展开):role 三色映射 + avatar + 左色带 + 弱点/弧光 tint 块前置 + 时间线节点化 + 头部概览条。

**Architecture:** 单 FE 文件(`CharactersView.tsx`)+ token 层(`globals.css` + `tailwind.config.ts`)。新增 `role` Tailwind 命名空间(主角 indigo / 反派 rose / 配角 violet),展开态把灵魂字段(flaw/arcGoal)从档案数组里拆出来做独立 tint 块,时间线改节点式。

**Tech Stack:** Next.js 15 + React 18 + TypeScript + Tailwind(自定义 dark tokens)+ lucide-react。

参考 spec:[2026-07-06-character-view-redesign-design.md](../specs/2026-07-06-character-view-redesign-design.md)。

---

## File Structure

- **Modify:** [agent-ui/src/app/globals.css](agent-ui/src/app/globals.css) —— 加 3 个 CSS 变量(`--accent-violet-soft` / `--role-ant` / `--role-ant-soft`)
- **Modify:** [agent-ui/tailwind.config.ts](agent-ui/tailwind.config.ts) —— `accent` 命名空间加 `violetSoft`,新增 `role` 命名空间(`ant` / `antSoft`)
- **Modify:** [agent-ui/src/components/workspace/views/CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx) —— 全文重写组件结构

零 DB / server / agent / 类型改动。`Character` 类型字段已齐(`name`/`aliases`/`role`/`faction`/`background`/`appearance`/`personality`/`motivation`/`arcGoal`/`voice`/`growth`/`flaw`/`changes`/`currentState`)。

---

### Task 1:Tailwind tokens(role 命名空间 + violetSoft)

**Files:**
- Modify: [agent-ui/src/app/globals.css](agent-ui/src/app/globals.css)(`--accent-violet` 行附近,第 66 行后)
- Modify: [agent-ui/tailwind.config.ts](agent-ui/tailwind.config.ts)(`accent` 命名空间,第 20-29 行)

- [ ] **Step 1:加 3 个 CSS 变量到 globals.css**

在 [globals.css](agent-ui/src/app/globals.css) 第 68 行(`--accent-violet-mid: #9d85ff;`)后追加 3 行:

```css
    --accent-violet-soft: #8b5cf626;
    --role-ant: #f43f5e;
    --role-ant-soft: #f43f5e26;
```

(放在 `--accent-violet-mid` 之后、`--text-*` 区块之前,与其它 accent 变量同块。)

- [ ] **Step 2:tailwind.config.ts 的 accent 命名空间加 violetSoft**

在 [tailwind.config.ts](agent-ui/tailwind.config.ts) 第 28 行(`violetMid: 'var(--accent-violet-mid)'`)后追加:

```ts
          violetSoft: 'var(--accent-violet-soft)'
```

(注意逗号:原 `violetMid` 行末尾加 `,`,新行无尾逗号——保持对象合法。)

- [ ] **Step 3:tailwind.config.ts 新增 role 命名空间**

在 `accent: { ... }` 块**之后**(第 29 行 `}` 之后,即 `bg:` 之前)新增整个 `role` 命名空间:

```ts
        // role — 角色语义色(PROTAGONIST 复用 accent.indigo / ANTAGONIST rose / SUPPORTING 复用 accent.violet)
        role: {
          ant: 'var(--role-ant)',
          antSoft: 'var(--role-ant-soft)'
        },
```

> 说明:主角(`PROTAGONIST`)用 `accent.primary` / `accent.primarySoft`(已有);配角(`SUPPORTING`)用 `accent.violet` / 新 `accent.violetSoft`;反派(`ANTAGONIST`)用新 `role.ant` / `role.antSoft`。role 命名空间只放反派独有的两色。

- [ ] **Step 4:验证**

```bash
pnpm --dir agent-ui typecheck
```

Expected: 通过(tailwind.config.ts 是 `satisfies Config`,新加的 color key 类型合法)。

- [ ] **Step 5:Commit**

```bash
git add agent-ui/src/app/globals.css agent-ui/tailwind.config.ts
git commit -m "feat(theme): 加 role-ant/violetSoft 语义色 token"
```

---

### Task 2:CharactersView 常量 + Avatar/Chip 子组件

**Files:**
- Modify: [agent-ui/src/components/workspace/views/CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx)

这是个大文件的渐进重写。**Task 2 只改顶部**(import + 常量 + 新子组件),不动主组件 JSX。Task 3-5 改 JSX。

- [ ] **Step 1:改 import,加 lucide 图标**

把 [CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx) 第 4 行改为:

```tsx
import {
  ChevronDown,
  ChevronRight,
  Skull,
  Target
} from 'lucide-react'
```

(`ChevronDown` / `ChevronRight` 已在用;`Skull` 给弱点块、`Target` 给弧光块。已确认 lucide-react 导出这两个。)

- [ ] **Step 2:替换 ROLE_LABEL 为 ROLE_COLOR map + 拆 PROFILE_FIELDS**

把第 15-19 行的 `ROLE_LABEL` 整块替换为:

```tsx
const ROLE_COLOR: Record<
  CharacterRole,
  { label: string; color: string; soft: string }
> = {
  PROTAGONIST: {
    label: '主角',
    color: 'accent-primary',
    soft: 'accent-primarySoft'
  },
  ANTAGONIST: {
    label: '反派',
    color: 'role-ant',
    soft: 'role-antSoft'
  },
  SUPPORTING: {
    label: '配角',
    color: 'accent-violet',
    soft: 'accent-violetSoft'
  }
}
```

> 说明:`color` / `soft` 是 Tailwind class 后缀片段(如 `'accent-primary'` → 拼 `text-accent-primary` / `border-accent-primary` / `bg-accent-primarySoft`)。这样一处定义,Avatar/色带/badge/chip 都按 role 取色。

把第 21-30 行的 `FIELD_LABEL` 保留不动(当前态 + 时间线仍用)。

把第 33-56 行的 `PROFILE_FIELDS` 数组**整体替换**为两组(短/长分离 + flaw/arcGoal 移除——它们升级到独立 tint 块):

```tsx
// 短字段 → 2-col chip grid(展开态档案区)。flaw/arcGoal 不在此处——它们有独立 tint 块。
const SHORT_FIELDS: Array<{ key: 'faction' | 'voice' | 'personality' | 'motivation'; label: string }> = [
  { key: 'faction', label: '阵营' },
  { key: 'voice', label: '语言' },
  { key: 'personality', label: '性格' },
  { key: 'motivation', label: '执念' }
]

// 长字段 → 段落堆叠(展开态档案区)。
const LONG_FIELDS: Array<{
  key: 'background' | 'growth' | 'appearance'
  label: string
}> = [
  { key: 'background', label: '出身背景' },
  { key: 'growth', label: '成长经历' },
  { key: 'appearance', label: '外貌' }
]
```

- [ ] **Step 3:加 AVATAR_BG / AVATAR_FG 字面量 map + Avatar 子组件**

> **Tailwind 动态 class 陷阱**:`bg-${soft}` / `text-${color}` 这种模板字符串拼接会被 Tailwind v3 JIT 当成未使用 class purge 掉(源码里没有完整字面量)。**解法**:用 Record map 把拼接改成字面量查找,每个值都是完整 class 字面量,JIT 能扫到。

在 `LONG_FIELDS` 之后、`CharactersView` 主组件之前,新增:

```tsx
// Tailwind JIT 字面量 map:动态取色必须经此查找,模板字符串拼接会被 purge。
const AVATAR_BG: Record<string, string> = {
  'accent-primarySoft': 'bg-accent-primarySoft',
  'role-antSoft': 'bg-role-antSoft',
  'accent-violetSoft': 'bg-accent-violetSoft'
}
const AVATAR_FG: Record<string, string> = {
  'accent-primary': 'text-accent-primary',
  'role-ant': 'text-role-ant',
  'accent-violet': 'text-accent-violet'
}

// 角色头像:首字母 + role soft 底 + role 色字。size='sm'(折叠 28)/ 'md'(展开 34)。
const Avatar = ({
  name,
  color,
  soft,
  size = 'sm'
}: {
  name: string
  color: string
  soft: string
  size?: 'sm' | 'md'
}) => {
  const px = size === 'md' ? 34 : 28
  const fs = size === 'md' ? 16 : 13
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        AVATAR_BG[soft]
      )}
      style={{ width: px, height: px }}
    >
      <span
        className={cn('font-semibold', AVATAR_FG[color])}
        style={{ fontSize: fs }}
      >
        {name[0]}
      </span>
    </div>
  )
}
```

> 说明:`AVATAR_BG`/`AVATAR_FG` 的 key 与 `ROLE_COLOR.{role}.soft`/`.color` 值一一对应。Task 3 的 role 分组色点、Task 5 的尾部角色色提示也都复用 `AVATAR_BG[soft]`。

- [ ] **Step 4:验证**

```bash
pnpm --dir agent-ui typecheck
```

Expected: 通过。`ROLE_COLOR` / `SHORT_FIELDS` / `LONG_FIELDS` / `Avatar` 类型正确;`CharacterRole` 已在 import 里(原文件第 8 行 `import type { Character, CharacterRole, Novel }`)。

- [ ] **Step 5:Commit**

```bash
git add agent-ui/src/components/workspace/views/CharactersView.tsx
git commit -m "feat(character): ROLE_COLOR map + Avatar 子组件"
```

---

### Task 3:概览条 + role 分组色点(主组件 JSX 上半部分)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx)

- [ ] **Step 1:主组件 return 顶部加 OverviewBar**

在 `CharactersView` 的 `return (` 之后(原第 96 行 `<div className="space-y-3">` 之后),插入 OverviewBar:

```tsx
<div className="space-y-3">
  <OverviewBar chars={chars} />
  {/* 原 role 分组 .map 紧接其后 */}
```

`OverviewBar` 子组件(在 `Avatar` 之后定义):

```tsx
// 头部概览条:X 角色 · Y MAJOR · 第N章 最近。
const OverviewBar = ({ chars }: { chars: Character[] }) => {
  const total = chars.length
  const major = chars.reduce(
    (n, c) => n + c.changes.filter((ch) => ch.significance === 'MAJOR').length,
    0
  )
  const recent =
    chars.reduce((m, c) => {
      const top = c.changes.reduce((x, ch) => Math.max(x, ch.chapterOrder), 0)
      return Math.max(m, top)
    }, 0) || 0
  return (
    <div className="flex items-center gap-2 rounded-md bg-overlay-5 px-2.5 py-2 text-xs">
      <span className="font-semibold text-text-primary">{total}</span>
      <span className="text-text-tertiary">角色</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-accent-indigoLight">{major}</span>
      <span className="text-text-tertiary">MAJOR</span>
      <span className="text-text-label">·</span>
      <span className="text-text-tertiary">最近</span>
      <span className="font-semibold text-text-secondary">第{recent}章</span>
    </div>
  )
}
```

> 说明:`text-accent-indigoLight` 已是 tailwind config 里的 token(`accent.indigoLight`)。MAJOR 计数取所有角色 changes 里 MAJOR 总和。`recent` 取所有 changes 里最大 chapterOrder(0 = 无变化记录)。

- [ ] **Step 2:role 分组标签加色点**

把原 role 分组标签(第 104-106 行附近):

```tsx
<p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
  {ROLE_LABEL[role]} · {items.length}
</p>
```

替换为:

```tsx
<div className="mb-1.5 flex items-center gap-1.5 px-1">
  <span
    className={cn('size-1.5 rounded-full', AVATAR_BG[ROLE_COLOR[role].soft])}
  />
  <span className="text-[10px] font-semibold tracking-wide text-text-tertiary">
    {ROLE_COLOR[role].label}
  </span>
  <span className="text-[10px] text-text-label">· {items.length}</span>
</div>
```

> 说明:色点用 `AVATAR_BG[soft]`(role soft 色,与该组角色的 avatar 同色,视觉绑定)。`ROLE_LABEL[role]` → `ROLE_COLOR[role].label`。

- [ ] **Step 3:验证**

```bash
pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint
```

Expected: 通过。`ROLE_LABEL` 已无引用(被 `ROLE_COLOR` 替代)。

- [ ] **Step 4:Commit**

```bash
git add agent-ui/src/components/workspace/views/CharactersView.tsx
git commit -m "feat(character): 概览条 + role 分组色点"
```

---

### Task 4:折叠卡重做(avatar + 左色带 + aliases chip)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx)

- [ ] **Step 1:加 BAND_CLASS 字面量 map(同 AVATAR_BG 范式)**

在 `AVATAR_FG` 之后追加:

```tsx
const BAND_CLASS: Record<string, string> = {
  'accent-primary': 'border-accent-primary',
  'role-ant': 'border-role-ant',
  'accent-violet': 'border-accent-violet'
}
```

- [ ] **Step 2:重写折叠态卡的 button + 容器**

把原折叠卡(第 118-167 行附近,即 `isOpen ? (...) : (...)` 整块,两个 button 分支)**整体替换**为单一结构(不再分 isOpen 双分支——折叠/展开都用同一个 header button,展开态在 header 下方追加内容)。

新结构(替换原 `<div key={c.id} className="rounded-md border ...">` 内的全部内容):

```tsx
<div
  key={c.id}
  className={cn(
    'rounded-md border border-overlay-15 border-l-2 bg-bg-cardElevated px-3 py-2.5',
    BAND_CLASS[ROLE_COLOR[c.role].color]
  )}
>
  <button
    type="button"
    onClick={() =>
      setOpenName((cur) => (cur === c.name ? null : c.name))
    }
    className="flex w-full items-center gap-2.5 text-left"
  >
    <Avatar
      name={c.name}
      color={ROLE_COLOR[c.role].color}
      soft={ROLE_COLOR[c.role].soft}
    />
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-sm font-semibold text-text-primary">
          {c.name}
        </span>
        {c.aliases.length > 0 && (
          <span className="truncate text-xs text-text-tertiary">
            {c.aliases.join('/')}
          </span>
        )}
      </div>
      {(c.personality || c.motivation) && (
        <p className="truncate text-xs text-text-tertiary">
          {[c.personality && `性格:${c.personality}`, c.motivation && `动机:${c.motivation}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
    {isOpen ? (
      <ChevronDown className="size-3.5 shrink-0 text-text-label" />
    ) : (
      <ChevronRight className="size-3.5 shrink-0 text-text-label" />
    )}
  </button>
  {isOpen && <ExpandedBody c={c} />}
</div>
```

> 关键变化:① 卡容器加 `border-l-2 border-{role}`(色带);② header 内部加 `<Avatar>`;③ chevron 合并到 header 末尾(折叠=right / 展开=down),不再双 button 分支;④ 展开内容抽到 `<ExpandedBody>` 子组件(Task 5 实现)。
>
> **暂时**在文件里留一个空的 `ExpandedBody` 占位(Task 5 填充):

```tsx
// Task 5 会填充展开态内容,先占位让 typecheck 过。
const ExpandedBody = ({ c }: { c: Character }) => (
  <div className="mt-2 border-t border-overlay-10 pt-2 text-xs text-text-label">
    档案加载中…
  </div>
)
```

(把 `ExpandedBody` 定义在 `Avatar` 之后、`CharactersView` 之前。)

- [ ] **Step 3:删除原 `isOpen && (...)` 展开块**

原文件第 168-277 行的 `{isOpen && (<div className="mt-2 space-y-2 border-t...">...档案/当前态/变化时间线...</div>)}` 整块**删除**(被 `<ExpandedBody>` 替代)。

同时删除原 `const stateEntries = ...` 与 `const essenceLine = ...`(第 110-116 行)—— `essenceLine` 逻辑已内联进新 header,`stateEntries` 移到 Task 5 的 `ExpandedBody` 内。

- [ ] **Step 4:验证**

```bash
pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint
```

Expected: 通过。无残留 `ROLE_LABEL` / `PROFILE_FIELDS` / `stateEntries` / `essenceLine` 引用。

- [ ] **Step 5:Commit**

```bash
git add agent-ui/src/components/workspace/views/CharactersView.tsx
git commit -m "feat(character): 折叠卡重做(avatar + 左色带 + aliases)"
```

---

### Task 5:展开态(弱点/弧光 tint 块 + 档案 chip grid + 当前态 + 时间线节点)

**Files:**
- Modify: [agent-ui/src/components/workspace/views/CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx)

- [ ] **Step 1:把 ExpandedBody 占位替换为完整实现**

把 Task 4 临时占位的 `ExpandedBody` 整体替换为:

```tsx
const ExpandedBody = ({ c }: { c: Character }) => {
  const stateEntries = Object.entries(c.currentState).filter(
    ([f]) => f !== 'appearance'
  )
  const changes = c.changes.slice().reverse()
  const rc = ROLE_COLOR[c.role]
  return (
    <div className="mt-2 space-y-2.5 border-t border-overlay-10 pt-2.5">
      {/* 弱点 (rose tint) */}
      {c.flaw && (
        <div className="space-y-1 rounded-md bg-role-antSoft px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <Skull className="size-3 text-role-ant" />
            <span className="text-[10px] font-semibold tracking-wide text-role-ant">
              执念 · 弱点
            </span>
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{c.flaw}</p>
        </div>
      )}

      {/* 弧光目标 (indigo tint) */}
      {c.arcGoal && (
        <div className="space-y-1 rounded-md bg-accent-primarySoft px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <Target className="size-3 text-accent-indigoLight" />
            <span className="text-[10px] font-semibold tracking-wide text-accent-indigoLight">
              弧光目标
            </span>
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">
            {c.arcGoal}
          </p>
        </div>
      )}

      {/* 档案:短字段 chip grid + 长字段堆叠 */}
      {SHORT_FIELDS.some((f) => c[f.key]) || LONG_FIELDS.some((f) => c[f.key]) ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-text-label">
            档案
          </p>
          {SHORT_FIELDS.some((f) => c[f.key]) && (
            <div className="grid grid-cols-2 gap-1.5">
              {SHORT_FIELDS.map((f) =>
                c[f.key] ? (
                  <div
                    key={f.key}
                    className="flex items-center gap-1 rounded-full bg-overlay-5 px-2 py-1"
                  >
                    <span className="text-[10px] text-text-tertiary">
                      {f.label}
                    </span>
                    <span className="truncate text-[10px] font-medium text-text-secondary">
                      {c[f.key]}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}
          {LONG_FIELDS.map((f) =>
            c[f.key] ? (
              <div key={f.key} className="space-y-0.5">
                <span className="text-[10px] text-text-tertiary">{f.label}</span>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {c[f.key]}
                </p>
              </div>
            ) : null
          )}
        </div>
      ) : null}

      {/* 当前态 chips */}
      {stateEntries.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold tracking-wide text-text-label">
            当前态 · 第{Math.max(...stateEntries.map(([, s]) => s.chapterOrder), 0)}章
          </p>
          <div className="flex flex-wrap gap-1.5">
            {stateEntries.map(([field, s]) => (
              <div
                key={field}
                className="flex items-center gap-1 rounded-full bg-overlay-10 px-2 py-0.5"
              >
                <span className="text-[10px] text-text-tertiary">
                  {FIELD_LABEL[field] ?? field}
                </span>
                <span className="text-[10px] font-medium text-text-primary">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 变化时间线(倒序节点) */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold tracking-wide text-text-label">
          变化时间线 · {c.changes.length} 条
        </p>
        {changes.length === 0 ? (
          <p className="text-xs text-text-tertiary">暂无变化记录</p>
        ) : (
          changes.map((ch, i) => {
            const major = ch.significance === 'MAJOR'
            return (
              <div key={i} className="flex items-start gap-2 py-0.5">
                <span
                  className={cn(
                    'mt-0.5 size-2 shrink-0 rounded-full border',
                    major
                      ? 'border-accent-indigoLight bg-accent-indigoLight'
                      : 'border-accent-indigoLight bg-transparent'
                  )}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-[10px] font-semibold',
                        major ? 'text-accent-indigoLight' : 'text-text-tertiary'
                      )}
                    >
                      第{ch.chapterOrder}章
                    </span>
                    {major && (
                      <span className="text-[9px] font-semibold text-accent-indigoLight">
                        ★ MAJOR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">
                    <span className="text-text-tertiary">
                      {FIELD_LABEL[ch.field] ?? ch.field.split(':')[0]}:
                    </span>{' '}
                    {ch.value}
                  </p>
                  {ch.reason && (
                    <p className="text-[10px] text-text-label">→ {ch.reason}</p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 角色色提示尾(可选,与 role soft 同色,绑定视觉) */}
      <div className="flex items-center gap-1 pt-0.5 text-[9px] text-text-label">
        <span className={cn('size-1 rounded-full', AVATAR_BG[rc.soft])} />
        {rc.label}
      </div>
    </div>
  )
}
```

> 关键点:
> - `c.flaw` / `c.arcGoal` 有值才渲染对应 tint 块(条件渲染,不是 CSS 隐藏)。
> - `SHORT_FIELDS.some(f => c[f.key])` —— 任一短字段有值才渲染 chip grid。
> - 时间线节点:`major` 实心 indigo / `minor` 空心圆;`★ MAJOR` badge 仅 MAJOR。
> - `FIELD_LABEL` 沿用(Task 2 保留);`ROLE_COLOR` 用于尾部角色色提示。
> - `MarkdownRenderer` **移除**——展开态字段都是短文本/中长文本,不需要 markdown 渲染(简化 + 性能;若 `growth`/`flaw` 等含 markdown 语法,以纯文本显示也可接受,与 Pencil 设计一致——Pencil 里也是纯文本)。

- [ ] **Step 2:清理无用 import**

如果 Task 1 后 `MarkdownRenderer` 不再被引用(原文件第 9 行 `import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'`),删除该 import。

```bash
grep -n "MarkdownRenderer" agent-ui/src/components/workspace/views/CharactersView.tsx
```

Expected: 无输出(已无引用)→ 删第 9 行 import。如有输出(仍被引用)→ 保留。

- [ ] **Step 3:验证**

```bash
pnpm --dir agent-ui validate
```

Expected: lint + format + typecheck 全过。

- [ ] **Step 4:Commit**

```bash
git add agent-ui/src/components/workspace/views/CharactersView.tsx
git commit -m "feat(character): 展开态重做(弱点/弧光 tint + chip grid + 时间线节点)"
```

---

## 验证(整分支,subagent 跑完 5 task 后)

1. `pnpm --dir agent-ui validate` 全过。
2. 视觉自检:`pnpm --dir agent-ui dev` 打开 `/novels/:id` → 右侧角色 tab:
   - **概览条**:头部显示 `X 角色 · Y MAJOR · 最近 第N章`。
   - **role 分组**:主角/反派/配角 各有 indigo/rose/violet 色点 + label + count。
   - **折叠卡**:每张有圆形 avatar(role soft 底 + 首字母 role 色)+ 左 2px role 色带 + 名字 + aliases + essence + chevron-right。主角 indigo / 反派 rose / 配角 violet 三色清晰可辨。
   - **展开卡**(点林动):header(avatar + 名字 + role badge + aliases + chevron-down)→ 弱点 rose tint 块 → 弧光 indigo tint 块 → 档案(2-col chips + 长字段段落)→ 当前态 chips → 时间线节点(MAJOR 实心 / minor 空心 + ★ MAJOR badge)。
3. 对比 Pencil 帧:折叠对 `ReT0F`,展开对 `wR61w`。

## 不在范围

- **DB / server / agent / 类型** —— 零改动。
- **手动角色 CRUD** —— 不动。
- **头像图片 / 真人立绘** —— 仅首字母色块。
- **搜索 / 筛选 / 排序** —— 不做。
- **MarkdownRenderer** —— 展开 tad 移除(纯文本);若后续 `growth`/`flaw` 等需要 markdown,单独评估加回。
- **大纲 / 章节 / 伏笔等其它资源面板** —— 不动。

## 实施者注意

- CharactersView.tsx 行号基于改前版本(当前 290 行);Edit 时按 old_string 唯一匹配,不要硬靠行号。
- Tailwind 动态 class 必须在源码里出现**完整字面量**才不被 purge——本 plan 用 `AVATAR_BG` / `AVATAR_FG` / `BAND_CLASS` 三个 Record map 把动态拼接改成字面量查找,JIT 友好。
- Task 1 的 tailwind.config 改动要先于 Task 2-5 的 class 使用落地(typecheck 不会因缺失 token 报错,但 lint/build 时 `bg-role-antSoft` 等 class 会因未定义而被忽略 → 视觉无 tint。务必 Task 1 先 commit)。
- Task 2-5 都改同一文件,**串行执行**(一个 subagent 跑完一个 task 再下一个),不要并行。
- 真实浏览器测试如需要:**只用新建 fixture 账户**,禁 reset 既有账户密码(见 memory `subagent-test-no-real-account.md`)。
