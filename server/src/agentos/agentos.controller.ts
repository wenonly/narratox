import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AGENT_DB_ID, AGENT_ID, AGENT_NAME } from './agentos.constants';
import { DeepAgentService } from './deep-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

const now = (): number => Math.floor(Date.now() / 1000);
const toUnix = (d: Date): number => Math.floor(d.getTime() / 1000);

@Controller()
export class AgentosController {
  constructor(
    private readonly deepAgent: DeepAgentService,
    private readonly adapter: StreamAdapter,
    private readonly sessions: SessionsService,
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

  /** 列出会话（UI Sessions 侧边栏）。created_at/updated_at 为 unix 秒。 */
  @Get('sessions')
  async listSessions(): Promise<{
    data: Array<{
      session_id: string;
      session_name: string;
      created_at: number;
      updated_at: number;
    }>;
  }> {
    const rows = await this.sessions.listSessions(AGENT_ID);
    return {
      data: rows.map((s) => ({
        session_id: s.id,
        session_name: s.name,
        created_at: toUnix(s.createdAt),
        updated_at: toUnix(s.updatedAt),
      })),
    };
  }

  /** 某会话的历史 run（UI 点击侧边栏恢复时拉取）。返回裸数组。 */
  @Get('sessions/:id/runs')
  async getSessionRuns(
    @Param('id') id: string,
  ): Promise<Array<{ run_input: string; content: string; created_at: number }>> {
    const runs = await this.sessions.getRuns(id);
    return runs.map((r) => ({
      run_input: r.userContent,
      content: r.assistantContent,
      created_at: toUnix(r.createdAt),
    }));
  }

  /** 删除会话（UI SessionItem 的删除按钮）。 */
  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string): Promise<{ ok: true }> {
    await this.sessions.deleteSession(id);
    return { ok: true };
  }

  /**
   * 核心流式入口：multipart FormData -> 逐帧 JSON 推流。
   * 尊重入参 session_id（空→新建），用解析后的 id 作 thread_id；
   * 流成功结束后把这一轮逐字写入 messages 表供 UI 渲染。
   */
  @Post('agents/:id/runs')
  @UseInterceptors(NoFilesInterceptor())
  async runAgent(
    // phase 1 单 agent：路由的 :id 为兼容 AgentOS 而保留，实际固定用 AGENT_ID。
    @Param('id') _id: string,
    @Body() body: { message?: string; session_id?: string; stream?: string },
    @Res() res: Response,
  ): Promise<void> {
    const message = body?.message ?? '';
    res.setHeader('Content-Type', 'application/json');

    let sessionId = body?.session_id ?? '';
    let fullReply = '';
    let completed = false;

    try {
      // resolveSession 在首个 RunStarted 之前执行：若此刻 DB 不可达，客户端只会收到
      // 一帧裸 RunError（无 RunStarted、无 session_id），且 appendTurn 会被跳过。
      // 这是有意的——我们不希望在会话解析成功前凭空捏造 session_id。
      const session = await this.sessions.resolveSession(
        body?.session_id,
        AGENT_ID,
        message,
      );
      sessionId = session.id;

      for await (const frame of this.adapter.toFrames(
        AGENT_ID,
        sessionId,
        this.deepAgent.streamTurn({ threadId: sessionId, userMessage: message }),
      )) {
        if (frame.event === 'RunContent' || frame.event === 'RunCompleted') {
          fullReply = frame.content ?? fullReply;
        }
        if (frame.event === 'RunCompleted') completed = true;
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
      // 流成功且确有用户消息才落库；DB 写失败不回滚已推送的流（best-effort）。
      if (completed && message) {
        try {
          await this.sessions.appendTurn(sessionId, message, fullReply);
        } catch (err) {
          // best-effort：UI 已拿到流式回复，落库失败不应影响响应；但需记录以便排查。
          console.error(
            `[agentos] appendTurn failed for session ${sessionId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }
}
