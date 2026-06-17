import { Module } from '@nestjs/common';
import { ResourceRegistry } from '../resources/resource-registry';
import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';
import { ChapterService, ChapterHandler } from './chapter.service';
import { HandlerRegistrar } from './handler-registrar';

@Module({
  controllers: [NovelController],
  providers: [
    NovelService,
    ChapterService,
    ChapterHandler,
    ResourceRegistry,
    HandlerRegistrar,
  ],
  // 导出 NovelService(创作 Agent 注入)与 ResourceRegistry(Task 6 WorkspaceSwarm 注入)。
  exports: [NovelService, ResourceRegistry],
})
export class NovelModule {}
