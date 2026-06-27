# E2E 实测发现(2026-06-27 · deepseek-v4-pro · 真账号真模型)

> 直接调 API 跑一本短篇《断剑重铸》全流程,验证 Phase 5-14 的闭环。账号 wenonly,模型 deepseek-v4-pro。

## ✅ 已验证闭合的环(真模型、真数据)

| 环 | 结果 |
|---|---|
| 立项收集(update_novel 7 项) | ✓ settings/genre/synopsis 落库 |
| curator 参考资料策划 | ✓ 13 条,KB-grounded 且高度相关(「短篇复仇文·五章节拍」「美强惨主角塑造·沈砚模板」「剑修打斗技法」) |
| worldbuilder | ✓ 11 条目 + critic 评审 |
| outliner | ✓ 1 卷 + 3 弧 + 5 章细纲(夺剑/残魂/重塑/试锋/重铸)+ critic —— 大纲质量很高 |
| character | ✓ 3 角色档案(沈砚 PROTAGONIST/楚行歌 ANTAGONIST/秦寒石 SUPPORTING)+ critic |
| 写第1章 writer | ✓ step-0 完整执行:get_chapter_plan/相邻章/get_arcs/get_character/get_world_entry/get_reference 全读;写 2465 字 COMMITTED |
| settler 提取 | ✓ 1 行摘要 + 14 roleChanges + 8 entities + **3 事件(2 MAJOR 1 MINOR)** + 10 伏笔 |
| **Phase 11 事件提取** | ✓✓ settler 传了 plotEvents + relatedHookId(事件带伏笔链接)+ causedById(因果链)—— 事件系统真生效 |
| **Phase 14 writer step-0 + ROLE_REMINDER** | ✓ writer 写前读齐;main 正确委派(没自己写正文) |
| validator | ✓ report_review 执行 |
| CONCEPT→ACTIVE | ✓ 首章写入后翻转 |
| 态势面板 | ✓ 写后 ACTIVE/2465字/1章/10开放伏笔/2MAJOR事件;coverage/health/frontier 正确 |

**核心结论:主写章环 + 全 CONCEPT 流水线 + 事件记忆 在真模型下确实闭合,数据质量高。**

## 🐛 发现的 bug / 缺口

### P0 — StatusService 立项 checklist 查错位置
`onboarding.basics` 查 `settings.title/genre/synopsis`,但这仨是 **Novel 列**(不在 settings JSON)→ 误报 false → `readyToWrite=false` → CONCEPT 期 `nextStep` 永远 `collect_basics`(实际基础信息已齐)。
**修**:basics 读 `novel.title/genre/synopsis` 列,不是 settings。

### P0 — Phase 12 弧线/卷 summary 没被 settler 更新
流里 `currentArcSummary`/`currentVolumeArcSummary` **0 次** —— settler 漏提了较新的弧线滚动摘要(Phase 11 事件提了,Phase 12 弧线没提)。`Arc.summary` 会一直空,【当前弧线】slice 缺进展。
**修**:强化 SETTLER 的弧线摘要指令,或自查为何漏。

### P1 — 伏笔重复
settler 建了重复伏笔(「崖底剑光」×2、「剑意天赋」×2)。无去重。
**修**:createHooks 按 description 去重,或 settler 提示先查已有。

### P1 — 单轮自主链式超时
一轮里 main 自主连跑 curator+world+outline+character(没按 prompt「等作者确认」在每阶段停)→ 超 900s 被截断。**主 agent 没遵守「每阶段等作者确认」的门**。
**修**:强化 MAIN 的「每步委派后停下等回复」;或前端/服务端调高超时。

### P2 — 种子章 quirk
建小说 seed 了空 ch1(DRAFT)→ maxOrder=1 → 态势 frontier=2,但 ch1 还没写(误导)。
**修**:frontier 按「有内容的最大章 +1」算,或建小说不 seed 空章。

## ⏳ 本次未覆盖(需更多轮/刻意构造)
- **Phase 10 漂移回馈**:需故意写一章偏离细纲,看 validator dim12→main→outliner 改写 4 跳链。
- **跨章记忆召回**:写第 2 章时 writer 是否 get_events/get_chapter 召回 ch1。
- **长上下文稀释(Phase 14)**:需 50+ 轮。
- **多章顺序关卡**:写 ch2 时 assertFrontier(ch2)。

## 结论
**骨架真的通了,且数据质量超出预期**(大纲/事件/伏笔都很有内容)。但 E2E 一次就揪出 2 个 P0 bug(态势 checklist 查错位置 + 弧线 summary 没提)、2 个 P1(伏笔重复 + 单轮超时)——正是审计说的「血肉未验」。**先修 P0,再继续多章 E2E 验漂移/召回。**
