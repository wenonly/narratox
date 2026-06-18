import { Module } from '@nestjs/common';
import { SummaryService } from './chapter-summary.service';
import { StoryEventService } from './story-event.service';

@Module({
  providers: [SummaryService, StoryEventService],
  exports: [SummaryService, StoryEventService],
})
export class MemoryModule {}
