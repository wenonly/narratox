import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AGENT_DB_ID, AGENT_ID, AGENT_NAME } from './agentos.constants';
import { DeepAgentService } from './deep-agent.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

const now = (): number => Math.floor(Date.now() / 1000);

@Controller()
export class AgentosController {
  constructor(
    private readonly deepAgent: DeepAgentService,
    private readonly adapter: StreamAdapter,
  ) {}

  /** UI 心跳门：status 200 即标记 endpoint 激活。 */
  @Get('health')
  health(): Record<string, never> {
    return {};
  }

  /** 返回一个写死的 agent，UI 据此自动选中。 */
  @Get('agents')
  agents(): Array<{ id: string; name: string; db_id: string }> {
    return [{ id: AGENT_ID, name: AGENT_NAME, db_id: AGENT_DB_ID }];
  }

  /** 核心流式入口：multipart FormData -> 逐帧 JSON 推流。 */
  @Post('agents/:id/runs')
  // phase 1 纯对话：UI 只发文本 FormData 字段（message/stream/session_id），不收文件。
  // NoFilesInterceptor 用 multer 的 .none() 解析文本字段进 @Body()，并拒绝文件上传。
  @UseInterceptors(NoFilesInterceptor())
  async runAgent(
    // phase 1 单 agent：路由的 :id 为兼容 AgentOS 而保留，实际固定用 AGENT_ID，暂未使用。
    @Param('id') _id: string,
    @Body() body: { message?: string; session_id?: string; stream?: string },
    @Res() res: Response,
  ): Promise<void> {
    const message = body?.message ?? '';
    const sessionId = randomUUID();
    res.setHeader('Content-Type', 'application/json');

    try {
      for await (const frame of this.adapter.toFrames(
        AGENT_ID,
        sessionId,
        this.deepAgent.streamDeltas(message),
      )) {
        res.write(JSON.stringify(frame) + '\n');
      }
    } catch (err) {
      const errorFrame: AgentosFrame = {
        event: 'RunError',
        content: err instanceof Error ? err.message : String(err),
        created_at: now(),
      };
      res.write(JSON.stringify(errorFrame) + '\n');
    } finally {
      res.end();
    }
  }
}
