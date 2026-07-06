# 世界观模块视觉重做(roster 折叠 + 单条展开)

> **For agentic workers:** 配套 plan:[2026-07-06-worldview-view-redesign.md](../plans/2026-07-06-worldview-view-redesign.md)。纯 FE 改动,零 server / DB / agent。

## 背景

[WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx) 当前世界观面板"太单调",5 条具体表现:

1. **8 个 type 分组长得一模一样** —— concept/powerSystem/rule/location/faction/race/item/history 仅靠 9pt 灰字标签("力量体系 · 2")区分,没有色彩、没有图标。
2. **条目无类型辨识** —— 「斗气等级」(机制)和「乌坦城」(空间)的视觉权重完全相同,丢失 type 语义。
3. **无概览** —— 一打开就是一堆卡,不知道总共多少条目、哪类多、最近更新到第几章。
4. **展开态纯 markdown 文字堆** —— 没有任何 type 视觉锚点(header 也只是个 chevron + 名字)。
5. **跟改版前的角色模块一个模子** —— 灰卡海,层级倒挂。

## Pencil 设计(已完成)

| 帧 | ID | 用途 |
|---|---|---|
| R3 世界观 v2 [roster] | `wJNpY` | 折叠态:概览条 + 5 type 分组(跨 3 族色)+ 7 条目卡 |
| R3 世界观 v2 [展开] | `nJZHq` | 斗气等级全展开:概述 tint + 等阶 grid + 备注 + meta |

