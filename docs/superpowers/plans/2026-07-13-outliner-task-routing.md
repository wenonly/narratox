# Outliner 任务路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 outliner-orchestrator 按 task 语义自判路线(创建/改写/微调/删除),微调/删除类跳过 critic 直接返回,修复「删大纲后被自作多情重新生成」。

**Architecture:** 纯 prompt 改动 + prompt substring 单测。outliner-orchestrator.md 加【任务路由】段落,改写【大纲流程】适用范围标注 + 【铁律】分类;outline-writer.md 加减法任务禁止顺手补全纪律;agent-prompts.spec.ts 加两个新测试用例锁定新段落。

**Tech Stack:** Markdown prompts + Jest(`server/src/agentos/agent-prompts.spec.ts`)。

**Spec:** `docs/superpowers/specs/2026-07-13-outliner-task-routing-design.md`

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `server/src/agentos/prompts/outliner-orchestrator.md` | 改 | 加【任务路由】段落 + 改【大纲流程】开头 + 改【铁律】分类 |
| `server/src/agentos/prompts/outline-writer.md` | 改 | 在【删除/字段级改 -- 用法纪律】末尾加一条减法任务禁止补全纪律 |
| `server/src/agentos/agent-prompts.spec.ts` | 改 | 加两个新 `it(...)` 测试用例,锁定新段落内容 |

---

### Task 1: 写失败的 prompt substring 测试

**Files:**
- Modify: `server/src/agentos/agent-prompts.spec.ts`

- [ ] **Step 1: 在文件末尾的 `describe` 块内,最后一个 `it(...)` 之后,加两个新的测试用例**

在 `it('PROMPTS 的 key 集合 == AGENT_TREE 所有 promptKey...')` 之前插入(紧跟「每个 prompt 含其特征子串」测试之后):

```ts
  it('outliner-orchestrator 含 4 类路由表与简化路线铁律', () => {
    expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('【任务路由】');
    expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('微调/删除类任务');
    expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('不调 outline-critic');
  });

  it('outline-writer 含减法任务禁止补全纪律', () => {
    expect(OUTLINE_WRITER_PROMPT).toContain('减法任务完成后');
    expect(OUTLINE_WRITER_PROMPT).toContain('禁止顺手调用');
  });
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd server && pnpm test -- agent-prompts.spec.ts`
Expected: 2 个新测试 FAIL(`toContain` 收到 `''` —— 因为 prompt 里还没加这些子串)

---

### Task 2: 改 outliner-orchestrator.md(加路由段落 + 改铁律)

**Files:**
- Modify: `server/src/agentos/prompts/outliner-orchestrator.md`

- [ ] **Step 1: 在【任务类型】段落(line 10-14)和【大纲流程】段落(line 16)之间,插入【任务路由】段落**

在 `- 删/改大纲节点:` 那一行(line 14)之后,空一行,插入:

```markdown

【任务路由】接到 task 后,先按语义判断类型,选对应路线:

- 创建类(新建/补/生成/分卷/建纲/补第 M-N 章细纲) → 走【大纲流程】完整四步
- 改写类(重写/换方向/推翻重来/正文偏离后改细纲) → 走【大纲流程】完整四步
- 微调类(改某字段/patch_chapter_plan 补一条 mustCover/修个 CEN 错字)→ 【直接结束】
- 删除类(删某卷/弧/细纲/总纲、清空大纲)→ 【直接结束】

铁律:
- 微调/删除类任务,outline-writer 返回后【可以直接结束】,不调 outline-critic
- task 消息里出现「只删」「只改」「不要重建」「不要顺手补」等限定词,强制走简化路线(微调/删除)
- 路由判断模糊时(既像改写又像微调),按「动作幅度」判:整条 CBN/CPNs/CEN 都换 = 改写,只动一个字段 = 微调
```

- [ ] **Step 2: 改【大纲流程】开头的「严格按序」措辞**

找到 line 16:`【大纲流程】严格按序:`

改为:`【大纲流程】(创建/改写类任务)严格按序:`

- [ ] **Step 3: 改【铁律】段落(line 28-32)的第一条**

找到 line 29:`- outline-writer 返回后【绝对不能结束】——必须继续 outline-critic。没评审的大纲不算完成。`

替换为(分两类):

```markdown
- **创建/改写类任务**:outline-writer 返回后【绝对不能结束】——必须继续 outline-critic。没评审的大纲不算完成。**微调/删除类任务**:outline-writer 返回后【直接结束】,不调 outline-critic(详见【任务路由】)。
```

