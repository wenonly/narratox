import {
  AGENT_TREE,
  MAX_TOKENS_BY_TIER,
  PROMPTS,
  resolveModelConfig,
  describeTree,
  collectSpecs,
  type AgentSpec,
  type ModelTier,
} from './agent-tree.config';

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

  describe('resolveModelConfig', () => {
    it('spec 无 temperature 覆盖 → 原样返回 activeConfig', () => {
      const spec: AgentSpec = {
        name: 'x',
        description: 'd',
        promptKey: 'MAIN',
        modelTier: 'long',
        tools: [],
      };
      const c = cfg({});
      expect(resolveModelConfig(spec, c)).toBe(c);
    });

    it('spec.temperature 覆盖 → clone 改温度', () => {
      const spec: AgentSpec = {
        name: 'x',
        description: 'd',
        promptKey: 'MAIN',
        modelTier: 'long',
        tools: [],
        temperature: 0.2,
      };
      const out = resolveModelConfig(spec, cfg({ temperature: 0.7 }));
      expect(out).toMatchObject({ id: 'c1', temperature: 0.2 });
    });

    it('spec.temperature 与 activeConfig 相同 → 不 clone(原样)', () => {
      const c = cfg({ temperature: 0.5 });
      const spec: AgentSpec = {
        name: 'x',
        description: 'd',
        promptKey: 'MAIN',
        modelTier: 'long',
        tools: [],
        temperature: 0.5,
      };
      expect(resolveModelConfig(spec, c)).toBe(c);
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
          'get_reference',
        ],
        children: [
          {
            name: 'chapter',
            promptKey: 'CHAPTER_ORCH',
            tier: 'long',
            tools: ['snapshot_chapter', 'restore_chapter'],
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
                  'get_reference',
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
                tools: ['get_chapter', 'query_memory', 'report_review'],
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
                  'set_volume',
                  'set_chapter_plan',
                  'get_outline',
                  'get_chapter_plan',
                  'get_novel_info',
                  'get_worldview',
                  'get_world_entry',
                  'query_memory',
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
  });
});
