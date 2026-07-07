# Web + Electron 双端数据层方案

> **状态**:方向已定,**未开工**。本文是动工时的直接参考。
> **日期**:2026-07-07
> **背景**:narratox 最终要同时发布 **web 版**(多租户,服务端托管)和 **Electron 套壳版**(单用户,本地优先)。本文锁定数据层的跨端策略。

---

## 1. 背景与目标

- **web 版**:现状不变 —— NestJS 服务端 + PostgreSQL + 多租户(`user.id` 全局隔离)。用户不安装任何东西,数据在服务端。
- **Electron 版**:单用户、本地优先。数据库在用户本机,理想情况下离线可用。
- **核心约束**:两端要**尽量共享同一套代码/schema**,避免长期双轨维护。

关键认识:**这不是「选哪个数据库」的问题,而是「web 与 Electron 如何共享数据层」的问题。** 把它拆成三层分别决策,每层选最合适的方案。

---

## 2. 总体决策:模型 B ——「两库藏接口后」

两端各自用**原生最轻最稳**的数据库,通过接口隔离差异。**向量层完全独立于 Prisma**(用户拍板),这是消除两端分歧税的关键。

| 层 | web 端 | Electron 端 | 是否共享代码 |
|---|---|---|---|
| 关系库 | PostgreSQL + Prisma `postgres` | SQLite(`better-sqlite3`)+ Prisma `sqlite` | 共享 Prisma schema,provider 按 env 切 |
| 向量库 | pgvector(独立于 Prisma) | HNSWLib(`hnswlib-node`)或 LanceDB | 共享 `VectorStore` 接口 |
| LangGraph checkpointer | `PostgresSaver`(`agent_memory` schema) | **sqlite / 文件版 saver(待实现)** | 接口相同,实现双轨 |

---

## 3. 三层架构

### 3.1 关系库 —— Prisma 双 provider

- **web**:`DATABASE_URL` 指向托管 Postgres,Prisma `postgres` provider。维持现状,零改动。
- **Electron**:
  - NestJS 作为 **sidecar 子进程**随 Electron 启动,监听 `localhost:<port>`(沿用当前 `:3001`)。
  - `DATABASE_URL` 指向本地 SQLite 文件(`app.getPath('userData')/narratox.db`),Prisma `sqlite` provider。
  - **provider 切换**:`schema.prisma` 用单一 datasource;构建时分发两份 schema(`schema.prisma` / `schema.sqlite.prisma`)或用一个 `provider` env 占位 + 构建期模板替换。Prisma 不支持运行时切 provider,所以切换在**构建期/打包期**完成。
- **共享面**:Prisma schema 的类型(`String`/`Json`/`Int`/`Boolean`/`DateTime`)两端都能映射。`Json` 在 SQLite 端存为 text,Prisma 自动序列化 —— 应用层无感。
- **不共享面(必须约束)**:**禁止写 Postgres 专有 raw SQL**(`$queryRaw`/`$executeRaw`)。凡用到 `jsonb` 运算符、`ARRAY`、`gen_random_uuid()`、`RETURNING` 等 PG 方言的,要么 Prisma 化,要么在抽象层里给两端各写一份。
  - **动工第一步**:扫 `server/src` 里所有 `$queryRaw` / `$executeRaw`,量化迁移成本(见 §5 风险)。

### 3.2 向量库 —— 独立于 Prisma(关键决策)

向量操作 Prisma 不抽象,且两端 SQL 方言不同(pgvector `<=>` vs sqlite-vec `vec_distance_cosine`)。**所以向量层完全绕开 Prisma**,藏进一个 `VectorStore` 接口,两端各出实现。

```ts
// server/src/vector/vector-store.ts
export interface VectorHit {
  id: string;
  score: number;
  meta?: Record<string, unknown>;
}
export interface VectorStore {
  add(items: { id: string; text: string; vector: number[]; meta?: Record<string, unknown> }[]): Promise<void>;
  search(query: number[], k: number, filter?: Record<string, unknown>): Promise<VectorHit[]>;
  remove(ids: string[]): Promise<void>;
}
```

- **web 实现 `PgVectorStore`**:`CREATE EXTENSION vector;`,raw SQL 走 `pg`,HNSW 索引。
- **Electron 实现 `HnswVectorStore`**:`hnswlib-node`(LangChain.js 的 `HNSWLib` 直接基于它),文件持久化到 `app.getPath('userData')/vectors/`。
  - 备选 `LanceDbVectorStore`:LanceDB 单文件列存,原生支持 Electron,适合量大时。
- **narratox 用量预估**:千章 × ~1536 维 = 几 MB 级,HNSWLib / sqlite-vec 都轻松吃下,**不需要专门的向量服务**。
- **接入点**:对应 CLAUDE.md「Deferred:向量检索 / 千章级 top-K 注入」—— 这是它的终局落点。先立接口 + 空实现(返回 `[]`),零成本锁死扩展点,等真做 recall 时再填实现。

### 3.3 LangGraph Checkpointer —— 唯一真正的待解接缝

当前 `checkpointer.provider.ts` 用 `PostgresSaver`,跑在 `agent_memory` schema。它走 `pg` 线协议,**是最硬的 Postgres 绑定**,PGLite 都接不上(无线协议)。