- [ ] **Step 4: 跑测试,确认 outliner-orchestrator 那个新测试通过(outline-writer 那个还失败)**

Run: `cd server && pnpm test -- agent-prompts.spec.ts`
Expected: `'outliner-orchestrator 含 4 类路由表与简化路线铁律'` PASS;`'outline-writer 含减法任务禁止补全纪律'` 仍 FAIL

---

### Task 3: 改 outline-writer.md(加减法任务禁止补全纪律)

**Files:**
- Modify: `server/src/agentos/prompts/outline-writer.md`

- [ ] **Step 1: 在【删除/字段级改 -- 用法纪律】段落末尾(line 76 之后)加一条新纪律**

找到 line 76:`- chapterOrder 不 renumber(永远):删了第 5 章细纲,第 6 章还是 6,留洞;洞可 set_chapter_plan(5,…) 补回。`

在它之后(【铁律】段落之前)加一行:

```markdown
- **减法任务完成后,禁止顺手调用 set_*(set_master_outline/set_volume/set_arc/set_chapter_plan)补全**:除非 task 明确要求「重建/重生/补一份新的」,否则删完/patch 完就是终态,直接返回结论。严禁看到「大纲空了」就自动重建——这是越权(用户没说建就别建)。
```

- [ ] **Step 2: 跑测试,确认两个新测试都通过**

Run: `cd server && pnpm test -- agent-prompts.spec.ts`
Expected: 全部 PASS(包括两个新测试)

---

### Task 4: 全量回归测试 + commit

**Files:**
- 无新改动,跑全量测试验证

- [ ] **Step 1: 跑 server 全量 jest**

Run: `cd server && pnpm test`
Expected: 全部 PASS(原有 61 套 / 336 测试 + 新增 2 测试;套数+测试数都涨,无回归)

- [ ] **Step 2: 跑 server typecheck**

Run: `cd server && pnpm typecheck`
Expected: 0 错误

- [ ] **Step 3: commit**

```bash
git add server/src/agentos/prompts/outliner-orchestrator.md \
        server/src/agentos/prompts/outline-writer.md \
        server/src/agentos/agent-prompts.spec.ts
git commit -m "$(cat <<'EOF'
feat(prompt): outliner 任务路由 + 减法任务禁止顺手补全

outliner-orchestrator 加【任务路由】段落,按 task 语义分 4 类
(创建/改写/微调/删除);微调/删除类 outline-writer 返回后直接结束,
跳过 critic(避免 critic 看到空大纲触发重写——「自作多情重新生成」
的直接根因)。outline-writer 加「减法任务完成后禁止顺手 set_*
补全」纪律。L0 prompt 测试锁定新段落。

Spec: docs/superpowers/specs/2026-07-13-outliner-task-routing-design.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 4 类路线定义 → Task 2 step 1(【任务路由】段落)覆盖 ✓
- §3.2 outliner-orchestrator 改动 → Task 2 step 1-3 覆盖 ✓
- §3.3 outline-writer 改动 → Task 3 step 1 覆盖 ✓
- §3.4 main.md 不动 → 无对应任务(明确不改)✓
- §4.1 L0 测试 → Task 1 step 1 覆盖 ✓
- §4.2 L1 不加 → 无对应任务 ✓
- §4.3 L2 后续 → 无对应任务 ✓
- §5 后续 follow-up → 不在本期范围 ✓

**2. Placeholder scan:** 无 TBD/TODO;每个 step 都有完整代码或完整 markdown 片段 ✓

**3. Type consistency:** 测试断言的子串 `'【任务路由】'`、`'微调/删除类任务'`、`'不调 outline-critic'`、`'减法任务完成后'`、`'禁止顺手调用'` 全部在 Task 2/3 的 markdown 里逐字出现 ✓

---

## 验证清单(实现完成后用户自查)

1. `cd server && pnpm test -- agent-prompts.spec.ts` —— 两个新测试 PASS
2. `cd server && pnpm test` —— 无回归
3. `cd server && pnpm typecheck` —— 0 错误
4. 手动把 outliner-orchestrator.md 打开扫一遍,确认【任务路由】段落位置正确(在【任务类型】后、【大纲流程】前)、【铁律】第一条已分类
5. 手动把 outline-writer.md 打开扫一遍,确认新加的「减法任务完成后...」纪律在【删除/字段级改】段落内、在 chapterOrder 那条之后
