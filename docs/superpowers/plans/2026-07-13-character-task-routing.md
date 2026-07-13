# Character 任务路由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 outliner 任务路由模板应用到 character-orchestrator:加 4 类路由表、修复【铁律】矛盾、character-writer 加减法任务禁止补全纪律。

**Architecture:** 纯 prompt 改动 + prompt substring 单测。沿用 2026-07-13 outliner 路由的执行模式。

**Tech Stack:** Markdown prompts + Jest(`server/src/agentos/agent-prompts.spec.ts`)。

**Spec:** `docs/superpowers/specs/2026-07-13-character-task-routing-design.md`

---

## File Structure

| 文件 | 改动 | 责任 |
|---|---|---|
| `server/src/agentos/prompts/character-orchestrator.md` | 改 | 加【任务路由】段落(在【建角色档案流程】之前)+ 改【铁律】第一条分类 |
| `server/src/agentos/prompts/character-writer.md` | 改 | 在【删除/清空 — 用法纪律】末尾加一条减法任务禁止补全纪律 |
| `server/src/agentos/agent-prompts.spec.ts` | 改 | 加两个新 `it(...)` 测试用例,锁定新段落内容 |

---

### Task 1: 写失败的 prompt substring 测试

**Files:**
- Modify: `server/src/agentos/agent-prompts.spec.ts`

- [ ] **Step 1: 在「outline-writer 含减法任务禁止补全纪律」测试之后插入两个新测试用例**

找到现有测试(outliner spec 加的):

```ts
  it('outline-writer 含减法任务禁止补全纪律', () => {
    expect(OUTLINE_WRITER_PROMPT).toContain('减法任务完成后');
    expect(OUTLINE_WRITER_PROMPT).toContain('禁止顺手调用');
  });
```

在它之后(在 `it('PROMPTS 的 key 集合...')` 之前)插入:

```ts
  it('character-orchestrator 含 4 类路由表与简化路线铁律', () => {
    expect(CHARACTER_ORCHESTRATOR_PROMPT).toContain('【任务路由】');
    expect(CHARACTER_ORCHESTRATOR_PROMPT).toContain('微调/删除类任务');
    expect(CHARACTER_ORCHESTRATOR_PROMPT).toContain('不调 char-critic');
  });

  it('character-writer 含减法任务禁止补全纪律', () => {
    expect(CHARACTER_WRITER_PROMPT).toContain('减法任务完成后');
    expect(CHARACTER_WRITER_PROMPT).toContain('禁止顺手调用');
  });
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd server && pnpm test -- agent-prompts.spec.ts`
Expected: 2 个新测试 FAIL

---

### Task 2: 改 character-orchestrator.md(加路由段落 + 改铁律)

**Files:**
- Modify: `server/src/agentos/prompts/character-orchestrator.md`

- [ ] **Step 1: 在【建角色档案流程】段落(line 10)之前插入【任务路由】段落**

找到 line 8-10:

```markdown
你是「角色编排 agent」。你的唯一职责:收到「建/丰富角色档案」时,在自己的聚焦上下文里【按序跑完】 取KB→建档案→评审(+修订) 全流程,然后把结论回给主 agent。

【建角色档案流程】严格按序:
```

在「你是「角色编排 agent」...」段落和「【建角色档案流程】严格按序:」之间插入:

```markdown

【任务路由】接到 task 后,先按语义判断类型,选对应路线:

- 创建类(新建/丰富/补角色档案) → 走【建角色档案流程】完整四步
- 改写类(推翻重写某角色档案,set_character 全字段覆盖) → 走【建角色档案流程】完整四步
- 微调类(改某角色单字段/补一项/clear_fields 清空某字段)→ 【直接结束】
- 删除类(删某角色/清空全书角色)→ 【直接结束】(详见【删/清角色流程】)

铁律:
- 微调/删除类任务,char-writer 返回后【可以直接结束】,不调 char-critic
- task 消息里出现「只改」「只删」「不要重建」「不要顺手补」等限定词,强制走简化路线(微调/删除)
- 路由判断模糊时(既像改写又像微调),按「字段范围」判:整份档案重写(背景+性格+弧光多个字段都动)= 改写,只动单字段 = 微调
```

- [ ] **Step 2: 改【铁律】第一条(line 29)**

找到 line 29:`- char-writer 返回后【绝对不能结束】——必须继续 char-critic。没评审的角色档案不算完成。`

