# Agent 提示词(markdown 源)

这里每个 `.md` 是一个 agent 的提示词。**文件即源**——`agent-prompts.ts` 在模块加载时读这些 md、剥掉 frontmatter、导出同名常量供 `agent-tree.config.ts` 的 `PROMPTS` map 等消费。

## 文件格式

```md
---
name: WRITER_AGENT_PROMPT      # 导出常量名(给人交叉引用 + spec 校验)
key: WRITER                     # AGENT_TREE 里的 promptKey(MAIN_ROLE_REMINDER 无 key)
title: writer · 写作手          # 人类阅读用
description: 一句话说明          # 人类阅读用
---

<纯 body —— LLM 实际收到的就是这段,frontmatter 不送进 LLM>
```

frontmatter 只给人看 / 给 spec 校验;**loader 只取 `---` 之后的 body**。

## agent 树

```
main(交互式编排者:一步一停,委派 5 个编排器)
├─ chapter        写/续/改/重写一章:跑完 写→结算→校验(+修订)
│   ├─ writer         写正文(promptAugment=writer,拼参考/声音/字数目标切片)
│   ├─ settler        结算(摘要/角色/伏笔/事件)
│   └─ validator      12 维审计(promptAugment=validator,拼作者画像校验切片)
├─ curator        从全局 KB 提炼本书参考资料 + 为受益 agent 生成专属精要
├─ worldbuilder   建世界观:取KB→建条目→评审(+修订)
│   ├─ wb-writer      建条目
│   └─ wb-critic      6 维评审
├─ outliner       建大纲/补细纲/改写细纲:取KB→立总纲→分卷→分弧→建细纲→评审(+修订)
│   ├─ outline-writer 建卷/弧/细纲(+立总纲)
│   └─ outline-critic 6 维评审 + 总纲自检
└─ character      建角色档案:取KB→建档案→评审(+修订)
    ├─ char-writer    建档案
    └─ char-critic    6 维评审
```

`main-role-reminder` 不是树节点——它是每轮注入 main 的精简职责提醒(落历史之后最近处,对冲长对话稀释),由 `deep-agent.service.ts` 的 `buildTurnMessages` 直接拼。

## 16 个文件一览

| 文件 | 常量 | key | 角色 |
|---|---|---|---|
| [main.md](main.md) | `MAIN_AGENT_PROMPT` | MAIN | 主编排 agent |
| [main-role-reminder.md](main-role-reminder.md) | `MAIN_ROLE_REMINDER` | — | 每轮职责提醒(非树节点) |
| [chapter-orchestrator.md](chapter-orchestrator.md) | `CHAPTER_ORCHESTRATOR_PROMPT` | CHAPTER_ORCH | 章节编排 |
| [writer.md](writer.md) | `WRITER_AGENT_PROMPT` | WRITER | 写正文 |
| [settler.md](settler.md) | `SETTLER_AGENT_PROMPT` | SETTLER | 结算 |
| [validator.md](validator.md) | `VALIDATOR_AGENT_PROMPT` | VALIDATOR | 12 维审计 |
| [curator.md](curator.md) | `CURATOR_AGENT_PROMPT` | CURATOR | 参考资料策划 |
| [worldbuilder-orchestrator.md](worldbuilder-orchestrator.md) | `WORLDBUILDER_ORCHESTRATOR_PROMPT` | WB_ORCH | 世界观编排 |
| [worldbuilder-writer.md](worldbuilder-writer.md) | `WORLDBUILDER_WRITER_PROMPT` | WB_WRITER | 世界观构建 |
| [worldbuilder-critic.md](worldbuilder-critic.md) | `WORLDBUILDER_CRITIC_PROMPT` | WB_CRITIC | 世界观质检 |
| [outliner-orchestrator.md](outliner-orchestrator.md) | `OUTLINER_ORCHESTRATOR_PROMPT` | OUTLINER_ORCH | 大纲编排 |
| [outline-writer.md](outline-writer.md) | `OUTLINE_WRITER_PROMPT` | OUTLINE_WRITER | 大纲构建 |
| [outline-critic.md](outline-critic.md) | `OUTLINE_CRITIC_PROMPT` | OUTLINE_CRITIC | 大纲质检 |
| [character-orchestrator.md](character-orchestrator.md) | `CHARACTER_ORCHESTRATOR_PROMPT` | CHAR_ORCH | 角色编排 |
| [character-writer.md](character-writer.md) | `CHARACTER_WRITER_PROMPT` | CHAR_WRITER | 角色构建 |
| [character-critic.md](character-critic.md) | `CHARACTER_CRITIC_PROMPT` | CHAR_CRITIC | 角色质检 |

## 如何编辑

1. 直接改对应 `.md` 的 body。
2. **重启 dev**(改 md 不触发 tsc 重编译;`nest start --watch` 的 `watchAssets` 会重复制 md 到 dist,但提示词在模块加载时读入内存,所以要让改动生效需重启)。生产环境改 md 需重新 `nest build`。
3. frontmatter 的 `name`/`key` 不要乱改——`agent-prompts.spec.ts` 会校验「每个 `promptKey` 都有对应 md」。

## 加一个新 agent / 新提示词

1. 在本目录加 `<slug>.md`(frontmatter 带 `name` + `key`)。
2. 在 `agent-prompts.ts` 的 loader 里加一行 `export const X = load('<slug>')`。
3. 在 `agent-tree.config.ts` 的 `PROMPTS` map 加 `KEY: P.X`,并在 `AGENT_TREE` 对应 spec 的 `promptKey` 引用它。
