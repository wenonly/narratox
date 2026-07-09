/**
 * 拆解(对标书 dissection)声明式 agent 树。仿 AGENT_TREE 的结构(DissectSpec 仿 AgentSpec):
 * 一个 main 编排 + 5 个 task-delegated 子 agent(chapter-extractor / plot-analyst /
 * character-extractor / style-analyst / dissect-critic)。这是「拆解功能」的扩展点——
 * 加一个拆解维度 = 加一段配置 + 一个 prompt + 一个 write_benchmark type。
 *
 * 与 AGENT_TREE 的区别:拆解树是独立运行的(不是 main 编排的一部分),由拆解入口
 * (BenchmarkService / controller)单独喂给 buildAgentGraph。模型档位/工具闭包注入沿用
 * 同一套机制(TOOL_REGISTRY 按 key 解析,userId/bookId 闭包注入)。
 *
 * type 复用 agent-tree.config 的 ModelTier / RecommendedTier(避免重复定义、保证 UI 分组
 * 与设置页 badge 一致)。
 */
import type { ModelTier, RecommendedTier } from './agent-tree.config';
import * as P from './dissect-prompts';

export interface DissectSpec {
  name: string;
  description: string;
  promptKey: string;
  modelTier: ModelTier;
  recommendedTier: RecommendedTier;
  tools: string[]; // TOOL_REGISTRY 的 key
  subagents?: DissectSpec[];
}

export const DISSECT_PROMPTS: Record<string, string> = {
  DISSECT_MAIN: P.DISSECT_MAIN_PROMPT,
  CHAPTER_EXTRACTOR: P.CHAPTER_EXTRACTOR_PROMPT,
  PLOT_ANALYST: P.PLOT_ANALYST_PROMPT,
  CHARACTER_EXTRACTOR: P.CHARACTER_EXTRACTOR_PROMPT,
  STYLE_ANALYST: P.STYLE_ANALYST_PROMPT,
  MATERIAL_EXTRACTOR: P.MATERIAL_EXTRACTOR_PROMPT,
  DISSECT_CRITIC: P.DISSECT_CRITIC_PROMPT,
};

export const DISSECT_TREE: DissectSpec = {
  name: 'dissect-main',
  description:
    '拆解小说主编排:切章 → 逐章拆 → 全书维度(剧情/节奏/情绪)→ 角色 → 文风 → 审核。',
  promptKey: 'DISSECT_MAIN',
  modelTier: 'long',
  recommendedTier: 'strong',
  tools: [],
  subagents: [
    {
      name: 'chapter-extractor',
      description: '逐章拆:取原文 → 摘要+情节点+角色提及 → 写 CHAPTER 条目。',
      promptKey: 'CHAPTER_EXTRACTOR',
      modelTier: 'short',
      recommendedTier: 'cheap',
      tools: ['write_benchmark', 'get_raw_chapter'],
    },
    {
      name: 'plot-analyst',
      description:
        '读全章 CHAPTER 条目,拆 PLOT(故事线)/ RHYTHM(节奏)/ EMOTION(情绪)。',
      promptKey: 'PLOT_ANALYST',
      modelTier: 'long',
      recommendedTier: 'strong',
      tools: ['write_benchmark', 'get_dissect_entries'],
    },
    {
      name: 'character-extractor',
      description: '从 CHAPTER 角色提及聚合主要角色,每个产一张 CHARACTER 卡。',
      promptKey: 'CHARACTER_EXTRACTOR',
      modelTier: 'long',
      recommendedTier: 'mid',
      tools: ['write_benchmark', 'get_dissect_entries'],
    },
    {
      name: 'style-analyst',
      description: '抽样关键章拆文风指纹(句长/标点/对话/视角 + 原文锚点)。',
      promptKey: 'STYLE_ANALYST',
      modelTier: 'long',
      recommendedTier: 'mid',
      tools: ['write_benchmark', 'get_raw_chapter'],
    },
    {
      name: 'dissect-critic',
      description:
        '审核拆解完整性(全章覆盖 + 6 type 齐全),产 report_dissect_review。',
      promptKey: 'DISSECT_CRITIC',
      modelTier: 'long',
      recommendedTier: 'strong',
      tools: ['get_dissect_entries', 'report_dissect_review'],
    },
  ],
};

/** 扁平收集一棵拆解树里的所有 spec(测试/校验用)。 */
export function collectDissectSpecs(spec: DissectSpec): DissectSpec[] {
  return [spec, ...(spec.subagents ?? []).flatMap(collectDissectSpecs)];
}