替换为:

```markdown
- **创建/改写类任务**:char-writer 返回后【绝对不能结束】——必须继续 char-critic。没评审的角色档案不算完成。**微调/删除类任务**:char-writer 返回后【直接结束】,不调 char-critic(详见【任务路由】)。
```

- [ ] **Step 3: 跑测试,确认 character-orchestrator 那个新测试通过(character-writer 那个还失败)**

Run: `cd server && pnpm test -- agent-prompts.spec.ts`
Expected: `'character-orchestrator 含 4 类路由表与简化路线铁律'` PASS;`'character-writer 含减法任务禁止补全纪律'` 仍 FAIL

---

### Task 3: 改 character-writer.md(加减法任务禁止补全纪律)

**Files:**
- Modify: `server/src/agentos/prompts/character-writer.md`

- [ ] **Step 1: 在【删除/清空 — 用法纪律】段落末尾(line 40)之后加一条新纪律**

找到 line 40:`- **改名 = 新建旧删**:`name` 是身份,不做 rename。改名 = `delete_character(旧名)` + `set_character({ name: 新名, ... })`。`

在它之后(【铁律】段落之前)加:

```markdown
- **减法任务完成后,禁止顺手调用 set_character 补全**:除非 task 明确要求「重建/重生/补一份新的」,否则删完/clear_fields 清完/部分字段改完就是终态,直接返回结论。严禁看到「角色库空了」「某字段空了」就自动重建或重填——这是越权(用户没说建就别建)。
```

- [ ] **Step 2: 跑测试,确认两个新测试都通过**

Run: `cd server && pnpm test -- agent-prompts.spec.ts`
Expected: 全部 PASS

---

### Task 4: 全量回归测试 + commit

**Files:**
- 无新改动

- [ ] **Step 1: 跑 server 全量 jest**

Run: `cd server && pnpm test`
Expected: 全部 PASS(无回归;测试数比上期 outliner 路由合入后多 2)

- [ ] **Step 2: 跑 server typecheck**

Run: `cd server && pnpm typecheck`
Expected: 0 错误

- [ ] **Step 3: commit**

```bash
git add server/src/agentos/prompts/character-orchestrator.md \
        server/src/agentos/prompts/character-writer.md \
        server/src/agentos/agent-prompts.spec.ts
git commit -m "$(cat <<'EOF'
feat(prompt): character 任务路由 + 减法任务禁止顺手补全

character-orchestrator 加【任务路由】段落(创建/改写/微调/删除 4 类),
修复【铁律】第一条与【删/清角色流程】的自相矛盾(明说微调/删除类
char-writer 返回后直接结束、跳过 char-critic)。character-writer 加
「减法任务完成后禁止顺手 set_character 补全」纪律。L0 prompt 测试
锁定新段落。沿用 outliner 任务路由模板。

Spec: docs/superpowers/specs/2026-07-13-character-task-routing-design.md
Plan: docs/superpowers/plans/2026-07-13-character-task-routing.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 4 类映射 → Task 2 step 1(【任务路由】段落)覆盖 ✓
- §3.2 character-orchestrator 改动 → Task 2 step 1-2 覆盖 ✓
- §3.3 character-writer 改动 → Task 3 step 1 覆盖 ✓
- §3.4 character-critic 不动 → 无对应任务 ✓
- §3.5 main 不动 → 无对应任务 ✓
- §4.1 L0 测试 → Task 1 step 1 覆盖 ✓

**2. Placeholder scan:** 无 TBD/TODO;每个 step 都有完整 markdown 片段 ✓

**3. Type consistency:** 测试断言子串 `'【任务路由】'`、`'微调/删除类任务'`、`'不调 char-critic'`、`'减法任务完成后'`、`'禁止顺手调用'` 全部在 Task 2/3 的 markdown 里逐字出现 ✓

---

## 验证清单(实现完成后用户自查)

1. `cd server && pnpm test -- agent-prompts.spec.ts` —— 两个新测试 PASS
2. `cd server && pnpm test` —— 无回归
3. `cd server && pnpm typecheck` —— 0 错误
4. 手动把 character-orchestrator.md 打开扫一遍,确认【任务路由】段落位置正确(在【建角色档案流程】前)、【铁律】第一条已分类
5. 手动把 character-writer.md 打开扫一遍,确认新加的「减法任务完成后...」纪律在【删除/清空】段落内、在「改名 = 新建旧删」那条之后
