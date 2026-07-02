# Narratox UI 迁移 — Wave 1 执行设计

> **定位**:本文件是 [迁移策略 spec](./2026-07-02-ui-migration-strategy-design.md) §4 Wave 1 的**执行决策增补**——策略 spec 已定 Wave 1 的范围/路由/帧归属/验证总则;本文只补三件策略 spec 没钉死的执行层决策(共享原子迁移策略、任务切片、硬验收门)。视觉/tokens 权威仍是 [Token Spec](./2026-07-02-ui-redesign-design.md)。冲突时:策略 spec > 本文 > Token Spec(tokens 值)。

**前置**:Wave 0(地基)已并入 main——CSS 变量 token 层 + Tailwind 嵌套命名空间 + Inter + 4 个新原子(Card/Badge/ActivityRow/CollapsibleCard)。新 token 命名空间已可用,老 token 原封共存。

**决策日期**:2026-07-02。**决策方式**:superpowers brainstorming(聚焦执行决策,大框架沿用策略 spec)。

---

## 1. Wave 1 范围(沿用策略 spec §4,细化)

| 路由 | 帧归属(Token Spec §7) | 现有组件 | 共享原子依赖 |
|------|----------------------|----------|--------------|
| `/login` `/register` | 01/02 | `app/(auth)/login/page.tsx` `app/(auth)/register/page.tsx` | Input(仅此 2 处)、Button |
| `/`(library) | 03 main / 04 empty / 05 card-menu / 06 publish | `library/NovelLibrary.tsx` `library/NovelCard.tsx` `library/PublishDialog.tsx` | Button、Dialog、AppSidebar |
| `/knowledge` | 07 | `knowledge/KnowledgeBrowser.tsx` | AppSidebar |
| `/settings` | 12 main / 13 model dialog / 14 agent-model dialog / 15 voice editor / 16 empty | `settings/ModelSettings.tsx` `settings/AgentModelSettings.tsx` + 弹窗 | Button、Dialog、AppSidebar |

**不在 Wave 1**:workspace(`/novels/[id]`,Wave 2)、dissect(`/dissect`,Wave 3)。

---

## 2. 执行决策

### 2.1 共享原子迁移:**原地重接**(已定)

Button/Input/Dialog/Textarea/Skeleton 的**内部 className** 从老 token(`bg-primary`/`bg-background`/`bg-brand`/`bg-accent`/`bg-destructive`/`text-primary`…)迁到新 token 命名空间(`bg-bg-card`/`bg-accent-primary`/`text-text-primary`/…)。**变体 API 保持不变** → 所有调用点零改动照常跑。

- **Button**:除内部 token 迁移外,**追加 Token Spec §3.4 变体**(`gradient` 渐变胶囊 / `soft`),保留现有 `default`/`outline`/`secondary`/`ghost`/`link`/`destructive` 变体以兼容现有调用点(各调用点在本路由波次内逐步切到新变体,旧变体 Wave 3 清剿时删)。
- **Input**:仅 login/register 用 → 迁移后 Wave 1 内 100% 新 token。
- **Dialog**:Wave 1(4)+Wave 2/3(2)共用 → 内部迁新 token,API 不变。
- **Textarea**:仅 Wave 2(ChatInput)用,但顺手一起迁(零额外风险)。**不复用**它做长文编辑(CLAUDE.md 已警告)。
- **Select**:**0 调用点** → 不动。
- **Skeleton**:迁新 token(workspace 骨架屏用,Wave 2;顺手迁)。

**跨波影响(已记录、可接受)**:workspace/dissect 的 Button/Dialog 会**提前变新**(API 没变照常跑)→ Wave 2/3 开发期它们呈「按钮新·布局旧」半新态,各波修各自路由即解决。与 Wave 0 `fontFamily.sans` 全局翻转同源,均为基础层 app-wide 推进,不破坏可运行性。

### 2.2 AppSidebar:**原地重写**(已定)

现有 `components/layout/AppSidebar.tsx`(w-60=240px、老 token、emoji/Icon 混用)→ Token Spec §3.1(200px、新 token、Lucide 图标、激活态 2px 指示条 + `accent-primarySoft` 填充)。**仅** library/knowledge/settings 使用(workspace 用 IconRail、dissect 单栏无 sidebar)→ 影响**严格限于 Wave 1**。保留 4 个导航项(小说库/知识库/拆解/设置)与登出。

