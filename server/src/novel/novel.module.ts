import { Module } from '@nestjs/common';
import { ResourceRegistry } from '../resources/resource-registry';
import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';
import { ChapterService, ChapterHandler } from './chapter.service';
import { HandlerRegistrar } from './handler-registrar';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [MemoryModule],
  controllers: [NovelController],
  providers: [
    NovelService,
    ChapterService,
    ChapterHandler,
    ResourceRegistry,
    HandlerRegistrar,
  ],
  // 导出 NovelService(会话 agent / Composer 注入)与 ResourceRegistry(mutation 层)。
  // ChapterService 供 writer 专家 + Composer 注入:writer 的 append_section /
  // get_chapter / list_chapters 工具按章节序号解析,需要 ChapterService。
  exports: [NovelService, ChapterService, ResourceRegistry],
})
export class NovelModule {}
