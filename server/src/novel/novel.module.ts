import { Module } from '@nestjs/common';
import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';
import { ChapterService } from './chapter.service';
import { OutlineService } from './outline.service';
import { WorldEntryService } from './world-entry.service';
import { NovelReferenceService } from './novel-reference.service';
import { CharacterService } from './character.service';
import { RevisionSnapshotService } from './revision-snapshot.service';
import { ArcService } from './arc.service';
import { StatusService } from './status.service';
import { MasterOutlineService } from './master-outline.service';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [MemoryModule],
  controllers: [NovelController],
  providers: [
    NovelService,
    ChapterService,
    OutlineService,
    WorldEntryService,
    NovelReferenceService,
    CharacterService,
    RevisionSnapshotService,
    ArcService,
    StatusService,
    MasterOutlineService,
  ],
  // 导出 NovelService(会话 agent / Composer 注入)。
  // ChapterService 供 writer 专家 + Composer 注入:writer 的 append_section /
  // get_chapter / list_chapters 工具按章节序号解析,需要 ChapterService。
  // OutlineService 供大纲工具(set_volume/set_chapter_plan/get_outline/get_chapter_plan)注入。
  // WorldEntryService 供世界观工具(set_world_entry/get_worldview/get_world_entry)+
  // ContextAssembler(listCore 被动注入)注入。
  // NovelReferenceService 供参考资料工具(set_references/get_reference)+
  // DeepAgentService(writer 注入)+ ContextAssembler(main 注入)注入。
  exports: [
    NovelService,
    ChapterService,
    OutlineService,
    WorldEntryService,
    NovelReferenceService,
    CharacterService,
    RevisionSnapshotService,
    ArcService,
    StatusService,
    MasterOutlineService,
  ],
})
export class NovelModule {}