### 2.3 每路由做法:**演进对齐帧**(已定)

演进现有组件去对齐 Pencil 帧,**不 greenfield 重写**:token 迁移 + 换用新原子(Card/Badge/CollapsibleCard)+ 结构按帧调整。Token Spec 帧 = 每路由验收靶(`get_screenshot` 比对)。

---

## 3. 任务切片(依赖排序,每步独立可验证)

| 步 | 内容 | 验收 |
|----|------|------|
| **W1-0** | 共享原子内部 token 迁移(Button 加 `gradient`/`soft` 变体)+ Skeleton/Textarea | `pnpm validate` 绿;现有路由不崩;`/dev/tokens` 上新增原子变体可渲染 |
| **W1-1** | AppSidebar 重写到 Token Spec §3.1 | library/knowledge/settings 三页 sidebar 对齐帧 03/07/12 |
| **W1-2** | Auth(login/register)对齐帧 01/02 | 截图比对;Input/Button 全新 token |
| **W1-3** | Library(NovelLibrary/NovelCard/PublishDialog + 空/卡片菜单)对齐帧 03-06 | 截图比对;卡片菜单 + 发布弹窗可交互 |
| **W1-4** | Knowledge 对齐帧 07 | 截图比对 |
| **W1-5** | Settings(ModelSettings/AgentModelSettings + 4 弹窗)对齐帧 12-16 | 截图比对;Vendor/Model/AgentModel/VoiceProfile 表单可开 |
| **W1-Gate** | 硬门:`grep` Wave 1 路由文件零老 token;`pnpm validate` 绿;运行时冒烟 | 见 §4 |

**顺序理由**:W1-0 是依赖根(所有路由用原子);W1-1(AppSidebar)先做以备 W1-3/4/5;auth 最简单先暖手;library 最大放中间;settings 表单最重放后。

---

## 4. 验证

agent-ui 无 test runner,沿用 Wave 0 验证范式:

- **自动门**:每步 `pnpm validate`(lint+prettier+typecheck)绿。
- **视觉验收**:每路由对齐帧后,Pencil 帧 `get_screenshot` → 渲染结果(Playwright 截图)人工比对。
- **硬门(W1-Gate)**:Wave 1 路由文件必须**零老 token 引用**。老 token 类名是:`bg-brand`、`bg-background`、`bg-background-secondary`、`bg-primary`、`text-primary`、`text-muted`、`border-primary`,以及**扁平** `bg-accent` / `hover:bg-accent`(注意:新命名空间 `bg-accent-primary` / `bg-accent-primarySoft` / `bg-accent-violetLight` … 是**新 token,不算违规** —— grep 必须用分隔符锚定区分二者,例如 `bg-accent(?:\s|"|'|$|/)` 只匹裸 `bg-accent`,不匹 `bg-accent-…`)。`bg-destructive`/`bg-success` 等功能色不算老 token(值未变)。检查范围:`agent-ui/src/app`、`agent-ui/src/components/{layout,library,knowledge,settings,auth}`。命中只许出现在 workspace/dissect 组件里。
- **运行时冒烟**:login → library(空/有数据)→ 卡片菜单 → 发布弹窗 → knowledge → settings(开 Vendor/Model 表单)全跑通,业务层零回归。

---

## 5. 不做(边界)

- 不动 workspace(`/novels/[id]`)、dissect(`/dissect`)路由结构(它们的 sidebar/按钮会因共享原子重接而变新,但路由本身不 reskin —— 留 Wave 2/3)。
- 不删老 token 定义(`brand`/`background`/`primary` 等仍留在 tailwind config,workspace/dissect 还在用)→ Wave 3 清剿。
- 不改业务层(api/store/hooks/流式逻辑)。
- 不引入新 shadcn 原子(Token Spec 不需要的)。
- `/dev/tokens` 页保留(Wave 3 删);W1-0 可顺带补上新增 Button 变体的展示。

---

## 6. 后续

1. `superpowers:writing-plans` 把 W1-0..W1-Gate 拆成分步实施计划(每步文件级改动清单 + 验收命令 + 帧截图比对步骤)。
2. 按步执行,每步过验证门 + 帧比对后才进下一步。
3. W1-Gate 通过后,Wave 1 收尾(合并),再启 Wave 2(workspace)brainstorm。
