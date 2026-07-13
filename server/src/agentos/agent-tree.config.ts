/**
 * 声明式 agent 树配置 + 纯解析函数。deep-agent.service.ts 的 buildAgentGraph 读取
 * AGENT_TREE 递归建图。这是「加一个 agent = 加一段配置」的扩展点:工具走 TOOL_REGISTRY,
 * prompt 走 PROMPTS,model 档位按角色可调(modelTier);per-agent 温度/模型 override 走
 * AgentModelOverride 表(运行时由调用方注入 resolveModelConfig,非 spec 字段)。
 *
 * 行为等价约束:现有 chapter/curator/worldbuilder/outliner 四分支的 prompt/tools/tier
 * 与重构前的 buildAgentGraph 字面量逐字一致;main 的 set_character(写)被移除、改为
 * 只读 get_character/get_characters(对齐 outline/worldview 只读策略);新增 character 分支。
 */
import type { ModelConfigRecord } from './model-factory';
import * as P from './agent-prompts';
import {
  DISSECT_TREE,
  collectDissectSpecs,
  type DissectSpec,
} from './dissect-tree.config';

export type ModelTier = 'long' | 'short';

/** 纯 UI 标注(设置页推荐模型 badge),运行时不读。与 modelTier(maxTokens 档位)正交。 */
export type RecommendedTier = 'strong' | 'mid' | 'cheap';

export interface AgentSpec {
  name: string;
  description: string;
  promptKey: string;
  promptAugment?: 'writer' | 'validator'; // 动态切片钩子(writer 拼 references/voice slice;validator 拼 centaur 校验 slice)
  modelTier: ModelTier;
  recommendedTier: RecommendedTier;
  tools: string[]; // TOOL_REGISTRY 的 key
  subagents?: AgentSpec[];
  // per-agent 模型 override 通过 AgentModelOverride 表实现(见 settings/agent-model-override.service),非 spec 字段。
}

export const MAX_TOKENS_BY_TIER: Record<ModelTier, number> = {
  long: 16_000,
  short: 6_000,
};

export const PROMPTS: Record<string, string> = {
  MAIN: P.MAIN_AGENT_PROMPT,
  CHAPTER_ORCH: P.CHAPTER_ORCHESTRATOR_PROMPT,
  WRITER: P.WRITER_AGENT_PROMPT,
  SETTLER: P.SETTLER_AGENT_PROMPT,
  VALIDATOR: P.VALIDATOR_AGENT_PROMPT,
  CURATOR: P.CURATOR_AGENT_PROMPT,
  OUTLINE_CRITIC: P.OUTLINE_CRITIC_PROMPT,
  WB_CRITIC: P.WORLDBUILDER_CRITIC_PROMPT,
  CHAR_CRITIC: P.CHARACTER_CRITIC_PROMPT,
};

/**
 * 解析真正喂给 getModel/buildChatModel 的 ModelConfigRecord。
 *
 * 温度两级优先级(高 → 低):
 *   1. temperatureOverride —— per-agent 用户配的温度(AgentModelOverride,运行时由调用方注入)
 *   2. activeConfig.temperature —— 用户在 /settings 选的 Model 自带温度
 *
 * 用 `??` 链:null/undefined 都被跳过(不覆盖下层)。最终温度与 activeConfig 相同 → 原样
 * 返回(避免无谓 clone,getModel 缓存 key 不变);不同 → clone 改温度。
 * 纯函数,可单测;getModel 据返回值的 temperature 进 cache key。
 */
export function resolveModelConfig(
  activeConfig: ModelConfigRecord,
  temperatureOverride?: number | null,
): ModelConfigRecord {
  const finalTemp = temperatureOverride ?? activeConfig.temperature;
  return finalTemp === activeConfig.temperature
    ? activeConfig
    : { ...activeConfig, temperature: finalTemp };
}

