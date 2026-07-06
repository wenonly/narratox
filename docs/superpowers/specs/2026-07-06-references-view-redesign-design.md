# 参考资料面板视觉重做(injectTo 分组 + 色带 + 可展开)

> **For agentic workers:** 配套 plan:[2026-07-06-references-view-redesign.md](../plans/2026-07-06-references-view-redesign.md)。纯 FE 改动,**零 server / DB / agent / 类型 / API**(NovelReference 已有全部字段)。

## 背景

[ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx)(142 行)是工作区右侧第 6 个 tab「参考资料」(NavTabs key=`references`,Library 图标)。当前 5 个问题(对照已重做的角色/世界观/伏笔-事件):

1. **两节就是两个 9pt 灰字标题 + 一模一样的灰卡海** —— `已关联 · N` / `资料库索引 · N` 仅靠灰字标签区分,无视觉分层(跟角色/世界观改版前同款病)。
2. **`injectTo` 语义丢了** —— 现状只做两节切分(`injectTo != null` → 已关联;`null` → 库索引),但**完全没可视化 `injectTo` 的值**(`main` / `writer` / `both` / 任意角色名 —— Phase 17 curator 资料系统写活后这是核心信息)。「注入 main」和「萧炎专属」长得一模一样。
3. **`category` 完全没用** —— `NovelReference.category`(自由字符串:方法论/词汇/人设/创作须知…)在 UI 上完全缺席,丢失类型语义。
4. **无概览条** —— 一打开就卡列表,不知道总共多少条、多少已关联、多少库索引。
5. **展开态纯 markdown 文字堆** —— 没有 injectTo tint 视觉锚点,看不出这条资料是「主动注入哪个 agent」还是「工具按需取」。

## Pencil 设计(已完成)

| 帧 | ID | 用途 |
|---|---|---|
| R5 参考资料 v2 [roster] | `G3G7Gu` | 概览条 + 4 injectTo 分组(跨 3 色)+ 8 条目卡(色带+TypeIconBox+category pill) |
| R5 参考资料 v2 [展开] | `j0NgD2` | 网文节奏 5 拍全展开:header + injectTo tint + 5 拍 body |

## 数据模型核对(已验证,零迁移)

[`NovelReference`](agent-ui/src/types/novel.ts)(Prisma [server/prisma/schema.prisma](server/prisma/schema.prisma) `model NovelReference`)已有全部字段:

| 字段 | 类型 | 用途 | 现状 |
|---|---|---|---|
| `title` / `content` | string | 标题 / markdown 正文 | ✅ 在用 |
| `injectTo` | `string \| null` | `'main'` / `'writer'` / `'both'` / 任意角色名 / `null` | ⚠️ 仅做两节切分,**未可视化值** |
| `category` | string(默认 `""`) | 自由文本:方法论/词汇/人设/创作须知… | ❌ **完全没用** |
| `source` | `string \| null` | 来源全局 KB id 的 JSON 串 | ❌ 不显(UI 价值低,留作未来) |
| `order` / `updatedAt` | number / Date | 排序 / 时间 | ❌ 没用(本期仍不显) |

**`injectTo` 取值语义**(Phase 17 curator 资料系统写活后):
- `'main'` —— 注入 main agent(编排者)上下文
- `'writer'` —— 注入 writer agent(正文写手)上下文
- `'both'` —— main + writer 都注入
- `<角色名>` —— 任意角色名字符串(Phase 17 放宽),作为该角色专属精要
- `null` —— 不主动注入,仅作为「资料库索引」供 agent 用 `get_reference` 工具按需拉取

**FE 无法知道角色名的 role**(主角/反派/配角 —— 那需要拉 characters 列表匹配),所以**角色专属组统一用 indigo**(同 main),靠分组标签的「<角色名> 专属」文本区分。不引入 characters 跨查询(避免复杂度)。

## 方案

