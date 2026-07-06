# 角色模块视觉重做(roster 折叠 + 单卡展开)

> **For agentic workers:** 配套 plan:[2026-07-06-character-view-redesign.md](../plans/2026-07-06-character-view-redesign.md)。纯 FE 改动,零 server / DB / agent。

## 背景

[CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx) 当前角色面板"太单调",6 条具体表现:

1. **角色无辨识度** —— 林动、萧炎、药老 三个卡长得一模一样:灰底(`bg-card-elev`)+ 名字 + chevron。没有头像、没有 role 色彩、没有首字母色块。一屏 10 个角色糊成一片灰。
2. **层级倒挂** —— 主角/反派/配角 仅靠一行 9pt 灰字("主角 · 1")区分,反而比下面的角色卡还弱。对比大纲的"总纲 tint > 卷框 > 弧"三层,R2 完全没分层。
3. **role 不染色** —— 主角 indigo、反派 rose、配角 violet 这种天然语义色一点没用上。
4. **展开态全文字堆** —— "档案 / 当前态 / 变化时间线"三段,字段都是"标签:值"一行行排列。**弱点(flaw)、弧光目标(arcGoal)** 这种角色"灵魂"字段,跟阵营、外貌一个视觉权重,完全埋没。
5. **变化时间线没时间感** —— 倒序文字"第N章 能力:觉醒龙脉之力"。MAJOR 只一个小 ★,没有节点/chapter badge。
6. **无概览** —— 一打开就是一堆卡,没有"X 角色 / Y MAJOR / 最近 第N章"这种 at-a-glance 锚点。

## Pencil 设计(已完成)

| 帧 | ID | 用途 |
|---|---|---|
| R2 角色 v2 [roster] | `ReT0F` | 折叠态:概览条 + 3 role 分组(主角/反派/配角)+ 4 个新设计折叠卡 |
| R2 角色 v2 [展开] | `wR61w` | 林动单卡全展开:header + 弱点 + 弧光 + 档案 + 当前态 + 时间线 |

