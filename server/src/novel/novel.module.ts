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
  // 导出 NovelService(创作 Agent 注入)与 ResourceRegistry(Task 6 WorkspaceSwarm 注入)。
  // ChapterService 供 WorkspaceSwarmService 注入:writer 的 list_chapters /
  // write_chapter 工具按章节序号解析,需要 ChapterService.findByOrder/list。
  exports: [NovelService, ChapterService, ResourceRegistry],
})
export class NovelModule {}
