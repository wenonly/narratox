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
main(交互式编排者:一步一停,自建世界观/大纲/角色 + 委派 chapter/curator/3 critic)
├─ chapter            写/续/改/重写一章:跑完 写→结算→校验(+修订)
│   ├─ writer             写正文(promptAugment=writer,拼参考/声音/字数目标切片)
│   ├─ settler            结算(摘要/角色/伏笔/事件)
│   └─ validator          12 维审计(promptAugment=validator,拼作者画像校验切片)
├─ curator            从全局 KB 提炼本书参考资料 + 为受益 agent 生成专属精要
├─ outline-critic     大纲质检(6 维 + 总纲自检):main 建大纲后自动委派
├─ wb-critic          世界观质检(6 维 KB-grounded):main 建世界观后自动委派
└─ char-critic        角色质检(7 维):main 建角色后自动委派
```

> **注:** main 自己建/改/删世界观、大纲、角色(set_world_entry / set_master_outline / set_volume / set_arc / set_chapter_plan / set_character 等);建完必委派对应 critic(wb-critic / outline-critic / char-critic)跑结构化自检。原先 worldbuilder / outliner / character 三棵子树的 orchestrator + writer 共 6 节点已合并进 main。

`main-role-reminder` 不是树节点——它是每轮注入 main 的精简职责提醒(落历史之后最近处,对冲长对话稀释),由 `deep-agent.service.ts` 的 `buildTurnMessages` 直接拼。

## 10 个文件一览

| 文件 | 常量 | key | 角色 |
|---|---|---|---|
| [main.md](main.md) | `MAIN_AGENT_PROMPT` | MAIN | 主编排 agent(自建世界观/大纲/角色 + 委派 chapter/curator/3 critic) |
| [main-role-reminder.md](main-role-reminder.md) | `MAIN_ROLE_REMINDER` | — | 每轮职责提醒(非树节点) |
| [chapter-orchestrator.md](chapter-orchestrator.md) | `CHAPTER_ORCHESTRATOR_PROMPT` | CHAPTER_ORCH | 章节编排 |
| [writer.md](writer.md) | `WRITER_AGENT_PROMPT` | WRITER | 写正文 |
| [settler.md](settler.md) | `SETTLER_AGENT_PROMPT` | SETTLER | 结算 |
| [validator.md](validator.md) | `VALIDATOR_AGENT_PROMPT` | VALIDATOR | 12 维审计 |
| [curator.md](curator.md) | `CURATOR_AGENT_PROMPT` | CURATOR | 参考资料策划 |
| [outline-critic.md](outline-critic.md) | `OUTLINE_CRITIC_PROMPT` | OUTLINE_CRITIC | 大纲质检 |
| [worldbuilder-critic.md](worldbuilder-critic.md) | `WORLDBUILDER_CRITIC_PROMPT` | WB_CRITIC | 世界观质检 |
| [character-critic.md](character-critic.md) | `CHARACTER_CRITIC_PROMPT` | CHAR_CRITIC | 角色质检 |

## 如何编辑

1. 直接改对应 `.md` 的 body。
2. **重启 dev**(改 md 不触发 tsc 重编译;`nest start --watch` 的 `watchAssets` 会重复制 md 到 dist,但提示词在模块加载时读入内存,所以要让改动生效需重启)。生产环境改 md 需重新 `nest build`。
3. frontmatter 的 `name`/`key` 不要乱改——`agent-prompts.spec.ts` 会校验「每个 `promptKey` 都有对应 md」。

## 加一个新 agent / 新提示词

1. 在本目录加 `<slug>.md`(frontmatter 带 `name` + `key`)。
2. 在 `agent-prompts.ts` 的 loader 里加一行 `export const X = load('<slug>')`。
3. 在 `agent-tree.config.ts` 的 `PROMPTS` map 加 `KEY: P.X`,并在 `AGENT_TREE` 对应 spec 的 `promptKey` 引用它。
