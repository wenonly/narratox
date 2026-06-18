import { Injectable } from '@nestjs/common';
import pino from 'pino';

/**
 * 独立 pino 实例 → logs/agent.log(按天滚动),专给 agent 流写结构化事件。
 * forContext 返回带 sessionId/novelId/chapterOrder 的子 logger。
 * 错误用 { err } 触发 pino 默认错误序列化(type+message+stack)。
 */
@Injectable()
export class AgentLoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino(
      { level: 'info' },
      pino.transport({
        target: 'pino-roll',
        options: { file: 'logs/agent.log', frequency: 'daily', mkdir: true },
      }),
    );
  }

  forContext(ctx: {
    sessionId?: string;
    novelId?: string;
    chapterOrder?: number;
  }): pino.Logger {
    return this.logger.child(ctx);
  }
}