- **web**:维持 `PostgresSaver` 不变。
- **Electron**:必须换实现。选项:
  1. `@langchain/langgraph-checkpoint-sqlite`(若有 / 成熟)—— 直接用,首选。
  2. 自己实现 `BaseCheckpointSaver` 接口,后端 `better-sqlite3`,持久化到本地文件。
  3. 退化用 `MemorySaver` + 会话级 —— 牺牲跨会话记忆,**不推荐**(长篇写作依赖 checkpoint 续接)。
- **schema**:`agent_memory` 是 PostgresSaver 自管的;sqlite saver 有自己的表结构,**自动建表**,不用迁移。Electron 端 checkpoint 与 web 端历史 checkpoint **互不互通**(单机用户无所谓)。
- **动工验证项**:`@langchain/langgraph-checkpoint-sqlite` 是否可用、接口是否覆盖 narratox 的用法(tuple key、writes、next)。**这是动工后第一个要 spike 的点。**

---

## 4. 否决的备选(留档)

- **内嵌真 PostgreSQL 二进制**:每平台 30–50MB,要管 postmaster/WAL/端口冲突/签名公证/ASAR 解包,守护逻辑复杂。只有重度依赖 PG 独有特性才值得, narratox 不至于。
- **PGLite(PostgreSQL in WASM)**:进程内、无端口、~3–11MB,且**支持 pgvector**。致命问题:不带 Postgres 线协议,Prisma 的 postgres engine 和 `PostgresSaver`(`pg` 驱动)需要 wire-protocol shim 才能连上,这块生态不成熟。**若将来「pgvector 两端通用」成为刚需,可重估 PGLite**(它的 pgvector 一致性是模型 B 给不了的)。
- **Electron 只做壳,直连 web 后端(无本地库)**:最省事,但放弃离线 + 本地数据所有权。仅当 Electron 纯为「分发便利」时才选 —— narratox 不是。

---

## 5. 动工前要验证的风险

1. **`server/src` 的 raw SQL 用量** —— 决定模型 B 关系层的迁移成本。`grep -rn '\$queryRaw\|\$executeRaw' server/src`,逐处看是否用了 PG 方言。
2. **`@langchain/langgraph-checkpoint-sqlite` 可用性** —— 决定 §3.3 是「接现成」还是「自己写」。
3. **Prisma 双 provider 构建** —— schema 怎么在打包期切 provider(`schema.prisma` vs `schema.sqlite.prisma`),CI 怎么 `prisma generate` 两份 client。Prisma 7 config-driven(`server/prisma.config.ts`),注意 CLI 不带 `--schema` flag 的约束。
4. **`better-sqlite3` 原生模块在 Electron 的 ABI** —— 要按 Electron 版本 `rebuild`(`@electron/rebuild`),否则加载报错。
5. **向量扩展加载(若选 sqlite-vec)**:`better-sqlite3` 默认禁 `loadExtension`,要开 `--allow-extension` 并随包分发每平台扩展。**优先选 HNSWLib/LanceDB 绕开此坑。**
6. **NestJS sidecar 打包**:Electron main spawn 子进程跑 NestJS,或用 `electron-builder` `extraResources` 带上 `server/dist` + `node_modules` 产出。端口选 `localhost:<动态或固定>`。

---

## 6. 实施顺序(动工时参考)

1. **Spike 期(1–2 天,只验证风险)**:
   - 扫 raw SQL,出迁移成本报告。
   - 起一个最小 Electron 工程,跑通 `better-sqlite3`(rebuild 后)+ Prisma sqlite provider + 一条 CRUD。
   - 验证 langgraph sqlite checkpointer,跑通一个最小 agent run 续接。
2. **立抽象层**:
   - `VectorStore` 接口 + 空实现,挂到现有注入位。
   - `CheckpointerProvider` 抽象,按 env 出 `PostgresSaver` 或 sqlite saver。
   - Prisma 双 schema 构建脚本。
3. **sidecar 化**:把 NestJS 包进 Electron,`agent-ui` 处理(Next.js 静态导出或第二个 sidecar —— 单独议题,本文不锁)。
4. **填向量实现**:web pgvector / Electron HNSWLib,接 recall 注入点。

---

## 7. 开放问题(动工时再定)

- Electron 端要不要「云同步」(本地 SQLite ↔ 云 Postgres 双向)?若要,同步层是另一大块工作,本方案不含。
- `agent-ui`(Next.js App Router)在 Electron 里怎么跑 —— `output: export` 静态导出,还是再起一个 Next sidecar?与数据层解耦,单独决策。
- 多端账号体系:Electron 本地单用户还要不要 JWT/登录?若纯本地,可简化 auth 层。

---

## 参考

- 相关记忆:`web-electron-db-strategy`(用户私有 memory)
- CLAUDE.md「Deferred」段:向量检索 / top-K 注入为终局方案,本文 §3.2 是其落点
- 现状 checkpoint:`server/src/agentos/checkpointer.provider.ts`
- Prisma 配置约束:`server/prisma.config.ts`(config-driven,CLI 无 `--schema` flag)
