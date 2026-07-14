import { Module } from '@nestjs/common';
import { SummaryService } from './chapter-summary.service';
import { StoryEventService } from './story-event.service';
import { EventService } from './event.service';
import { ProcessMemoryService } from './process-memory.service';

@Module({
  providers: [
    SummaryService,
    StoryEventService,
    EventService,
    ProcessMemoryService,
  ],
  exports: [
    SummaryService,
    StoryEventService,
    EventService,
    ProcessMemoryService,
  ],
})
export class MemoryModule {}
