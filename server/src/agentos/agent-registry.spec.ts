import { TOOL_REGISTRY, type ToolDeps } from './agent-registry';

// 用 inert stub 填满 ToolDeps —— 注册表测试只验证「key→工厂能解析成 tool」,
// 不真正执行工具(真实执行由各工具自己的 spec + pipeline 覆盖)。
function makeDeps(): ToolDeps {
  return {
    userId: 'u1',
    novelId: 'n1',
    readingChapterOrder: null,
    novels: {} as never,
    chapters: {} as never,
    outlines: {} as never,
    world: {} as never,
    characters: {} as never,
    references: {} as never,
    knowledge: {} as never,
    snapshots: {} as never,
    summaries: {} as never,
    events: {} as never,
    eventService: {} as never,
    arcs: {} as never,
    prisma: {} as never,
  };
}

describe('TOOL_REGISTRY', () => {
  const REQUIRED_KEYS = [
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
    'snapshot_chapter',
    'restore_chapter',
    'append_section',
    'replace_text',
    'insert_text',
    'delete_text',
    'clear_chapter',
    'set_chapter_title',
    'get_chapter',
    'list_chapters',
    'query_memory',
    'write_summary',
    'report_review',
    'list_knowledge',
    'get_knowledge',
    'set_references',
    'set_world_entry',
    'report_worldview_review',
    'set_volume',
    'set_chapter_plan',
    'report_outline_review',
    'set_character',
    'report_character_review',
  ];

  it('覆盖所有 agent 配置里用到的工具 key', () => {
    for (const k of REQUIRED_KEYS) {
      expect(TOOL_REGISTRY).toHaveProperty(k);
    }
  });

  it('每个 key 给定 deps 都能解析成一个带 name 的 tool', () => {
    const deps = makeDeps();
    for (const k of REQUIRED_KEYS) {
      const t = TOOL_REGISTRY[k](deps) as { name: string };
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});
