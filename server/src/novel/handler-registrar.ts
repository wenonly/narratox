import { Injectable, OnModuleInit } from '@nestjs/common';
import { ResourceRegistry } from '../resources/resource-registry';
import { ChapterHandler } from './chapter.service';

/** On startup, register the chapter handler into the mutation registry. */
@Injectable()
export class HandlerRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ResourceRegistry,
    private readonly chapterHandler: ChapterHandler,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.chapterHandler);
  }
}
