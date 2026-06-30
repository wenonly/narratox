/**
 * 声明式 agent 树配置 + 纯解析函数。deep-agent.service.ts 的 buildAgentGraph 读取
 * AGENT_TREE 递归建图。这是「加一个 agent = 加一段配置」的扩展点:工具走 TOOL_REGISTRY,
 * prompt 走 PROMPTS,model 档位/温度按角色可调(temperature 覆盖;model-per-role 留位未接)。
 *
 * 行为等价约束:现有 chapter/curator/worldbuilder/outliner 四分支的 prompt/tools/tier
 * 与重构前的 buildAgentGraph 字面量逐字一致;main 的 set_character(写)被移除、改为
 * 只读 get_character/get_characters(对齐 outline/worldview 只读策略);新增 character 分支。
 */
import type { ModelConfigRecord } from './model-factory';
import * as P from './agent-prompts';

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
  temperature?: number; // 可选按角色覆盖;undefined → activeConfig.temperature
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
  WB_ORCH: P.WORLDBUILDER_ORCHESTRATOR_PROMPT,
  WB_WRITER: P.WORLDBUILDER_WRITER_PROMPT,
  WB_CRITIC: P.WORLDBUILDER_CRITIC_PROMPT,
  OUTLINER_ORCH: P.OUTLINER_ORCHESTRATOR_PROMPT,
  OUTLINE_WRITER: P.OUTLINE_WRITER_PROMPT,
  OUTLINE_CRITIC: P.OUTLINE_CRITIC_PROMPT,
  CHAR_ORCH: P.CHARACTER_ORCHESTRATOR_PROMPT,
  CHAR_WRITER: P.CHARACTER_WRITER_PROMPT,
  CHAR_CRITIC: P.CHARACTER_CRITIC_PROMPT,
};

/**
 * 按 spec 解析出真正喂给 getModel/buildChatModel 的 ModelConfigRecord。
 *
 * 温度三级优先级(高 → 低):
 *   1. temperatureOverride —— per-agent 用户配的温度(AgentModelOverride,运行时由调用方注入)
 *   2. spec.temperature     —— 代码里按角色写的温度(AGENT_TREE)
 *   3. activeConfig.temperature —— 用户在 /settings 选的 Model 默认温度
 *
 * 用 `??` 链:null/undefined 都被跳过(不覆盖下层)。最终温度与 activeConfig 相同 → 原样
 * 返回(避免无谓 clone,getModel 缓存 key 不变);不同 → clone 改温度。
 * 纯函数,可单测;getModel 据返回值的 temperature 进 cache key。
 */
export function resolveModelConfig(
  spec: AgentSpec,
  activeConfig: ModelConfigRecord,
  temperatureOverride?: number | null,
): ModelConfigRecord {
  const finalTemp =
    temperatureOverride ?? spec.temperature ?? activeConfig.temperature;
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
    'get_outline',
    'get_chapter_plan',
    'get_worldview',
    'get_world_entry',
    'get_character',
    'get_characters',
    'get_events',
    'get_arcs',
    'get_reference',
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
      ],
    },
    {
      name: 'worldbuilder',
      description:
        '构建/重建世界观。立项信息齐、需要建世界观时委派;它会在聚焦上下文里跑完 取KB设定文档→建条目→评审→(修订) 全流程。',
      promptKey: 'WB_ORCH',
      modelTier: 'long',
      recommendedTier: 'strong',
      tools: [],
      subagents: [
        {
          name: 'wb-writer',
          description: '从知识库取设定文档后建/改世界观条目。',
          promptKey: 'WB_WRITER',
          modelTier: 'long',
          recommendedTier: 'mid',
          tools: [
            'list_knowledge',
            'get_knowledge',
            'set_world_entry',
            'get_worldview',
            'get_world_entry',
            'get_novel_info',
          ],
        },
        {
          name: 'wb-critic',
          description: '评审世界观(6维结构化打分),调 report_worldview_review。',
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
      ],
    },
    {
      name: 'outliner',
      description:
        '建/重建大纲,或补细纲(第 M-N 章)。世界观建好后、写正文前委派建大纲;写到边界或某章无细纲时委派补细纲;它会在聚焦上下文里跑完 取KB大纲方法论→建卷/细纲→评审→(修订) 全流程。',
      promptKey: 'OUTLINER_ORCH',
      modelTier: 'long',
      recommendedTier: 'strong',
      tools: [],
      subagents: [
        {
          name: 'outline-writer',
          description: '从知识库取大纲方法论后建/改卷与细纲。',
          promptKey: 'OUTLINE_WRITER',
          modelTier: 'long',
          recommendedTier: 'mid',
          tools: [
            'list_knowledge',
            'get_knowledge',
            'set_master_outline',
            'set_volume',
            'set_chapter_plan',
            'set_arc',
            'get_outline',
            'get_chapter_plan',
            'get_chapter',
            'get_novel_info',
            'get_worldview',
            'get_world_entry',
            'query_memory',
          ],
        },
        {
          name: 'outline-critic',
          description: '评审大纲(6维结构化打分),调 report_outline_review。',
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
      ],
    },
    {
      name: 'character',
      description:
        '建/丰富角色档案。大纲建好后、写正文前委派建主要角色档案;或作者要丰富人物时委派;它会在聚焦上下文里跑完 取KB人物方法论→建档案→评审→(修订) 全流程。',
      promptKey: 'CHAR_ORCH',
      modelTier: 'long',
      recommendedTier: 'strong',
      tools: [],
      subagents: [
        {
          name: 'char-writer',
          description: '从知识库取人物方法论后建/改角色档案。',
          promptKey: 'CHAR_WRITER',
          modelTier: 'long',
          recommendedTier: 'mid',
          tools: [
            'set_character',
            'get_character',
            'get_characters',
            'get_worldview',
            'get_world_entry',
            'get_outline',
            'get_chapter_plan',
            'get_novel_info',
            'list_knowledge',
            'get_knowledge',
            'query_memory',
          ],
        },
        {
          name: 'char-critic',
          description:
            '评审角色档案(6维结构化打分),调 report_character_review。',
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
  const entry = (s: AgentSpec): AgentGroupEntry => ({
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
  return groups;
}