新增 design variables:`family-power`(#F59E0B amber)、`family-power-soft`(#F59E0B26)、`family-world`(#10B981 emerald)、`family-world-soft`(#10B98126)。设定系复用 `accent-primary`/`accent-primarySoft`(indigo)。

## 方案:3 族色 + 8 type 图标

把 8 个 `WorldEntryType` 按语义归为 3 族(避免 8 色彩虹噪音),每族一色;每个 type 仍有专属 lucide 图标做精细辨识:

| type | label | 族 | 图标(lucide) |
|---|---|---|---|
| `concept` | 设定 / 总览 | lore(indigo) | Scroll |
| `history` | 历史 / 传说 | lore(indigo) | Clock |
| `powerSystem` | 力量体系 | power(amber) | Zap |
| `rule` | 规则 / 禁忌 | power(amber) | Scale |
| `item` | 物品 / 资源 | power(amber) | Gem |
| `location` | 地点 | world(emerald) | MapPin |
| `faction` | 势力 / 组织 | world(emerald) | Flag |
| `race` | 种族 / 生物 | world(emerald) | Dna |

### 数据扩展(类型层,零 DB)

[`WorldEntry`](agent-ui/src/types/novel.ts) 已有 `{ id, novelId, type, name, content }` —— **零类型改动**。无新字段。

### `TYPE_META` + `FAMILY_COLOR` 映射(新增常量)

```ts
const TYPE_META: Record<WorldEntryType, { label: string; icon: LucideIcon; family: FamilyKey }> = {
  concept:    { label: '设定 / 总览', icon: Scroll,  family: 'lore' },
  history:    { label: '历史 / 传说', icon: Clock,   family: 'lore' },
  powerSystem:{ label: '力量体系',   icon: Zap,     family: 'power' },
  rule:       { label: '规则 / 禁忌', icon: Scale,   family: 'power' },
  item:       { label: '物品 / 资源', icon: Gem,     family: 'power' },
  location:   { label: '地点',       icon: MapPin,  family: 'world' },
  faction:    { label: '势力 / 组织', icon: Flag,    family: 'world' },
  race:       { label: '种族 / 生物', icon: Dna,     family: 'world' }
}

const FAMILY_COLOR: Record<FamilyKey, { color: string; soft: string }> = {
  lore:  { color: 'accent-primary', soft: 'accent-primarySoft' },
  power: { color: 'family-power',   soft: 'family-powerSoft' },
  world: { color: 'family-world',   soft: 'family-worldSoft' }
}

type FamilyKey = 'lore' | 'power' | 'world'
```

(实际 Tailwind class 用 `bg-accent-primarySoft` / `bg-family-powerSoft` 等 —— 见下 token 层。)

### `TypeIconBox` 组件(新增)

26x26(折叠)/ 34x34(展开)圆形:族 soft 底 + 居中 type 图标(族色)。

### 折叠卡

左 2-3px 族色带 + TypeIconBox + name + essence + chevron-right。沿用现 `essence(content)` 工具(取首行去 markdown 截 60 字)。

### 展开卡

1. **Header**:TypeIconBox(md)+ name(text-lg 600)+ type 徽章(族 soft pill + 族色 label)+ chevron-down。
2. **概述块**(族 tint,可选):仅当 content 非空时,extract 首段做 tint 块。**或者**直接用 tint header 包 MarkdownRenderer —— 见 plan 决策(优先 tint 概述 + markdown body 分离)。
3. **正文**:`MarkdownRenderer(content)` —— worldview 内容真的需要 markdown(列表/标题/加粗结构化数据),保留。
4. **meta 尾**(可选,弱信号):关联/出处 —— **本期不做**(无数据源,Pencil 里是装饰;留给未来加 `WorldEntry.references` 字段时再做)。

> **范围限定**:Pencil `nJZHq` 里的「等阶梯队 grid / 备注 bullets」是示意(基于 `斗气等级` 这一条 powerSystem 内容的视觉化),**本期不做 type 专属结构化渲染**(`WorldEntry.content` 是自由 markdown,无法解析成 grid)。本期展开态 = header(tint)+ markdown body。type 专属结构化留作未来增强(需 schema 扩展或前端解析约定)。

### 概览条(新增,面板顶部)

`X 条目 · Y 类型 · 第N章 更新`。X = `entries.length`;Y = 不同 type 的数量;N = 暂用 `entries.length > 0 ? '有' : '无'`(WorldEntry 无章节关联字段,无法精确到章 —— 用条目数或省略)。**简化**:只显 `X 条目 · Y 类型`,不显章号(无数据源)。

### type 分组标签

族色点 + type 图标(小)+ label + count,替换现灰字 `<p>`。

## FE 实现映射(单文件 + token 层)

[WorldviewView.tsx](agent-ui/src/components/workspace/views/WorldviewView.tsx) + [tailwind.config.ts](agent-ui/tailwind.config.ts) + [globals.css](agent-ui/src/app/globals.css)。

| 区域 | 改动 |
|---|---|
| `globals.css` | 加 `--family-power` / `--family-power-soft` / `--family-world` / `--family-world-soft` 4 个 CSS 变量 |
| `tailwind.config.ts` | 新 `family` 命名空间(`power`/`powerSoft`/`world`/`worldSoft`) |
| `WORLD_TYPE_LABEL` | 改 `TYPE_META` map(type → {label, icon, family}) |
| 新增 `FAMILY_COLOR` map | 族 → {color, soft} |
| 新增 `FAMILY_BG`/`FAMILY_FG`/`FAMILY_BAND` | JIT-safe 字面量 map(沿用 character 范式) |
| 新增 `TypeIconBox` 子组件 | props: type, size |
| 新增 `OverviewBar` | props: entries |
| 折叠卡 JSX | 重写:加 TypeIconBox + 左族色带 |
| 展开卡 JSX | header 重写(图标 + 徽章)+ 概述 tint 块 + MarkdownRenderer body |

### Tailwind token 命名

- 新增 `family` 命名空间:`family.power` (#F59E0B) / `family.powerSoft` (#F59E0B26) / `family.world` (#10B981) / `family.worldSoft` (#10B98126)。
- 复用:`accent.primary` / `accent.primarySoft`(lore 族)。
- class 形式:`bg-family-powerSoft` / `text-family-power` / `border-l-family-power`(等)。

## 不在范围

- **DB / server / agent / 类型** —— 零改动。`WorldEntry` 不加字段。
- **type 专属结构化渲染**(powerSystem 等阶 grid / location 危险度 / rule 严重度)—— 需 schema 扩展或解析约定,本期不做(Pencil `nJZHq` 仅示意)。
- **meta 尾(关联/出处)** —— 无数据源。
- **手动条目 CRUD** —— agent 仍为唯一作者。
- **搜索 / 筛选 / 排序** —— 不做。
- **大纲 / 角色 / 章节等其它资源面板** —— 不动。
- **Pencil 帧归档** —— `wJNpY` / `nJZHq` 就位,原 `pys9p` 保留对照。

## 验证

1. `pnpm --dir agent-ui validate`(lint + format + typecheck)全过。
2. `pnpm --dir agent-ui dev` 打开 `/novels/:id` 右侧世界观 tab:
   - **概览条**:`X 条目 · Y 类型`。
   - **type 分组**:每组有族色点 + type 图标 + label + count。3 族色清晰可辨(设定 indigo / 力量 amber / 世界 emerald)。
   - **折叠卡**:左族色带 + TypeIconBox(type 图标)+ name + essence + chevron。
   - **展开卡**:header(TypeIconBox + name + type 徽章)+ 概述 tint 块 + markdown body。
3. 对比 Pencil 帧:折叠对 `wJNpY`,展开对 `nJZHq`(注意:`nJZHq` 的等阶 grid 是示意,本期实现用 markdown body)。

## Pencil 帧参考

- 折叠 roster:`wJNpY`(R3 世界观 v2 [roster])
- 单条展开:`nJZHq`(R3 世界观 v2 [展开])
- 设计变量:`family-power` / `family-power-soft` / `family-world` / `family-world-soft`(本 spec 新增)
