import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { SessionsService } from './sessions.service';
import { PipelineModule } from '../pipeline/pipeline.module';
import { NovelModule } from '../novel/novel.module';
import { MemoryModule } from '../memory/memory.module';

/**
 * v2 基石:swarm 已退役,会话 agent + 无状态流水线由 PipelineModule 提供。
 * checkpointer provider 也随会话 agent 迁入 PipelineModule。ContextAssembler
 * (会话 agent 的状态感知 prompt)+ SessionsService 仍由本模块提供。
 */
@Module({
  imports: [NovelModule, MemoryModule, PipelineModule],
  controllers: [AgentosController],
  providers: [SessionsService, ContextAssembler],
})
export class AgentosModule {}
