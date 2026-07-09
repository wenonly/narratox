# 参考资料细粒度 Agent Tool 设计

**日期**: 2026-07-09
**状态**: 设计稿
**作用域**: server/src/agentos + server/src/novel + prompts(无 DB 迁移、无 FE 代码)

---

## 背景

`NovelReference`(小说级参考资料)当前的写入路径只有一个 agent tool:`set_references`,它做的是**先清后插的全量覆写**(`NovelReferenceService.replaceAll`: `deleteMany` + `createMany`)。curator 在小说初始化阶段批量写入精要/原始资料时这没问题,但写作过程中的**增量微调**场景非常笨拙:

- writer 在写作中发现某条参考资料过时 → 只能走 writer→main→curator 委托链,且 curator 要么再跑一次 `set_references` 全量重发生成全部条目(高风险,可能丢其他条目),要么不修
- main 收到 `report_review` 指出某条参考资料有误 → 同样无单点修改手段
- 新增/删除单条的诉求完全没有工具支持

后端其实已有 `NovelReferenceService.update()` 和 HTTP `PATCH /novels/:id/references/:rid`,但既没对应的 agent tool,也没有 `create`/`delete` 单条的能力。

## 目标

给 agent 提供 `add` / `update` / `delete` 单条 NovelReference 的工具,让参考资料在写作过程中可被微调,而不必每次全量覆写。**保持"agent 是参考资料唯一作者"的现有哲学**——不加用户手动编辑入口。

## 非目标

- **不加 FE 编辑入口**(用户仍只能看;编辑完全由 agent 负责)。未来若要加用户编辑,再另立 spec。
- **不动全局写作知识库**(KB_DIR markdown)。仍然只读,修改只能直接编辑文件。
- **不引入 DB unique 约束**。title 唯一性在 service 层校验,避免老数据迁移问题。
- **不改变 `set_references` 的行为**。它仍是 curator 初始化的全量写入工具。

## 方案

### 工具契约

新增 3 个 agent tool,全部按 **id** 操作(agent 必须先调 `get_reference` 拿到 id):

```typescript
// 新增单条
add_reference({
  title: string,          // 必填,同一 (userId, novelId) 内唯一(冲突报错)
  content: string,        // 必填
  category?: string,      // 默认 ""
  injectTo?: string|null, // 默认 null(同 NovelReference 语义)
  order?: number,         // 默认 0
}): { id: string, title: string }

// 字段级 patch(除 id 外全可选)
update_reference({
  id: string,             // 必填,来自 get_reference 返回
  title?: string,         // 改 title 时仍要求唯一,冲突报错
  content?: string,
  category?: string,
  injectTo?: string|null,
  order?: number,
}): { id: string, title: string, updatedFields: string[] }

// 删单条
delete_reference({ id: string }): { id: string, title: string }
```

### 分发

| Agent | 工具 |
|---|---|
| `curator` | `add_reference` / `update_reference` / `delete_reference`(微调用,与现有 `set_references` 共存——初始化仍用 `set_references` 批量写) |
| `main` | 同上(main 收到 `report_review` 或用户指令后可直接改,不必每次委托 curator) |
| `writer` / `validator` / 其他 specialist | **不加**,仍只读(`get_reference`)。发现问题走 `report_review` 上报 |

理由:curator 是资料库的指定作者;main 是编排者,允许它直接改可省一次委托往返。writer/validator 不直接改,保持职责单一,避免多作者互相覆盖。

### 安全约束(照搬现有 set_references / get_reference)

- `userId` / `novelId` 在 tool factory 闭包注入,**绝不从 LLM 输入读**(防止跨用户/跨小说篡改)
- 所有 Prisma 查询带 `where: { id, novelId, userId }`——跨小说/跨用户访问统一返回 `NOT_FOUND`(不暴露存在性)
- `title` 唯一性在 service 层校验:`findFirst({ title, novelId, userId })` 命中 → `add` / `update` 返回 `TITLE_DUPLICATE` 错误(tool 层转成可读消息反馈给 agent,不抛异常中断流)

### 典型工作流

```
[curator 初始化 — 不变]
  list_knowledge → get_knowledge → set_references(批量)

[writer 写作中发现参考资料某段过时]
  writer → report_review(flag 参考资料)
       ↓
[main 收到 review — 新能力:直接改]
  main → get_reference(title="冰山男写法") → 拿到 id
       → update_reference({ id, content: "新内容..." })
       ↓ 或
[main → task curator — 委托路径,仍然支持]
  curator → get_reference → update_reference / delete_reference / add_reference
```

## 改动清单

### 后端

**`server/src/novel/novel-reference.service.ts`**
- 新增 `create(userId, novelId, dto): Promise<NovelReference>`——title 冲突校验 + 创建
- 新增 `deleteOne(userId, novelId, rid): Promise<void>`——多租户 scoped 删除
- `update()` 已存在,签名不变(tool 层接 PATCH 语义)

**`server/src/novel/novel.controller.ts`**
- 新增 `POST /novels/:id/references` → `create`
- 新增 `DELETE /novels/:id/references/:rid` → `deleteOne`
- `PATCH /novels/:id/references/:rid` 已有,不动
- (主要给未来 FE 用 + API 一致性,agent 不走 HTTP)

