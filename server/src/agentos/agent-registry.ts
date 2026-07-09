/**
 * 工具注册表:把「工具名 → 工厂」集中,工厂统一接收 ToolDeps(含 userId/novelId + 全部服务)。
 * agent-tree.config.ts 里每个 agent 只列工具 key;buildAgentGraph 用 deps 解析成真实 tool 实例。
 * 这取代原先散落在 deep-agent.service.ts 的 writerTools()/wbWriterTools()/outlineWriterTools()。
 */
import type { NovelService } from '../novel/novel.service';
import type { ChapterService } from '../novel/chapter.service';
import type { OutlineService } from '../novel/outline.service';
import type { WorldEntryService } from '../novel/world-entry.service';
import type { CharacterService } from '../novel/character.service';
import type { NovelReferenceService } from '../novel/novel-reference.service';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { RevisionSnapshotService } from '../novel/revision-snapshot.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';
import type { EventService } from '../memory/event.service';
import type { ArcService } from '../novel/arc.service';
import type { MasterOutlineService } from '../novel/master-outline.service';
import type { BenchmarkService } from '../benchmark/benchmark.service';
import type { PrismaService } from '../prisma/prisma.service';

import { makeUpdateNovelTool } from './tools/update-novel.tool';
import { makeGetNovelInfoTool } from './tools/get-novel-info.tool';
import { makeAppendSectionTool } from './tools/append-section.tool';
import { makeReplaceTextTool } from './tools/replace-text.tool';
import { makeInsertTextTool } from './tools/insert-text.tool';
import { makeDeleteTextTool } from './tools/delete-text.tool';
import { makeClearChapterTool } from './tools/clear-chapter.tool';
import { makeSetChapterTitleTool } from './tools/set-chapter-title.tool';
import { makeGetChapterTool } from './tools/get-chapter.tool';
import { makeGetReadingChapterTool } from './tools/get-reading-chapter.tool';
import { makeListChaptersTool } from './tools/list-chapters.tool';
import { makeQueryMemoryTool } from './tools/query-memory.tool';
import { makeWriteSummaryTool } from './tools/write-summary.tool';
import { makeSetVolumeTool } from './tools/set-volume.tool';
import { makeSetChapterPlanTool } from './tools/set-chapter-plan.tool';
import { makeGetOutlineTool } from './tools/get-outline.tool';
import { makeGetChapterPlanTool } from './tools/get-chapter-plan.tool';
import { makeSetWorldEntryTool } from './tools/set-world-entry.tool';
import { makeGetWorldviewTool } from './tools/get-worldview.tool';
import { makeGetWorldEntryTool } from './tools/get-world-entry.tool';
import { makeReportReviewTool } from './tools/report-review.tool';
import { makeReportWorldviewReviewTool } from './tools/report-worldview-review.tool';
import { makeReportOutlineReviewTool } from './tools/report-outline-review.tool';
import { makeReportCharacterReviewTool } from './tools/report-character-review.tool';
import { makeSnapshotChapterTool } from './tools/snapshot-chapter.tool';
import { makeRestoreChapterTool } from './tools/restore-chapter.tool';
import { makeCheckProseTool } from './tools/check-prose.tool';
import { makeSetCharacterTool } from './tools/set-character.tool';
import { makeGetCharacterTool } from './tools/get-character.tool';
import { makeGetCharactersTool } from './tools/get-characters.tool';
import { makeGetCharacterHistoryTool } from './tools/get-character-history.tool';
import { makeDeleteCharacterTool } from './tools/delete-character.tool';
import { makeClearCharactersTool } from './tools/clear-characters.tool';
import { makeListKnowledgeTool } from './tools/list-knowledge.tool';
import { makeGetKnowledgeTool } from './tools/get-knowledge.tool';
import { makeSetReferencesTool } from './tools/set-references.tool';
import { makeGetReferenceTool } from './tools/get-reference.tool';
import { makeAddReferenceTool } from './tools/add-reference.tool';
import { makeUpdateReferenceTool } from './tools/update-reference.tool';
import { makeDeleteReferenceTool } from './tools/delete-reference.tool';
import { makeGetEventsTool } from './tools/get-events.tool';
import { makeSetArcTool } from './tools/set-arc.tool';
import { makeGetArcsTool } from './tools/get-arcs.tool';
import { makeSetMasterOutlineTool } from './tools/set-master-outline.tool';
import { makeDeleteChapterPlanTool } from './tools/delete-chapter-plan.tool';
import { makeDeleteVolumeTool } from './tools/delete-volume.tool';
import { makeDeleteArcTool } from './tools/delete-arc.tool';
import { makeClearMasterOutlineTool } from './tools/clear-master-outline.tool';
import { makePatchChapterPlanTool } from './tools/patch-chapter-plan.tool';
import { makeWriteBenchmarkTool } from './tools/write-benchmark.tool';
import { makeGetRawChapterTool } from './tools/get-raw-chapter.tool';
import { makeGetDissectEntriesTool } from './tools/get-dissect-entries.tool';
import { makeReportDissectReviewTool } from './tools/report-dissect-review.tool';
import { makeGetBenchmarkTool } from './tools/get-benchmark.tool';

