import {
  AGENT_TREE,
  MAX_TOKENS_BY_TIER,
  PROMPTS,
  resolveModelConfig,
  describeTree,
  collectSpecs,
  type ModelTier,
} from './agent-tree.config';
import type { ModelConfigRecord } from './model-factory';

describe('agent-tree config', () => {
  const cfg = (
    over: Partial<{
      id: string;
      provider: string;
      model: string;
      baseUrl: string | null;
      apiKey: string;
      temperature: number | null;
      updatedAt: Date;
    }>,
  ) => ({
    id: 'c1',
    provider: 'openai-compatible',
    model: 'm',
    baseUrl: 'https://x',
    apiKey: 'k',
    temperature: 0.7,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  });

  describe('resolveModelConfig 两级温度', () => {
    const base: ModelConfigRecord = {
      id: 'm1',
      provider: 'p',
      model: 'm',
      baseUrl: null,
      apiKey: 'k',
      temperature: 0.5,
      updatedAt: new Date(0),
    };

    it('无 override → 用 Model 温度', () => {
      expect(resolveModelConfig(base).temperature).toBe(0.5);
    });

    it('temperatureOverride 覆盖 Model 温度', () => {
      expect(resolveModelConfig(base, 0.8).temperature).toBe(0.8);
    });

    it('temperatureOverride 为 null 不覆盖(走 Model)', () => {
      expect(resolveModelConfig(base, null).temperature).toBe(0.5);
    });

    it('最终温度与 Model 相同 → 原样返回(不 clone,cache key 不变)', () => {
      expect(resolveModelConfig(base, 0.5)).toBe(base);
    });
  });

  describe('配置完整性', () => {
    it('MAX_TOKENS_BY_TIER 两档(16k/6k)', () => {
      expect(MAX_TOKENS_BY_TIER.long).toBe(16_000);
      expect(MAX_TOKENS_BY_TIER.short).toBe(6_000);
    });

    it('每个 spec 的 promptKey 都在 PROMPTS 里', () => {
      for (const s of collectSpecs(AGENT_TREE)) {
        expect(PROMPTS).toHaveProperty(s.promptKey);
      }
    });

    it('每个 spec 的 modelTier 合法', () => {
      const valid: ModelTier[] = ['long', 'short'];
      for (const s of collectSpecs(AGENT_TREE)) {
        expect(valid).toContain(s.modelTier);
      }
    });
  });

  describe('AGENT_TREE 结构(防回归快照)', () => {
    it('整棵树名字+工具+层级与设计一致', () => {
      expect(describeTree(AGENT_TREE)).toEqual({
        name: 'main',
        promptKey: 'MAIN',
        tier: 'long',
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
          'get_benchmark',
        ],
        children: [
          {
            name: 'chapter',
            promptKey: 'CHAPTER_ORCH',
            tier: 'long',
            tools: ['snapshot_chapter', 'restore_chapter', 'check_prose'],
            children: [
              {
                name: 'writer',
                promptKey: 'WRITER',
                tier: 'long',
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
                children: [],
              },
              {
                name: 'settler',
                promptKey: 'SETTLER',
                tier: 'short',
                tools: ['get_chapter', 'write_summary'],
                children: [],
              },
              {
                name: 'validator',
                promptKey: 'VALIDATOR',
                tier: 'short',
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
                children: [],
              },
            ],
          },
          {
            name: 'curator',
            promptKey: 'CURATOR',
            tier: 'long',
            tools: [
              'list_knowledge',
              'get_knowledge',
              'set_references',
              'get_reference',
            ],
            children: [],
          },
          {
            name: 'worldbuilder',
            promptKey: 'WB_ORCH',
            tier: 'long',
            tools: [],
            children: [
              {
                name: 'wb-writer',
                promptKey: 'WB_WRITER',
                tier: 'long',
                tools: [
                  'list_knowledge',
                  'get_knowledge',
                  'set_world_entry',
                  'get_worldview',
                  'get_world_entry',
                  'get_novel_info',
                ],
                children: [],
              },
              {
                name: 'wb-critic',
                promptKey: 'WB_CRITIC',
                tier: 'short',
                tools: [
                  'get_worldview',
                  'get_world_entry',
                  'get_novel_info',
                  'report_worldview_review',
                ],
                children: [],
              },
            ],
          },
          {
            name: 'outliner',
            promptKey: 'OUTLINER_ORCH',
            tier: 'long',
            tools: [],
            children: [
              {
                name: 'outline-writer',
                promptKey: 'OUTLINE_WRITER',
                tier: 'long',
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
                  'get_benchmark',
                  'delete_chapter_plan',
                  'delete_volume',
                  'delete_arc',
                  'clear_master_outline',
                  'patch_chapter_plan',
                ],
                children: [],
              },
              {
                name: 'outline-critic',
                promptKey: 'OUTLINE_CRITIC',
                tier: 'short',
                tools: [
                  'get_outline',
                  'get_chapter_plan',
                  'get_novel_info',
                  'get_worldview',
                  'get_world_entry',
                  'query_memory',
                  'report_outline_review',
                ],
                children: [],
              },
            ],
          },
          {
            name: 'character',
            promptKey: 'CHAR_ORCH',
            tier: 'long',
            tools: [],
            children: [
              {
                name: 'char-writer',
                promptKey: 'CHAR_WRITER',
                tier: 'long',
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
                children: [],
              },
              {
                name: 'char-critic',
                promptKey: 'CHAR_CRITIC',
                tier: 'short',
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
                children: [],
              },
            ],
          },
        ],
      });
    });

    it('validator 能查角色档案(人物一致校验的数据源)', () => {
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      const validator = chapter.subagents!.find((s) => s.name === 'validator')!;
      expect(validator.tools).toContain('get_character');
      expect(validator.tools).toContain('get_characters');
    });

    it('validator 能读细纲(细纲兑现校验的数据源)', () => {
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      const validator = chapter.subagents!.find((s) => s.name === 'validator')!;
      expect(validator.tools).toContain('get_chapter_plan');
    });

    it('outline-writer 能读实际正文(改写模式 accept-written-as-truth 的数据源)', () => {
      const outliner = AGENT_TREE.subagents!.find(
        (s) => s.name === 'outliner',
      )!;
      const outlineWriter = outliner.subagents!.find(
        (s) => s.name === 'outline-writer',
      )!;
      expect(outlineWriter.tools).toContain('get_chapter');
    });

    it('writer/validator/main 都能召回事件(get_events)', () => {
      expect(AGENT_TREE.tools).toContain('get_events');
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      expect(
        chapter.subagents!.find((s) => s.name === 'writer')!.tools,
      ).toContain('get_events');
      expect(
        chapter.subagents!.find((s) => s.name === 'validator')!.tools,
      ).toContain('get_events');
    });

    it('outline-writer 能建弧线(set_arc);writer/main 能读弧线(get_arcs)', () => {
      expect(AGENT_TREE.tools).toContain('get_arcs');
      const outliner = AGENT_TREE.subagents!.find(
        (s) => s.name === 'outliner',
      )!;
      expect(
        outliner.subagents!.find((s) => s.name === 'outline-writer')!.tools,
      ).toContain('set_arc');
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      expect(
        chapter.subagents!.find((s) => s.name === 'writer')!.tools,
      ).toContain('get_arcs');
    });

    it('CHAPTER_ORCH 持确定性守卫工具 check_prose', () => {
      const orch = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      expect(orch.tools).toContain('check_prose');
    });

    it('main/writer/outline-writer 都能拉对标(get_benchmark)', () => {
      expect(AGENT_TREE.tools).toContain('get_benchmark');
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      expect(
        chapter.subagents!.find((s) => s.name === 'writer')!.tools,
      ).toContain('get_benchmark');
      const outliner = AGENT_TREE.subagents!.find(
        (s) => s.name === 'outliner',
      )!;
      expect(
        outliner.subagents!.find((s) => s.name === 'outline-writer')!.tools,
      ).toContain('get_benchmark');
    });
  });
});
