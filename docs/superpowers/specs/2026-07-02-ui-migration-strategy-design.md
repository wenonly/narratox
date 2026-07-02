# Narratox UI 迁移策略与实施设计

> **范围**:本规范决定「**如何**把现有 `agent-ui` 前端迁到 `design/narratox.pen` 的新设计」,不是设计稿本身。设计 tokens / 视觉规范 / 帧清单的权威来源是姊妹文档 [2026-07-02-ui-redesign-design.md](./2026-07-02-ui-redesign-design.md)(下称 **Token Spec**)。两者冲突时,Token Spec 的 token 表胜;本规范只管迁移路径、切片、清理边界、验证与风险。

**决策日期**:2026-07-02。**决策方式**:superpowers brainstorming。

---

## 1. 背景与现状

### 1.1 三层现状

| 层 | 状态 | 结论 |
|----|------|------|
| **设计层**(`design/narratox.pen`) | 38 帧 + 2 可复用组件(`AppSidebar`/`IconRail`),1440×900,已用变量系统(`$bg-base`/`$accent-indigo-lt`/…),Token Spec 完整 | **已建成,质量高,是源** |
| **代码业务层**(`agent-ui` 的 api/hooks/store/auth/streaming) | 47 组件 / 7 路由全跑通;API 层(novels/auth/settings/knowledge/benchmark)+ 流式解析(`useAIResponseStream`/`useAIStreamHandler`)+ Zustand store + JWT auth + nuqs 会话 | **扎实,必须保留** |
| **代码表现层**(tokens + 样式) | 与设计严重脱节(见下表) | **真正的 gap,本次工作对象** |

### 1.2 表现层 gap(tokens / 字体 / 效果)

| 维度 | 现状代码 | 设计稿(Token Spec §1) |
|------|----------|------------------------|
| 主色 | `brand #FF4017`(橙红) | Indigo→Violet `#6366f1→#8b5cf6` 渐变 |
| 背景 | `#111113` / `#27272A` 两级 | `#0a0a0b` / `#13131a` / `#1A1A22` / `#2A2A35` 多级 |
| 字体 | Geist | Inter |
| 效果 | 无 | 玻璃拟态(background_blur 20 + shadow 24) |
| Sidebar / IconRail | 240px / 48px | 200px / 56px(以设计为准) |

现状 token 定义见 `agent-ui/tailwind.config.ts`,现状全局样式见 `agent-ui/src/app/globals.css`。

---

## 2. 战略选择:增量改造现有项目(已定)

brainstorming 阶段评估了三条路径:

| 方案 | 取舍 | 结论 |
|------|------|------|
| **① 增量改造现有项目** | 保留 Next.js + 全部业务层,只动表现层;靠「新老 token 并存」做安全过渡 | **采用** ⭐ |
| ② 推倒重来(greenfield 新项目) | 为零功能收益重写几个月基建,第二系统陷阱;只在想换框架/业务层也烂了才值得 | 否决 |
| ③ 同项目内并行 `/v2` 路由树 | 老 UI 兜底但过渡期维护两套;① 的 token 并存已内嵌其安全过渡优势 | 否决(① 已足够) |

**采用 ① 的依据**:本次动机 = 「视觉换肤 + 顺带清理结构」(非技术栈错误、非业务层崩坏);业务层有价值且工作正常;① 的 token 并存技巧天然满足「每阶段可跑可验证」。

---

## 3. 架构与边界

### 3.1 Token 并存策略(核心机制)

**目标**:让新 token 体系与旧 token 体系在过渡期共存,逐路由迁移,最后清剿旧 token。任一时刻应用都能跑。

**步骤**:
1. **新增 CSS 变量层**:`agent-ui/src/app/globals.css` 的 `:root` 引入完整变量(`--bg-base`/`--bg-dark`/`--bg-card`/`--bg-card-elevated`/`--accent-primary`/`--accent-violet`/`--text-primary`/…),逐字段对齐 Token Spec §1。
2. **新增 Tailwind 嵌套命名空间**:`tailwind.config.ts` 的 `theme.extend.colors` 加 **嵌套结构**(`bg.{base,dark,card,cardElevated,raised}` / `accent.{primary,primarySoft,violet,violetLight,...}` / `text.{primary,body,secondary,tertiary,label,...}` / 功能色 `success`/`warning`/`destructive`/`info`),生成 `bg-bg-base` / `text-accent-primary` 等 class。**不覆盖**既有 `primary`/`brand`/`background` 键。
3. **旧 token 原地不动**:`brand #FF4017` 等保留,直到 Wave 3 证明零引用后才删。
4. **字体**:加 Inter(`next/font/google`),与 Geist 并存;新页面/迁移后的页面用 Inter。
5. **玻璃拟态工具类**:`globals.css` 加 `.glass-panel`(background_blur 20 + outer shadow offset(0,4) blur 24 `#00000080` + 半透明 bg),**仅在 Token Spec 指定的面板/弹窗用**(IconRail/ResourcePanel/Dialog 等),不滥用到每张卡。

