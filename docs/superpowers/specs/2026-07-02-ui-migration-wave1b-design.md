# Narratox UI 迁移 — Wave 1B 执行设计

> **定位**:[Wave 1 执行设计](./2026-07-02-ui-migration-wave1-design.md) §3/§4 已定 Wave 1B 的路由范围(library/knowledge/settings + W1-Gate)与"演进对齐帧"总则;本文补 Wave 1B 特有的执行决策(force-multiplier、PageShell、ModelSettings 拆分、ad-hoc token 映射、两 plan 拆分)。tokens 视觉权威仍是 [Token Spec](./2026-07-02-ui-redesign-design.md)。

**前置**:Wave 0(地基)+ Wave 1A(共享原子 + AppSidebar + auth)已并入 main。新 token 命名空间 + Card/Badge/CollapsibleCard 原子 + Button `gradient`/`soft` 变体均可用。

**决策日期**:2026-07-02。**决策方式**:superpowers brainstorming。

---

## 1. 探查结论(Wave 1B 表面)

- **11 个目标文件,142 处老 token**。新 token 采用率 0/18(纯净起点)。
- 老token 分布:KnowledgeBrowser 27(行密度最高)、ModelSettings 32(绝对最多)、VoiceProfileEditor 25、NovelCard 14、VoiceProfileList 12、AgentModelSettings 10、PublishDialog 8、NovelLibrary 6、settings/page 6、knowledge/page 3、library/page 0。
- **`globals.css` `.input-base`** 是 force-multiplier:ModelSettings/AgentModelSettings/VoiceProfileEditor 的表单控件都继承它。**重写这一条规则 → 半个 settings 表单迁移完成**。
- **`body { bg-background/80 }`**(globals.css:12)= Wave 1A 最终评审 M1,所有路由的 body 底色。
- **3 个路由页共享 shell**(`<div flex h-screen bg-background/80> AppSidebar + main header`)→ `PageShell` 抽取机会。
- **`ModelSettings.tsx` 615 行**混 3 组件(VendorFormDialog + ModelFormDialog + ModelSettings + Field helper)= 该拆信号。
- **ad-hoc token**(不在标准老 token 列表):`border-white/20`、`border-white/10`、`text-brand`、`hover:text-brand`、`bg-brand/{15,20,40,60}` → 一并迁。

Pencil 帧 ID:Library `03 ZcuP6`/`04 iG9mm`/`05 y6n6p`/`06 e0BcF` · Knowledge `07 d7his` · Settings `12 oIlQJ`/`13 Z1NqW`/`14 IQ4H4`/`15 VkyiZ`/`16 Lwzeu`。

---

## 2. 执行决策

### 2.1 Force-multiplier 先行(W1B-0,所有路由前置)

- **重写 `.input-base`**(globals.css):`rounded-input border border-overlay-15 bg-bg-cardElevated text-text-primary focus:border-accent-primary`。一处改动,级联到 ModelSettings/AgentModelSettings/VoiceProfileEditor 全部表单控件。
- **修 body 底色**(globals.css:12):`bg-background/80 text-secondary` → `bg-bg-darkest text-text-body`(M1 收尾)。
- **抽 `PageShell`**(`components/layout/PageShell.tsx`):封装 `flex h-screen bg-bg-darkest` + `AppSidebar` + `<main>` header(标题 + 副标题/状态 slot)。library/knowledge/settings 三页改用它,消三份重复 + 统一 header 样式。**props**:`active`(透传 AppSidebar)+ `title` + `children`(+ 可选 `headerRight` slot 给"+ 新建小说"等 CTA)。

### 2.2 ModelSettings 拆分(615 行 → 3 文件)

- `components/settings/VendorFormDialog.tsx`(独立)
- `components/settings/ModelFormDialog.tsx`(独立)
- `components/settings/ModelSettings.tsx`(主列表,import 上两个)
- 拆完再 reskin:vendor 行 → `CollapsibleCard`;模型行 → Card 内列表;"新建厂商"/"加模型" CTA → `Button variant="gradient"`;`⭐ 默认` pill → `Badge`。
- 纯结构拆分(行为不变)+ reskin 同步进行;先拆后 reskin,每步可验证。

### 2.3 Ad-hoc token 映射(补 cheat-sheet)