### 视觉主轴:injectTo(稳定语义),不是 category(自由文本)

`injectTo` 是稳定语义(4 枚举 + 角色名),适合做色彩分层 + 分组;`category` 是 agent 写入的自由字符串(可能漂移、可能空),**不做主分类轴**,只做**辅助小标签**(有则显,不强映射图标)—— 这点与 worldview 的 8 type 精确映射不同。

### injectTo 色映射(复用现有 token,零新 token)

| injectTo | 含义 | 色带 / Icon | IconBox 底 | 分组图标 |
|---|---|---|---|---|
| `main` | 注入编排者 | `accent-primary`(indigo) | `accent-primarySoft` | `Sparkles` |
| `writer` | 注入写手 | `accent-violet` | `accent-violetSoft` | `PenTool` |
| `both` | main+writer | `accent-primary` | `accent-primarySoft` | `Layers` |
| `<角色名>` | 角色专属 | `accent-primary`(主角 indigo,不查 role) | `accent-primarySoft` | `User` |
| `null` | 库索引(工具按需取) | `text-label`(中性灰) | `overlay-10` | `Library` |

> 库索引用**中性灰** —— 语义区分「主动注入」(彩色)vs「工具按需取」(灰)。这是设计上的关键差异点。

### 分组结构(两大节 + 已关联内部按 injectTo 分组)

```
已关联(refs.filter(r => r.injectTo))     ← 按 injectTo 值 groupBy
  ├─ 注入 main · N        (indigo 点 + Sparkles)
  │   └─ 条目 x N
  ├─ 注入 writer · N      (violet 点 + PenTool)
  │   └─ 条目 x N
  ├─ 注入 main+writer · N (indigo 点 + Layers,若有)
  │   └─ 条目 x N
  └─ <角色名> 专属 · N    (indigo 点 + User,每个角色名一组)
      └─ 条目 x N
资料库索引(refs.filter(r => !r.injectTo))  ← 单节,中性灰
  └─ Library 图标 + 资料库索引 · N
      └─ 条目 x N
```

组顺序:main → writer → both → 各角色(按首次出现顺序)→ 库索引(末尾)。

### 折叠卡

左 2-3px injectTo 色带 + 26×26 TypeIconBox(injectTo soft 底 + injectTo 色 icon)+ 标题(text-sm 600)+ **category pill**(若 `category` 非空,overlay-10 底 + 9pt text-tertiary)+ 摘要(essence 9pt text-tertiary,首行去 markdown 截 60 字)+ chevron-right。

### 展开卡

1. **Header**:34×34 TypeIconBox + 标题(text-base 600)+ 副标题(category,若有)+ category/injectTo 徽章 + chevron-down。
2. **injectTo tint 块**(indigo soft 底,`CornerDownRight` 图标):「注入 `<injectTo 友好名>` · 写作时自动带入 `<目标>` agent 上下文」(库索引组无此 tint,改显「工具按需取 · agent 用 get_reference 拉取」)。
3. **Body**:`MarkdownRenderer(content)` —— 参考资料内容是真的 markdown(列表/标题/加粗),保留。

### 概览条(新增,面板顶部)

`X 条参考 · Y 已关联 · Z 库索引`。X = `refs.length`;Y = `refs.filter(r => r.injectTo).length`;Z = `refs.filter(r => !r.injectTo).length`。

## FE 实现映射(单文件,零 token 新增)

[ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx) 单文件重写。token 全部复用现有(`accent-primary` / `accent-primarySoft` / `accent-violet` / `accent-violetSoft` / `text-label` / `overlay-10` —— 角色模块 + 伏笔模块已建)。**`tailwind.config.ts` / `globals.css` 不动**。