**决策点(留到 Wave 0 验证)**:`bg-bg-base` 这类双前缀 class 偏丑。Wave 0 先按嵌套命名落地;若手感不顺,加一层轻别名(如把 `surface`/`brand-accent` 映射到对应变量)再决定。此项不影响整体架构,是实现细节。

### 3.2 原子组件清单(按 Token Spec §3,落 `agent-ui/src/components/ui/`)

| 组件 | 变体 | 对应 Token Spec |
|------|------|-----------------|
| `Button` | primary-gradient / secondary-border / ghost / destructive;pill / standard | §3.4 |
| `Card` | standard(`#1A1A22`) / elevated(`#2A2A35`) / gradient-cover(彩色封面) | §3.3 |
| `Tag` / `Badge` | accent / neutral / success / warning | §3.6 |
| `Input` / `Textarea` | 原生 `<input>`/`<textarea>` 封装(**不复用**聊天自增高的 `ui/textarea`) | §3.5 |
| `Dialog` | overlay `#00000080` + glass panel radius 14 + shadow 32 | §3.7 |
| `ActivityRow` | think(purple) / tool(blue) / content(brand/white) / stage(brand) 彩色行 | §3.8 |
| `CollapsibleCard` | 折叠/展开态,供世界观/大纲/角色等复用 | §3.3 衍生 |

保留仍合适的现有 shadcn/ui 原子;新原子层在其之上。

### 3.3 `design/` ↔ 代码同步规则

- `design/narratox.pen` 是 UI 源(CLAUDE.md 已钉死);**禁 Read/Grep `.pen`**,只用 Pencil MCP。
- **每路由的验收靶子** = 对应帧的 `get_screenshot`;迁移完用渲染结果与截图人工比对。
- tokens 若 `.pen` 变量(`get_variables`)与 Token Spec 表冲突,**Token Spec 胜**(CLAUDE.md 同样规则)。
- 不手改 `design/_exports/`;`.pen` 变动后用 `export_nodes`/`export_html` 重生成。

---

## 4. 分阶段切片(依赖/风险排序,每波独立可跑可验证)

用户要求「全量并行,顺序我不管,按依赖/风险排,每阶段能跑能验证」。波次如下,每波 = 一个 commit/PR 边界。

### Wave 0 — 地基(一切前置,阻塞后续所有波)

- 加 Inter 字体;加 CSS 变量 token 层;加 Tailwind 嵌套命名空间;加玻璃工具类 + 圆角/间距 scale。
- 建全部原子组件(§3.2)。
- **此波不动任何路由**,旧 token 照常工作。
- **验收**:`pnpm validate` 绿;原子组件能在临时/storybook 式页面渲染。
- **决策落地**:嵌套命名 vs 别名(§3.1 决策点)在此波定。

### Wave 1 — 共享 AppSidebar 的外围路由(低风险暖手)

- 先做/迁 `AppSidebar`(Token Spec §3.1,200px,`.pen` 已是可复用组件 `KFsEk`)。
- reskin:login/register(帧 01/02)、library 全态(03 main / 04 empty / 05 card-menu / 06 publish)、knowledge(07)、**settings 整路由**(12 main / 13 model dialog / 14 agent-model dialog / 15 voice editor / 16 empty —— 四个弹窗都用 Wave 0 的 `Dialog` 原子,随路由一起 reskin,不单列)。
- 每路由:旧 token → 新 token + 换新原子组件。
- **验收**:非工作区/非拆解路由全部对齐设计;`pnpm validate` 绿;端到端 login→library→settings 可跑;每帧截图比对。

### Wave 2 — 工作区核心(最大、结构清理在此)

