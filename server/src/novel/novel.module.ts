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
})
export class NovelModule {}