| Ad-hoc 老 class | 新 class |
|-----------------|----------|
| `border-white/20` | `border-overlay-15` |
| `border-white/10` | `border-overlay-10` |
| `text-brand` / `hover:text-brand` | `text-accent-indigoLight` / `hover:text-accent-indigoLight` |
| `bg-brand`(纯色 CTA) | `Button variant="gradient"` 或 `bg-accent-primary` |
| `bg-brand/15` / `bg-brand/20`(高亮/选中背景) | `bg-accent-primarySoft`(#6366f126 = indigo ~15%) |
| `bg-brand/40` / `bg-brand/60`(悬停/激活) | **用 `bg-accent-primarySoft`(hover)或 `bg-accent-primary`(solid 激活);如必须精确 40%,用字面量 `bg-[#6366f140]`** |

> **⚠ opacity 修饰符脚枪(同 Wave 0 destructive bug 同类):** `accent.*` / `text.*` / `bg.*` token 都是裸 `var()`(`var(--accent-primary)` 等),**Tailwind v3 的 `/NN` 透明度修饰符对它们无效** —— `parseColor('var(--accent-primary)')` 返回 null,`/NN` 被静默丢弃。**只有功能色** `destructive`/`success`/`warning`/`info`(RGB 通道模式)支持 `/NN`。因此:**绝不写 `bg-accent-primary/40` 这类** —— 用 `bg-accent-primarySoft`(设计的 15% indigo)、`bg-accent-primary`(solid)、或字面量 `bg-[#6366f1XX]`。`accent-primarySoft` 是 `#6366f126`,即 indigo ~15% —— 等价于 `bg-brand/15` 的新体系表达,是高亮/选中/悬停背景的首选。

### 2.4 每路由做法(沿用策略 spec §2.3)

演进现有组件对齐 Pencil 帧:token 迁移 + 换用新原子(Card/Badge/CollapsibleCard)+ 结构按帧调整。帧 = 验收靶。

---

## 3. 两 plan 拆分(同 1A/1B 节奏)

| Plan | 步 | 内容 | 验收 |
|------|----|------|------|
| **Plan 1B-1** | W1B-0 | force-multiplier(`.input-base` + body + `PageShell` 抽取 + 三页改用) | `pnpm validate` 绿;三页 shell 统一;表单控件自动新 token |
| | W1B-1 | library(NovelLibrary/NovelCard/PublishDialog)对齐帧 03-06 | 截图比对;NovelCard→Card+Badge;PublishDialog 表单;空态/卡片菜单 |
| **Plan 1B-2** | W1B-2 | knowledge(KnowledgeBrowser)对齐帧 07 | 截图比对;chips/pills→Badge;左右双栏→Card |
| | W1B-3 | settings(ModelSettings 拆分+reskin / AgentModelSettings / VoiceProfile{List,Editor})对齐帧 12-16 | 截图比对;vendor 行→CollapsibleCard;4 弹窗 |
| | W1-Gate | 硬门:Wave 1 路由文件零老 token;`pnpm validate`;运行时冒烟 | 见 Wave 1 spec §4 |

**顺序理由**:W1B-0 是依赖根(force-multiplier 级联);library 中等复杂度暖手;knowledge 单文件但 token 密;settings 最重(拆分 + 4 弹窗)放最后。W1-Gate 收尾。

---

## 4. 验证(沿用 Wave 1 spec §4)

- `pnpm validate` 每步绿。
- 每路由 Pencil 帧 `get_screenshot` / `export_nodes` → 渲染结果(Playwright)人工比对。
- **W1-Gate 硬门**(Plan 1B-2 末):`grep` Wave 1 路由文件零老 token(含 ad-hoc `border-white/*` / `text-brand` / `bg-brand/*`,且 `bg-accent` 锚定区分新 `bg-accent-primary`)。
- 运行时冒烟:login → library(空/有数据/卡片菜单/发布弹窗)→ knowledge(搜索/分类/条目)→ settings(Vendor/Model/AgentModel/VoiceProfile 表单)全跑通。

---

## 5. 不做(边界)

- 不动 workspace/dissect 路由(它们的共享原子已在 1A 翻新;路由本身留 Wave 2/3)。
- 不删老 token 定义(`brand`/`background`/`primary` 等留 tailwind config,Wave 2/3 路由还在用)→ Wave 3 清剿。
- 不改业务层(api/store/hooks)。
- `PageShell` 仅用于 library/knowledge/settings(workspace 用 IconRail、dissect 单栏,不用)。

---

## 6. 后续

1. `superpowers:writing-plans` 出 **Plan 1B-1**(W1B-0 + library)。
2. 执行 1B-1(子 agent 驱动)→ 合并。
3. 出 **Plan 1B-2**(knowledge + settings + W1-Gate)→ 执行 → 合并 → Wave 1 收尾。
4. Wave 2(workspace)brainstorm。
