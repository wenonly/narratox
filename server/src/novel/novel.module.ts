import { Module } from '@nestjs/common';
import { ResourceRegistry } from '../resources/resource-registry';
import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';
import { ChapterService, ChapterHandler } from './chapter.service';
import { OutlineService } from './outline.service';
import { WorldEntryService } from './world-entry.service';
import { HandlerRegistrar } from './handler-registrar';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [MemoryModule],
  controllers: [NovelController],
  providers: [
    NovelService,
    ChapterService,
    OutlineService,
    WorldEntryService,
    ChapterHandler,
    ResourceRegistry,
    HandlerRegistrar,
  ],
  // 导出 NovelService(会话 agent / Composer 注入)与 ResourceRegistry(mutation 层)。
  // ChapterService 供 writer 专家 + Composer 注入:writer 的 append_section /
  // get_chapter / list_chapters 工具按章节序号解析,需要 ChapterService。
  // OutlineService 供大纲工具(set_volume/set_chapter_plan/get_outline/get_chapter_plan)注入。
  // WorldEntryService 供世界观工具(set_world_entry/get_worldview/get_world_entry)+
  // ContextAssembler(listCore 被动注入)注入。
  exports: [
    NovelService,
    ChapterService,
    OutlineService,
    WorldEntryService,
    ResourceRegistry,
  ],
})
export class NovelModule {}