- 做/迁 `IconRail`(Token Spec §3.2,56px,`.pen` 可复用组件 `kLUds`)。
- `ChatPanel`:ABCD 改造已半成(见 commit `7a06f76`),迁 token + 用新 `ActivityRow` + 玻璃输入框。
- `ResourcePanel` + 10 资源视图:结构清理见 §5.1。
- 覆盖帧 17-22(工作区状态)+ 23-30(资源面板视图)。
- **验收**:CONCEPT/ACTIVE/streaming/skeleton 全态 + 10 视图对齐设计;`pnpm validate` 绿;流式真机跑通(发一轮对话);每帧截图比对。

### Wave 3 — 拆解 + token 清剿(收尾)

- dissect(帧 08 main / 09 upload-confirm / 10 log-drawer / 11 result-browser)。
- **删旧 token**:`grep` 证明零引用后,从 `tailwind.config.ts` 移除 `brand #FF4017` 等老键与老 CSS 变量。
- **验收**:`pnpm validate` 绿;`grep` 零旧 token 引用;38 帧全量视觉扫一遍。

**顺序理由**:Wave 0 是依赖根;Wave 1 用更简单的 `AppSidebar` 路由把原子层练熟,降低 Wave 2(最复杂)风险;Wave 2 是核心放中间;Wave 3 最后,因「删旧 token」必须等所有路由迁完。

---

## 5. 结构清理范围(明确 IN/OUT,防 scope 蔓延)

用户选定「视觉 + 顺带清理结构」。范围如下。

### 5.1 IN(服务于本次改造的清理)

- **ResourcePanel 10 视图统一拆成独立文件**:`InfoView` / `WorldviewView` / `OutlineView` / `ChaptersView` / `CharactersView` / `HooksView` / `EventsView` / `OverviewView` / `ReferencesView` / `VoiceProfileView`。已有独立文件的(`ReferencesView`/`VoiceProfileView`)作为模式标杆,其余对齐。重复的「折叠卡」「分区头」抽成 `CollapsibleCard` 等原子。
- **抽 `ActivityRow`**:从 chat `Messages` 里抽出 think/tool/content/stage 行 → 聊天 + 拆解日志抽屉(LogDrawer)共用。
- **全量 token 迁移审查**:每个 `bg-background`/`text-brand`/`border-...` 审查并迁到新命名空间。

### 5.2 OUT(明确不做,边界化)

- 不动 Zustand store 结构。
- 不动 API 层(`src/api/*` routes/clients)。
- 不动 `useAIStreamHandler` / `useAIResponseStream` 逻辑(只改它的渲染输出)。
- 不加 Token Spec 不需要的新 shadcn 原子。
- 不改路由结构。
- 手动角色编辑/删除 UI 仍 deferred(CLAUDE.md 已记录)。
- 不重写业务层任何部分。

---

## 6. 验证方式

`agent-ui` **无测试 runner**(CLAUDE.md 钉死,无 Jest/Vitest/Playwright)。质量门是 `pnpm validate`。故:

- **自动门**:每波后 `pnpm validate`(lint + prettier + typecheck)必须绿。
- **视觉验收**:每帧 `get_screenshot` `.pen` 帧 → 渲染路由人工比对;`.pen` 帧是验收靶。
- **运行时冒烟**:每波后手跑关键路径(login → library → 开小说 → workspace → 发一轮流式 → dissect 上传),确认未动的业务层零回归。
- **token 清剿门**:Wave 3 末 `grep` 零旧 token 引用(`brand`、老 `background-secondary` 用法、老 CSS 变量等)。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| Token 并存混淆(误混用新旧) | Wave 3 `grep` 强制清剿兜底;迁移文档明确「新页面禁用旧 token」 |
| 嵌套命名丑(`bg-bg-base`) | Wave 0 验证并定(接受或加别名) |
| 玻璃 blur 性能(blur 20 重) | 仅在 Token Spec 指定的面板/弹窗用,不全卡都 blur |
| 10 视图重构引 bug | 先「行为不变只拆文件」再 reskin,每视图单独验数据绑定 |
| 单波出问题 | 每波 = 独立 commit/PR 边界;token 并存意味回滚单波不会让 app 半迁移崩坏 |

---

## 8. 后续步骤

1. **Step 2**:调用 `superpowers:writing-plans`,把 Wave 0-3 拆成分步实施计划(每波再细化为可执行 task,含文件级改动清单与验收命令)。
2. 按 Wave 顺序执行,每波结束跑验证门 + 截图比对后才进下一波。
3. `.pen` 有变动时同步刷新 `design/_exports/`。