export interface ToolDeps {
  userId: string;
  novelId: string;
  readingChapterOrder: number | null;
  novels: NovelService;
  chapters: ChapterService;
  outlines: OutlineService;
  world: WorldEntryService;
  characters: CharacterService;
  references: NovelReferenceService;
  knowledge: KnowledgeService;
  snapshots: RevisionSnapshotService;
  summaries: SummaryService;
  events: StoryEventService;
  eventService: EventService;
  arcs: ArcService;
  masterOutlines: MasterOutlineService;
  prisma: PrismaService;
  bookId?: string; // 拆解 tools 用(novel-bound 工具不读)
  benchmark?: BenchmarkService; // 拆解 tools 用
}

type ToolFactory = (d: ToolDeps) => unknown;

export const TOOL_REGISTRY: Record<string, ToolFactory> = {
  get_novel_info: (d) =>
    makeGetNovelInfoTool({
      userId: d.userId,
      novelId: d.novelId,
      novels: d.novels,
    }),
  update_novel: (d) =>
    makeUpdateNovelTool({
      userId: d.userId,
      novelId: d.novelId,
      novels: d.novels,
    }),
  get_reading_chapter: (d) =>
    makeGetReadingChapterTool({
      userId: d.userId,
      novelId: d.novelId,
      readingChapterOrder: d.readingChapterOrder,
      chapters: d.chapters,
    }),
  get_outline: (d) =>
    makeGetOutlineTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  get_chapter_plan: (d) =>
    makeGetChapterPlanTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  get_worldview: (d) =>
    makeGetWorldviewTool({
      userId: d.userId,
      novelId: d.novelId,
      world: d.world,
    }),
  get_world_entry: (d) =>
    makeGetWorldEntryTool({
      userId: d.userId,
      novelId: d.novelId,
      world: d.world,
    }),
  get_character: (d) =>
    makeGetCharacterTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
  get_characters: (d) =>
    makeGetCharactersTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
  get_character_history: (d) =>
    makeGetCharacterHistoryTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
  get_events: (d) =>
    makeGetEventsTool({
      userId: d.userId,
      novelId: d.novelId,
      eventService: d.eventService,
    }),
  set_arc: (d) =>
    makeSetArcTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
      arcs: d.arcs,
    }),
  get_arcs: (d) =>
    makeGetArcsTool({
      userId: d.userId,
      novelId: d.novelId,
      arcs: d.arcs,
    }),
  set_master_outline: (d) =>
    makeSetMasterOutlineTool({
      userId: d.userId,
      novelId: d.novelId,
      masterOutlines: d.masterOutlines,
    }),
  delete_chapter_plan: (d) =>
    makeDeleteChapterPlanTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  delete_volume: (d) =>
    makeDeleteVolumeTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  delete_arc: (d) =>
    makeDeleteArcTool({
      userId: d.userId,
      novelId: d.novelId,
      arcs: d.arcs,
    }),
  clear_master_outline: (d) =>
    makeClearMasterOutlineTool({
      userId: d.userId,
      novelId: d.novelId,
      masterOutlines: d.masterOutlines,
    }),
  patch_chapter_plan: (d) =>
    makePatchChapterPlanTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  get_reference: (d) =>
    makeGetReferenceTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
  snapshot_chapter: (d) =>
    makeSnapshotChapterTool({
      userId: d.userId,
      novelId: d.novelId,
      snapshots: d.snapshots,
    }),
  restore_chapter: (d) =>
    makeRestoreChapterTool({
      userId: d.userId,
      novelId: d.novelId,
      snapshots: d.snapshots,
    }),
  check_prose: (d) =>
    makeCheckProseTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
      novels: d.novels,
    }),
  append_section: (d) =>
    makeAppendSectionTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
      novels: d.novels,
    }),
  replace_text: (d) =>
    makeReplaceTextTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
    }),
  insert_text: (d) =>
    makeInsertTextTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
    }),
  delete_text: (d) =>
    makeDeleteTextTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
    }),
  clear_chapter: (d) =>
    makeClearChapterTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
      snapshots: d.snapshots,
    }),
  set_chapter_title: (d) =>
    makeSetChapterTitleTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
    }),
  get_chapter: (d) =>
    makeGetChapterTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
    }),
  list_chapters: (d) =>
    makeListChaptersTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
    }),
  query_memory: (d) =>
    makeQueryMemoryTool({
      userId: d.userId,
      novelId: d.novelId,
      prisma: d.prisma,
    }),
  write_summary: (d) =>
    makeWriteSummaryTool({
      userId: d.userId,
      novelId: d.novelId,
      chapters: d.chapters,
      summaries: d.summaries,
      events: d.events,
      characters: d.characters,
      eventService: d.eventService,
      arcService: d.arcs,
      prisma: d.prisma,
    }),
  report_review: () => makeReportReviewTool(),
  report_worldview_review: () => makeReportWorldviewReviewTool(),
  report_outline_review: () => makeReportOutlineReviewTool(),
  report_character_review: () => makeReportCharacterReviewTool(),
  list_knowledge: (d) => makeListKnowledgeTool({ kb: d.knowledge }),
  get_knowledge: (d) => makeGetKnowledgeTool({ kb: d.knowledge }),
  set_references: (d) =>
    makeSetReferencesTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
  add_reference: (d) =>
    makeAddReferenceTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
  update_reference: (d) =>
    makeUpdateReferenceTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
  delete_reference: (d) =>
    makeDeleteReferenceTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
  set_world_entry: (d) =>
    makeSetWorldEntryTool({
      userId: d.userId,
      novelId: d.novelId,
      world: d.world,
    }),
  set_volume: (d) =>
    makeSetVolumeTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  set_chapter_plan: (d) =>
    makeSetChapterPlanTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  set_character: (d) =>
    makeSetCharacterTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
  delete_character: (d) =>
    makeDeleteCharacterTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
  clear_characters: (d) =>
    makeClearCharactersTool({
      userId: d.userId,
      novelId: d.novelId,
      characters: d.characters,
    }),
  write_benchmark: (d) =>
    makeWriteBenchmarkTool({
      userId: d.userId,
      bookId: d.bookId!,
      benchmark: d.benchmark!,
    }),
  get_raw_chapter: (d) =>
    makeGetRawChapterTool({ bookId: d.bookId!, prisma: d.prisma }),
  get_dissect_entries: (d) =>
    makeGetDissectEntriesTool({ bookId: d.bookId!, benchmark: d.benchmark! }),
  report_dissect_review: (d) =>
    makeReportDissectReviewTool({ bookId: d.bookId!, prisma: d.prisma }),
  get_benchmark: (d) =>
    makeGetBenchmarkTool({ userId: d.userId, prisma: d.prisma }),
};
