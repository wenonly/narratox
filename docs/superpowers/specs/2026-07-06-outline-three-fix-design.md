# 大纲面板三处修正(总纲折叠 / 卷框升级 / 弧进度条)

> **For agentic workers:** 配套 plan:[2026-07-06-outline-three-fix.md](../plans/2026-07-06-outline-three-fix.md)。纯 FE 改动,零 server / DB / agent。

## 背景

[OutlineView.tsx](agent-ui/src/components/workspace/views/OutlineView.tsx) 当前有三处问题(用户反馈):

1. **总纲太长** —— Master 块(`data.master`)的字段(theme / mainLine / ending / powerProgression / hiddenLines / threeAct)全部平铺展开,长篇会把整个面板顶下去,挤掉卷/弧的视野。
2. **卷标题素** —— 卷分组(`<div className="flex flex-col gap-2">`)是裸 text + 行间距,无背景/边框/图标。视觉权重反而低于它内部的弧卡(弧卡有 `overlay-5` 底 + 左 indigo 色带 + git-branch 图标)。卷是弧的父级,层级倒挂。
3. **弧 5 个点的规律不对** —— 弧卡右上角 `BeatDots` 渲染 5 个圆点,代码:
   ```ts
   const written = plans.filter((p) => p.status === 'WRITTEN').length
   const beats = Math.min(5, written)
   ```
   注释说是「5 拍单元循环(麻烦→尝试→意外→解决→成长)」,实现却是「已写章数封顶 5」。语义错位:弧有 12 章时显示 `4/12` + 4 个亮点,用户看着像比例但 5 格装不下 12,规律不明。

## Pencil 设计(已完成)

| 帧 | ID | 用途 |
|---|---|---|
| R1 大纲(折叠态) | `ZOkpY` | 默认态:Master 摘要一行 + chevron-down + 卷框 + 弧连续进度条 |
| R1 总纲展开 | `s9477h` | 展开态:Master 全字段(theme/mainLine/ending/power/hidden/三幕,二幕末·灵魂黑夜 indigo 高亮) + chevron-up |

层级统一为:**总纲(indigo tint,最强) > 卷(`bg-card-elev` 深实底 + book 图标,中) > 弧(`overlay-5` 浅底 + 左 indigo 色带 + 进度条,轻) > 章卡(最轻)**。

## 方案

### Fix 1:总纲折叠/展开

- Master 块加本地 `useState<boolean>` 折叠态,**默认折叠**(`false`)。
- **折叠态**:一行摘要 —— `${theme} · ${ending}`(theme / ending 任一存在才显示;两个都没有则不渲染 Master 块,与现状一致)。
- **展开态**:全字段(theme / mainLine / ending / powerProgression / hiddenLines / threeAct),其中**二幕末·灵魂黑夜**(`threeAct.act2Turn`)用 `text-accent-indigoLight` 高亮(与代码现状一致,只是放进展开态)。
- 整个 Master 标题行是 `<button>`,点击切换 `masterOpen`。右侧 `ChevronDown` / `ChevronUp` 图标做视觉指示。
- 折叠态**不渲染**展开态字段(条件渲染,不是 CSS 隐藏)——保持 DOM 干净。

### Fix 2:卷框升级

卷容器(现 `<div className="flex flex-col gap-2">`)加:
- `rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2.5`

卷标题行(现 `<button className="flex items-center justify-between py-1 ...">`)加 `BookOpen` 图标(lucide)在 chevron 与标题之间。折叠/展开态都用同款框(不区分)。

> 说明:`bg-bg-cardElevated` 是 agent-ui Tailwind 自定义 token(`#27272A`,见 CLAUDE.md「UI primitives」)。代码里现有同款用法(如 ChapterPlanCard 的 `bg-bg-cardElevated`)。

### Fix 3:弧进度条

- **删 `BeatDots` 组件**(32-44 行)与 `ArcCard` 里的 `const beats = Math.min(5, written)`。
- 新增 `ArcProgress` 组件(同文件,挨着 `ArcCard`):
  ```tsx
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
- `ArcCard` 标题行右侧:用 `<ArcProgress written={written} total={plans.length} />` 替代 `<BeatDots />` + 旧 `<span>{written}/{plans.length}</span>`(分数整合进 `ArcProgress`)。

## FE 实现映射(单文件)

[OutlineView.tsx](agent-ui/src/components/workspace/views/OutlineView.tsx):

| 区域 | 行号(改前) | 改动 |
|---|---|---|
| `BeatDots` 组件 | 32-44 | **删除** |
| `ArcCard` | 134-191 | 删 `beats` 计算与 `<BeatDots>`;标题行右侧换 `<ArcProgress>` |
| `ArcProgress` 组件 | (新) | 在 `ArcCard` 上方新增 |
| `OutlineView` Master 块 | 287-346 | 包一层折叠态:默认摘要;`masterOpen` 切展开全字段;chevron 切换 |
| 卷容器 div | 354 | 加卷框样式 |
| 卷标题行 | 360-374 | 加 `BookOpen` 图标 |
| 折叠卷(未分卷区) | 427 | 同款卷框(保持一致) |

## 不在范围

- **弧进度反映「正在写」半进度** —— 现在只算 `status === 'WRITTEN'`。第 N 章「正在写」不算入填充。视觉上「正在写」章已有 `● 正在写` 状态标签,信息不丢。(可后续打磨:把 `writingChapterOrder === c.order` 也算 0.5 进度。)
- **卷标题加进度条** —— Pencil 折叠态/展开态都没画卷进度条,卷标题保留 `written/total` 分数文本即可。
- **总纲折叠态持久化** —— 本地 `useState`(组件卸载重置),不进 zustand store、不进 `Novel.settings`。
- **弧卡 / 章卡视觉改动** —— 不动。
- **`OutlineView` 数据层 / server / DB / agent** —— 零改动;纯展示层。

## 验证

1. `pnpm --dir agent-ui validate`(lint + format + typecheck)全过。
2. `pnpm --dir agent-ui dev` 打开大纲面板:
   - Master 默认折叠(摘要一行)→ 点击展开(全字段,灵魂黑夜高亮)→ 再点折叠回摘要。
   - 卷有深色实底框 + `BookOpen` 图标。
   - 弧右上角是连续进度条(非 5 离散点);觉醒之路 1/3 → 进度条约 33% 填充。
3. 对比 Pencil 帧:折叠态对 `ZOkpY`,展开态对 `s9477h`。

## Pencil 帧参考

- 折叠态:`ZOkpY`(R1 大纲)—— Master 摘要 + chevron-down + 卷框 + 弧进度条
- 展开态:`s9477h`(R1 总纲展开)—— Master 全字段 + chevron-up + 卷框 + 弧进度条