| 区域 | 改动 |
|---|---|
| 新增 `INJECT_META` map | injectTo 值 → `{ label, band, soft, icon }`(main/writer/both/角色名/null 五类) |
| 新增 `BAND_CLASS` / `ICONBOX_BG` / `ICON_FG` | JIT-safe 字面量 map(沿用 character/worldview 范式,避免模板字符串 purge) |
| 新增 `OverviewBar` | props: refs |
| 新增 `groupByInjectTo(refs)` | 已关联按 injectTo 分组(保序)+ 库索引单组 |
| 新增 `Avatar`/`TypeIconBox` 子组件 | props: injectTo, size |
| 折叠卡 JSX | 重写:加色带 + TypeIconBox + category pill |
| 展开卡 JSX | 重写:header + injectTo tint + MarkdownRenderer body |

### injectTo 友好名(INJECT_META.label)

```ts
const INJECT_META: Record<string, { label: string; band: string; soft: string; icon: LucideIcon; tint: string }> = {
  main:   { label: '注入 main',  band: 'accent-primary', soft: 'accent-primarySoft', icon: Sparkles, tint: 'main agent(编排者)' },
  writer: { label: '注入 writer', band: 'accent-violet', soft: 'accent-violetSoft', icon: PenTool,  tint: 'writer agent(写手)' },
  both:   { label: '注入 main+writer', band: 'accent-primary', soft: 'accent-primarySoft', icon: Layers, tint: 'main + writer' },
}
// 角色名(任意字符串,不在上 map 里)→ 默认 { label: `${name} 专属`, band: 'accent-primary', soft: 'accent-primarySoft', icon: User, tint: `${name} 相关上下文` }
// null(库索引)→ { label: '资料库索引', band: 'text-label', soft: 'overlay-10', icon: Library, tint: null(改显「工具按需取」) }
```

`resolveInject(injectTo: string | null)` 纯函数:`null` → 库索引 meta;上 map 命中 → 对应 meta;否则 → 角色专属 meta(label 用 injectTo 字符串)。

## 不在范围

- **DB / server / agent / 类型 / API** —— 零改动。`NovelReference` 不加字段,`getNovelReferences` 不改。
- **`source` 字段 UI** —— KB id 的 JSON 串,UI 显示价值低(用户看 id 无意义),本期不显;留作未来加 KB 标题反查。
- **`order` / `updatedAt` UI** —— 本期不显(排序沿用 server 返回顺序)。
- **角色 role 色精确映射** —— 角色专属组统一 indigo,不跨查 characters(避免复杂度)。
- **手动条目 CRUD** —— agent(curator)仍为唯一作者。
- **搜索 / 筛选 / 排序** —— 不做。
- **其他资源面板**(角色/世界观/伏笔/事件/大纲/章节)—— 不动。
- **Pencil 帧归档** —— `G3G7Gu` / `j0NgD2` 就位,原 `CAu2k`(R5 旧)保留对照。

## 验证

1. `pnpm --dir agent-ui validate`(lint + format + typecheck)全过。
2. `pnpm --dir agent-ui dev` 打开 `/novels/:id` 右侧参考资料 tab:
   - **概览条**:`X 条参考 · Y 已关联 · Z 库索引`。
   - **已关联分组**:每组有 injectTo 色点 + 类型图标 + 友好名 + count。3 色清晰可辨(main indigo / writer violet / 角色名 indigo / 库索引中性灰)。
   - **折叠卡**:左色带 + TypeIconBox + 标题 + category pill(有则显)+ 摘要 + chevron。
   - **展开已关联卡**:header + **injectTo tint 块**(「注入 X · 写作时自动带入…」)+ markdown body。
   - **展开库索引卡**:header + 「工具按需取」tint(非 injectTo tint)+ markdown body。
   - `category` 为空的条目:不显 category pill(不强行塞默认值)。
3. 对比 Pencil:roster 对 `G3G7Gu`,展开对 `j0NgD2`。

## Pencil 帧参考

- roster:`G3G7Gu`(R5 参考资料 v2 [roster])
- 展开:`j0NgD2`(R5 参考资料 v2 [展开])
