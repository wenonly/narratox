import { Global, Module } from '@nestjs/common';
import { AgentLoggerService } from './agent-logger.service';

@Global()
@Module({
  providers: [AgentLoggerService],
  exports: [AgentLoggerService],
})
export class LoggingModule {}