**DTO**(`server/src/novel/dto/`)
- `create-novel-reference.dto.ts`:title + content 必填,其余可选
- `update-novel-reference.dto.ts`:已存在(PATCH 路由用),复用

### Tool 实现

**新文件**(`server/src/agentos/tools/`):
- `add-reference.tool.ts`
- `update-reference.tool.ts`
- `delete-reference.tool.ts`

均沿用 `get-reference.tool.ts` / `set-references.tool.ts` 的 factory 模式:`(userId, novelId) => tool(...)`,service 从 module 注入。

**注册**(`server/src/agentos/agent-registry.ts`):
- `TOOL_REGISTRY` 追加三个 key:`add_reference` / `update_reference` / `delete_reference`

**分发**(`server/src/agentos/agent-tree.config.ts`):
- `curator` 节点 `tools:[]` 追加三个 key
- `main` 节点 `tools:[]` 追加三个 key
- 其他 agent 不动

### FE 改动(零代码)

`ReferencesView` 已经通过 `referenceWriteSeq`(`store.ts`)监听 NovelReference 变更自动刷新——当前 `set_references` 落库时 bump。**新 tool 调用落库时也走同一条 bump 路径**(在三个新 tool factory 的成功分支里调一次 bump,照搬 `set-references.tool.ts` 的写法)。→ FE 无任何改动,curator/main 增删改一条参考资料后,右栏 R5 自动刷新。

### 提示词改动

**`server/src/agentos/prompts/curator.md`** —— 在现有"初始化用 `set_references`"段后追加:

> 【增量维护】后续若需要微调参考资料(修改一条、删除一条、新增一条),**禁止**重新调用 `set_references` 全量覆写(会丢失其他条目)。改用 `update_reference` / `delete_reference` / `add_reference`,按 id 操作。id 从 `get_reference(title=...)` 获取。

**`server/src/agentos/prompts/main.md`** —— 在「收到 `report_review` 后的处理」段补一句:

> 若 review 报告指向某条参考资料过时或有误,可先用 `get_reference(title=...)` 拿到 id,再用 `update_reference` / `delete_reference` 直接改;或委托 curator 处理。

其他 agent 提示词不动。

### 活动帧 / 日志

沿用 `set_references` 的 `ActResult` 活动帧,不新增事件类型。三个 tool 的 `ActResult.summary` 例:
- `"更新参考资料「冰山男写法」"`
- `"删除参考资料「爽点节奏」"`
- `"新增参考资料「武器体系」"`

### 测试

- **L0**:`novel-reference.service.spec.ts` 补 `create` / `deleteOne` 的多租户隔离测试(跨 user/novel 访问 → `NOT_FOUND`;title 冲突 → `TITLE_DUPLICATE`)
- **L0**:`agent-prompts.spec.ts` 锁一条 curator prompt 的新增段 substring(迁移 byte-fidelity 守卫惯例)
- **L1**:`test/smoke/l1-integration.spec.ts` 在 `assertTrajectory` 里追加断言:`update_reference` 改单条成功,且**未**触发 `set_references` 的清空行为(其他条目仍在)
- 不写 L2 / L3(无新 agent,无新 agent 协议,纯 tool 增量)

### DB 迁移

**无**。NovelReference 现有字段(title/category/content/injectTo/source/order/...)足够,title 唯一性走 service 层校验,不引入 DB unique 约束(避免与历史数据冲突)。

## 风险与边界

1. **agent 必须先 `get_reference` 拿 id**——两步操作。若 agent 不知道 title,可能找不到 id。实践中 main/curator 都能从注入的参考精要 slice(`buildReferenceSlice`)里看到 title 索引,足够定位。**不另加 `list_references` 工具**(YAGNI)。
2. **title 改名 → 旧 id 失效引用**:如果有别处缓存了 id,name 改了后 id 仍然有效(id 是 cuid,与 title 无关)。title 唯一性只影响 `add`/`update` 时的新 title 冲突。
3. **多 agent 并发改同一 NovelReference**:LangGraph 单 session 串行,且 `main`/`curator` 不会并发运行(orchestrator→subagent 串行)。无并发风险。
4. **`set_references` 与增量工具共存**:curator 可以先用 `set_references` 初始化,再用 `update_reference` 微调;也可以再次 `set_references` 全量覆写(会清空再重建)。提示词已明确指引增量用增量工具,但语义上两者共存,不强制。
5. **FE 无手动编辑入口**:用户若想直接改参考资料,目前只能通过 chat 指令让 main/curator 改。这是 Q2 决策的取舍,未来若要补 FE 编辑入口,另立 spec。

## 验证

- `pnpm --dir server test` 全绿(L0 新 case 通过)
- `pnpm --dir server test:smoke` L1 断言通过
- 手动 E2E:对一本已有参考资料的小说,在 chat 里说"把参考资料里的 XXX 改成 YYY",观察 main/curator 是否走 `update_reference` 而非 `set_references`,右栏 R5 是否自动刷新到新内容