export const AGENT_TREE: AgentSpec = {
  name: 'main',
  description: '小说生成流程的编排(主 agent)。',
  promptKey: 'MAIN',
  modelTier: 'long',
  recommendedTier: 'strong',
  tools: [
    'get_novel_info',
    'update_novel',
    'get_reading_chapter',
    'get_chapter',
    'get_outline',
    'get_chapter_plan',
    'get_worldview',
    'get_world_entry',
    'get_character',
    'get_characters',
    'get_events',
    'get_arcs',
    'get_reference',
    'add_reference',
    'update_reference',
    'delete_reference',
    'get_benchmark',
    'set_master_outline',
    'set_volume',
    'set_arc',
    'set_chapter_plan',
    'patch_chapter_plan',
    'delete_chapter_plan',
    'delete_volume',
    'delete_arc',
    'clear_master_outline',
    'set_world_entry',
    'set_character',
    'delete_character',
    'clear_characters',
    'list_knowledge',
    'get_knowledge',
    'query_memory',
    'report_outline_review',
    'report_worldview_review',
    'report_character_review',
  ],
  subagents: [
    {
      name: 'chapter',
      description:
        '写/改/续写/重写章节。作者要写/续写/重写第 N 章时委派;它会在聚焦上下文里跑完 writer → settler → validator(+修订) 全流程。',
      promptKey: 'CHAPTER_ORCH',
      modelTier: 'long',
      recommendedTier: 'strong',
      tools: ['snapshot_chapter', 'restore_chapter', 'check_prose'],
      subagents: [
        {
          name: 'writer',
          description: '写/改/续写章节正文。',
          promptKey: 'WRITER',
          promptAugment: 'writer',
          modelTier: 'long',
          recommendedTier: 'mid',
          tools: [
            'append_section',
            'replace_text',
            'insert_text',
            'delete_text',
            'clear_chapter',
            'set_chapter_title',
            'get_chapter',
            'list_chapters',
            'query_memory',
            'get_outline',
            'get_chapter_plan',
            'get_worldview',
            'get_world_entry',
            'get_character',
            'get_characters',
            'get_character_history',
            'get_events',
            'get_arcs',
            'get_reference',
            'get_benchmark',
          ],
        },
        {
          name: 'settler',
          description: '结算章节(提取摘要/角色/伏笔)。',
          promptKey: 'SETTLER',
          modelTier: 'short',
          recommendedTier: 'cheap',
          tools: ['get_chapter', 'write_summary'],
        },
        {
          name: 'validator',
          description: '校验章节一致性/质量。',
          promptKey: 'VALIDATOR',
          promptAugment: 'validator',
          modelTier: 'short',
          recommendedTier: 'strong',
          tools: [
            'get_chapter',
            'get_chapter_plan',
            'get_character',
            'get_characters',
            'get_character_history',
            'get_events',
            'query_memory',
            'report_review',
          ],
        },
      ],
    },
    {
      name: 'curator',
      description:
        '搜索/提炼写作参考资料并固化为本小说专属参考。立项信息齐、需要建参考资料时委派。',
      promptKey: 'CURATOR',
      modelTier: 'long',
      recommendedTier: 'mid',
      tools: [
        'list_knowledge',
        'get_knowledge',
        'set_references',
        'get_reference',
        'add_reference',
        'update_reference',
        'delete_reference',
      ],
    },
    {
      name: 'outline-critic',
      description:
        '大纲质检员(6 维结构化评审 + 总纲自检)。建大纲后 main 自动委派;改大纲后作者可选委派;作者主动要审也可委派。调 report_outline_review 给 passed/score/blockingIssues。',
      promptKey: 'OUTLINE_CRITIC',
      modelTier: 'short',
      recommendedTier: 'strong',
      tools: [
        'get_outline',
        'get_chapter_plan',
        'get_novel_info',
        'get_worldview',
        'get_world_entry',
        'query_memory',
        'report_outline_review',
      ],
    },
    {
      name: 'wb-critic',
      description:
        '世界观质检员(6 维 KB-grounded 评审)。建世界观后 main 自动委派;改世界观后作者可选委派;作者主动要审也可委派。调 report_worldview_review 给 passed/score/blockingIssues。',
      promptKey: 'WB_CRITIC',
      modelTier: 'short',
      recommendedTier: 'strong',
      tools: [
        'get_worldview',
        'get_world_entry',
        'get_novel_info',
        'report_worldview_review',
      ],
    },
    {
      name: 'char-critic',
      description:
        '角色质检员(7 维评审:区分度/一致性/弧光可行性/语言风格/关系/动机/小传完整度)。建角色后 main 自动委派;改/删角色后作者可选委派;作者主动要审也可委派。调 report_character_review 给 passed/score/blockingIssues。',
      promptKey: 'CHAR_CRITIC',
      modelTier: 'short',
      recommendedTier: 'strong',
      tools: [
        'get_character',
        'get_characters',
        'get_worldview',
        'get_world_entry',
        'get_outline',
        'get_novel_info',
        'query_memory',
        'report_character_review',
      ],
    },
  ],
};

/** 扁平收集一棵树里的所有 spec(测试/校验用)。 */
export function collectSpecs(spec: AgentSpec): AgentSpec[] {
  return [spec, ...(spec.subagents ?? []).flatMap(collectSpecs)];
}

/**
 * curator 用的 agent 名单(从 AGENT_TREE 实时遍历):角色名 + 职责描述。
 * 新增 agent → 自动进名单,curator 自动纳入考虑(prompt 无需改)。排除 curator 自身
 * (它是生产者,不为自己生成精要)。AGENT_TREE 静态 → 每次 build 现算,天然「活」。
 */
export function buildAgentRoster(): string {
  const lines = collectSpecs(AGENT_TREE)
    .filter((s) => s.name !== 'curator')
    .map((s) => `- ${s.name}:${s.description}`);
  return `【agent 名单 — 你可为之生成专属精要的角色】\n${lines.join('\n')}`;
}

/** 树结构摘要(测试快照用,不含 prompt 文本)。 */
export interface TreeNode {
  name: string;
  promptKey: string;
  tier: ModelTier;
  tools: string[];
  children: TreeNode[];
}
export function describeTree(spec: AgentSpec): TreeNode {
  return {
    name: spec.name,
    promptKey: spec.promptKey,
    tier: spec.modelTier,
    tools: spec.tools,
    children: (spec.subagents ?? []).map(describeTree),
  };
}

/** per-agent 模型配置 UI 用的 agent 分组:main 单列,每个 orchestrator 自成一组(含其子孙)。 */
export interface AgentGroupEntry {
  key: string;
  description: string;
  recommendedTier: RecommendedTier;
}
export interface AgentGroup {
  group: string; // orchestrator 的 name
  agents: AgentGroupEntry[];
}
export function buildAgentGroups(): AgentGroup[] {
  const entry = (s: AgentSpec | DissectSpec): AgentGroupEntry => ({
    key: s.name,
    description: s.description,
    recommendedTier: s.recommendedTier,
  });
  const groups: AgentGroup[] = [
    { group: AGENT_TREE.name, agents: [entry(AGENT_TREE)] },
  ];
  for (const orch of AGENT_TREE.subagents ?? []) {
    groups.push({
      group: orch.name,
      agents: collectSpecs(orch).map(entry),
    });
  }
  // 拆解树独立一组(拆解是对标书分析,与小说生成正交;独立组便于设置页分区展示)
  groups.push({
    group: 'dissect(拆解)',
    agents: collectDissectSpecs(DISSECT_TREE).map(entry),
  });
  return groups;
}
