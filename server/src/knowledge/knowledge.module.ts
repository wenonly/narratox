import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { KnowledgeController } from './knowledge.controller';
import { KB_DIR, KnowledgeService } from './knowledge.service';

@Module({
  controllers: [KnowledgeController],
  providers: [
    {
      provide: KB_DIR,
      useFactory: () =>
        process.env.KB_DIR ?? resolve(process.cwd(), '..', '知识库'),
    },
    {
      provide: KnowledgeService,
      useFactory: (kbDir: string) => new KnowledgeService(kbDir),
      inject: [KB_DIR],
    },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
