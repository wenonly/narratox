import { Module } from '@nestjs/common';
import { SummaryService } from './chapter-summary.service';
import { StoryEventService } from './story-event.service';
import { EventService } from './event.service';

@Module({
  providers: [SummaryService, StoryEventService, EventService],
  exports: [SummaryService, StoryEventService, EventService],
})
export class MemoryModule {}