新增 design variables:`role-ant`(#F43F5E rose)、`role-ant-soft`(#F43F5E26)、`accent-violet-soft`(#8b5cf626)。复用 `accent-primary`/`accent-primary-soft`(主角 indigo)、`accent-violet`(配角 violet)。

层级统一为:**概览条(overlay-5 底)> role 分组(色点 + 标签)> 角色卡(bg-card-elev + 左 role 色带 + avatar)> 展开态内块(tint 块 / chip grid / 时间线节点)**。与大纲那波"总纲 tint > 卷框 > 弧"是同一套语言(role 色带 = 弧色带范式复用)。

## 方案

### 数据扩展(类型层,零 DB 改动)

[Character](agent-ui/src/types/novel.ts) 已有所有需要的字段:`name` / `aliases` / `role` / `faction` / `background` / `appearance` / `personality` / `motivation` / `arcGoal` / `voice` / `growth` / `flaw` / `changes` / `currentState`。**零类型改动**。

`getCharacters` 返回的 `Character[]` 直接喂新组件。

### Role 色彩映射(新增常量)

新 `ROLE_COLOR` map 替代现 `ROLE_LABEL`:

```ts
const ROLE_COLOR: Record<CharacterRole, { label: string; color: string; soft: string }> = {
  PROTAGONIST: { label: '主角', color: 'accent-primary', soft: 'accent-primarySoft' },
  ANTAGONIST:  { label: '反派', color: 'role-ant',       soft: 'role-antSoft' },
  SUPPORTING:  { label: '配角', color: 'accent-violet',  soft: 'accent-violetSoft' }
}
```

实际 Tailwind class 用 `border-accent-primary` / `bg-accent-primarySoft` 等(见下"Tailwind class 名"说明)。

### Avatar 组件(新增)

圆形 28px(折叠)/ 34px(展开),`bg-{role-soft}` 底 + 居中首字母(`text-{role-color}`,fontSize 13/16,fontWeight 600)。首字母取 `name[0]`。

### 折叠卡(roster 态)

每张折叠卡:[左 2-3px role 色带] + [avatar] + [name + aliases chip + essence 行] + [chevron-right]。

essence 行 = `性格:${personality} · 动机:${motivation}`(沿用现折叠卡逻辑)。

### 展开卡(单卡展开态)

展开卡结构(对照 Pencil `wR61w`):

1. **Header** —— avatar(34)+ name(text-lg 600)+ role badge(role-soft pill + role 色字)+ aliases + chevron-down。
2. **弱点块**(rose tint,`bg-role-antSoft` 圆角块)—— skull 图标 + "执念 · 弱点" 标签(role-ant 色)+ `flaw` 文本。仅 `flaw` 有值时渲染。
3. **弧光目标块**(indigo tint,`bg-accent-primarySoft`)—— target 图标 + "弧光目标" 标签(indigo)+ `arcGoal` 文本。仅 `arcGoal` 有值时渲染。
4. **档案** —— 短字段 2-col chip grid(阵营/语言风格/性格基调/执念·动机)+ 长字段堆叠(出身背景/成长经历/外貌)。沿现 `PROFILE_FIELDS` 但重排顺序:弱点/弧光已上提,档案里只留剩余字段。
5. **当前态** —— label "当前态 · 第N章"(N = 最新 changes 的 chapterOrder)+ 横排 state chips(每个 chip:`field` 标签 + `value`,overlay-10 pill 底)。沿用现 `currentState` entries(过滤 appearance)。
6. **变化时间线** —— label "变化时间线 · N 条" + 倒序节点列表。每个节点:实心 indigo 圆点(MAJOR)/ 空心圆点(minor)+ "第N章" + ★ MAJOR badge(仅 MAJOR)+ `field: value` + → reason(有 reason 时)。

### 概览条(新增,面板顶部)

`X 角色 · Y MAJOR · 第N章 最近` 一行,overlay-5 pill 底。X = `chars.length`;Y = 所有角色 `changes` 中 `significance === 'MAJOR'` 的计数;N = 所有 changes 中最大 chapterOrder。

## FE 实现映射(单文件)

[CharactersView.tsx](agent-ui/src/components/workspace/views/CharactersView.tsx):

| 区域 | 改动 |
|---|---|
| `ROLE_LABEL` 常量 | 改 `ROLE_COLOR` map(role → label/color/soft) |
| `FIELD_LABEL` 常量 | 保留(时间线/当前态仍用) |
| `PROFILE_FIELDS` | 重排:`flaw`/`arcGoal` 从数组里**移除**(它们升级到独立 tint 块);剩余 `background`/`growth`/`appearance`/`personality`/`motivation`/`voice`/`faction` 中,前 4 个短字段进 chip grid,后 3 个长字段堆叠 |
| 新增 `Avatar` 子组件 | props: name, color, soft, size |
| 新增 `OverviewBar` | props: chars |
| 折叠卡 JSX | 重写:加 Avatar + role 色带(`border-l-2 border-{role}`)+ aliases chip + essence |
| 展开卡 JSX | header 下方依次插入:Weakness 块 / ArcGoal 块 / 档案(chip grid + 长字段)/ 当前态(chips)/ 时间线(节点 + dots) |

### Tailwind class 名(自定义 token)

narratox agent-ui 的 Tailwind 自定义 token 用 camelCase 实际 class:
- `bg-bg-cardElevated`(卡底,#27272A)
- `bg-accent-primarySoft`(indigo 26% alpha,主角 tint)
- `bg-overlay-5` / `bg-overlay-10`(chip 底)
- `border-accent-indigoLight`(弧色带同款,主角用)
- `text-text-primary` / `text-text-secondary` / `text-text-tertiary` / `text-text-label`
- `text-accent-indigoLight`(主角/indigo 强调)

**新需 token**:`role-ant`(rose #F43F5E)/ `role-antSoft`(rose 26%)。需要扩 [tailwind.config](agent-ui/tailwind.config.ts) 的 colors(role-ant / role-antSoft)。`accent-violet`/`accent-violetSoft` 视现有 config 是否已定义,若缺则同款补。

具体 token 名以 [tailwind.config.ts](agent-ui/tailwind.config.ts) 现有结构为准(subagent 实施时先读 config 确认命名风格再落地)。

## 不在范围

- **DB / server / agent / 类型** —— 零改动;纯 FE。
- **手动角色 CRUD** —— 沿用现状(agent 是角色唯一作者,无手动增删改 UI)。
- **头像图片 / 真人立绘** —— 仅首字母色块(不引入图片资产)。
- **搜索 / 筛选 / 排序** —— 角色数量级小(单本通常 <30),不需要。
- **双栏(列表 + 详情)** —— 420px 窄面板不适配,明确不做(诊断里已排除)。
- **大纲 / 章节 / 伏笔等其它资源面板** —— 不动。
- **Pencil 帧最终归档** —— 设计稿就位(`ReT0F`/`wR61w`),不删不改原 `tWRcf`(保留对照)。

## 验证

1. `pnpm --dir agent-ui validate`(lint + format + typecheck)全过。
2. `pnpm --dir agent-ui dev` 打开 `/novels/:id` 右侧角色 tab:
   - **roster 态**:每张卡有 avatar(首字母 + role 色底)+ 左 role 色带 + 名字 + aliases chip + essence + chevron。3 个 role 分组有色点。头部概览条显示 X 角色 · Y MAJOR · 第N章。
   - **展开态**:点林动 → 展开显示 弱点(rose tint)/ 弧光(indigo tint)/ 档案(chip grid + 长字段)/ 当前态(chips)/ 时间线(节点 + MAJOR/minor 区分)。
   - role 染色:主角 indigo / 反派 rose / 配角 violet 三色清晰可辨。
3. 对比 Pencil 帧:折叠对 `ReT0F`,展开对 `wR61w`。

## Pencil 帧参考

- 折叠 roster:`ReT0F`(R2 角色 v2 [roster])
- 单卡展开:`wR61w`(R2 角色 v2 [展开])
- 设计变量:`role-ant` / `role-ant-soft` / `accent-violet-soft`(本 spec 新增)
