import type { Novel } from '@/types/novel'

/** 写作类工具(正文写/改/删)——显示「写作中·第 N 章」。 */
const WRITING_TOOLS = new Set([
  'append_section',
  'replace_text',
  'insert_text',
  'delete_text',
  'clear_chapter',
  'set_chapter_title',
])

/** 工具名 → 固定阶段文案。写作类工具不在此表,走 writingChapterOrder 分支。 */
const TOOL_TO_PHASE: Record<string, string> = {
  set_world_entry: '构建世界观中',
  set_volume: '构建大纲中',
  set_chapter_plan: '构建大纲中',
  set_character: '建角色档案中',
  write_summary: '结算中',
  set_references: '整理参考资料中',
  report_review: '评审中',
  report_worldview_review: '评审中',
  report_outline_review: '评审中',
  report_character_review: '评审中',
}

/**
 * 据 activity 的 tool label 推断当前阶段文案。返回 null 表示该 label 不映射(调用方应保留旧值)。
 * writingChapterOrder 用于写作类工具显示章节号(与 useAIStreamHandler 写入的 store 值一致)。
 */
export function phaseForTool(
  label: string | undefined,
  writingChapterOrder: number | null
): string | null {
  if (!label) return null
  if (WRITING_TOOLS.has(label)) {
    return writingChapterOrder != null
      ? `写作中·第 ${writingChapterOrder} 章`
      : '写作中'
  }
  return TOOL_TO_PHASE[label] ?? null
}

/**
 * 空闲(非流式)阶段:CONCEPT → 立项中;ACTIVE → 写作中 + 焦点章/总章数。
 * focus 取 currentChapterOrder(用户聚焦章),否则最新章;无章则只显示「写作中」。
 */
export function deriveIdlePhase(
  novel: Pick<Novel, 'status' | 'chapters'>,
  currentChapterOrder: number | null
): string {
  if (novel.status === 'CONCEPT') return '立项中(尚未开写)'
  const total = novel.chapters.length
  const focus =
    currentChapterOrder ??
    (total ? Math.max(...novel.chapters.map((c) => c.order)) : null)
  return focus != null ? `写作中 · 第 ${focus} 章 / 共 ${total} 章` : '写作中'
}
