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

## 🔥 写第1章后发现的更严重问题(P0-NEW)+ 已修

### 数据丢失:clear_chapter 无安全网(已加安全网)
run2 写完 ch1(COMMITTED, 2465字)+ settler + validator 后**没终止**——32919 个 think 帧 + 海量重读(get_character×15 / get_world_entry×9 / query_memory×9),最后 `clear_chapter` 把 ch1 清空(字数=0,DRAFT),**且 clear 前没 snapshot** → 被打断时已完成的章被清空、数据丢失。
- **已修(安全网)**:`clear_chapter` 清空前**自动 snapshot** 原版(可用 restore_chapter 恢复),杜绝「清空即丢失」。即便 agent 误判触发重写、或重写中途被打断,内容可恢复。
- **根因未修(见下)**:agent 写完不终止 + 过度自我重写(runaway)。

### runaway:不终止 + 过度重写(根因,待修)
单轮「写第1章」跑了 **107 次工具调用 + 32919 think 帧**,远超预期(writer ~8 + settler + validator ≈ 15)。写完+结算+校验后 agent 不收尾,陷入超长思考 + 重读 + 自行 clear 重写。
- 可能成因(待定位):① agent 写完无强「结束/回复作者」信号;② `recursionLimit: 10000` 过高,不约束 runaway;③ 可能 deepseek-v4-pro 有循环倾向。
- **建议**:降 `recursionLimit` 到合理值(如 300)给 runaway 兜底;强化 chapter-orch「passed=true 或修订1轮即硬结束」+ MAIN「一章写完即回复、不自行续写/重写」。

## ✅ 已修
- **P0-1 StatusService basics**:读 novel.title/genre/synopsis 列(非 settings)→ 真模型验证:nextStep 从 collect_basics 修正为 write_next,readyToWrite=true。
- **P0-2 settler 弧线摘要**:write_summary 描述补事件/弧线摘要 + SETTLER 弧线段强化「每章必填」(待下一轮写章验证 settler 是否真传 currentArcSummary)。
- **P0-NEW clear 数据丢失**:clear_chapter 自动 snapshot 安全网。

## 🔁 重测结果(修复后 run4,deepseek)

### runaway 已治 ✅✅
`recursionLimit 10000→500` + MAIN「完成即停」+ chapter-orch「硬结束」后,重写 ch1:
- **RunCompleted 自然结束**(没死循环、没被超时掐)。
- **34 次工具调用**(run2 是 107)、**clear_chapter:0 / restore:0**(没自毁)。
- 完整写章环:writer(step-0 全读)→ settler → validator,ch1 **3862 字 COMMITTED**。
- recursionLimit 500 够一章,没触发。
- **根因坐实**:runaway 不是单次调用爆 token(maxTokens 工作正常,最大单次 3038 think 帧 << 16000),是 agent 一轮跑 100+ 次调用不终止 → `recursionLimit` 兜底 + 终止纪律解决。

### P0-2 弧线摘要 仍坏 ❌(prompt 治不好)
run4 里 `currentArcSummary`/`currentVolumeArcSummary` **仍 0 次** —— 强化 write_summary 描述 + SETTLER 指令后,deepseek settler **依旧漏提**。
- **结论**:靠 settler 自觉填弧线摘要走不通(可选字段,模型不优先)。
- **改法建议**:放弃「settler 写 Arc.summary」,改成**服务端派生**——ContextAssembler 的【当前弧线】slice 直接按当前 arc 的 `[fromChapter,toChapter]` 范围查 `ChapterSummary` 拼出弧进展(不依赖 settler)。Arc.summary 字段弃用/降级。


- **Phase 10 漂移回馈**:需故意写一章偏离细纲,看 validator dim12→main→outliner 改写 4 跳链。
- **跨章记忆召回**:写第 2 章时 writer 是否 get_events/get_chapter 召回 ch1。
- **长上下文稀释(Phase 14)**:需 50+ 轮。
- **多章顺序关卡**:写 ch2 时 assertFrontier(ch2)。

## 结论
**骨架真的通了,且数据质量超出预期**(大纲/事件/伏笔都很有内容)。但 E2E 一次就揪出 2 个 P0 bug(态势 checklist 查错位置 + 弧线 summary 没提)、2 个 P1(伏笔重复 + 单轮超时)——正是审计说的「血肉未验」。**先修 P0,再继续多章 E2E 验漂移/召回。**
