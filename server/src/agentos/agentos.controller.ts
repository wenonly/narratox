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
import { AGENT_ID } from './agentos.constants';
import { extractDelta } from './agent-tools';
import { ContextAssembler } from './context-assembler.service';
import { CreationAgentService } from './creation-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';
import { WorkspaceSwarmService } from './workspace-swarm.service';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';

const now = (): number => Math.floor(Date.now() / 1000);
const toUnix = (d: Date): number => Math.floor(d.getTime() / 1000);
const randomCreationThreadId = (): string =>
  `creation-${Math.random().toString(36).slice(2)}-${now()}`;

@Controller()
export class AgentosController {
  constructor(
    private readonly creationAgent: CreationAgentService,
    private readonly workspace: WorkspaceSwarmService,
    private readonly adapter: StreamAdapter,
    private readonly sessions: SessionsService,
    private readonly contextAssembler: ContextAssembler,
  ) {}

  /** UI 心跳门：status 200 即标记 endpoint 激活。公开。 */
  @Public()
  @Get('health')
  health(): Record<string, never> {
    return {};
  }

  /** 列出当前用户的会话（UI Sessions 侧边栏）。created_at/updated_at 为 unix 秒。 */
  @Get('sessions')
  async listSessions(@CurrentUser() user: RequestUser): Promise<{
    data: Array<{
      session_id: string;
      session_name: string;
      created_at: number;
      updated_at: number;
    }>;
  }> {
    const rows = await this.sessions.listSessions(user.id, AGENT_ID);
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
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<
    Array<{ run_input: string; content: string; created_at: number }>
  > {
    const runs = await this.sessions.getRuns(user.id, id);
    return runs.map((r) => ({
      run_input: r.userContent,
      content: r.assistantContent,
      created_at: toUnix(r.createdAt),
    }));
  }

  /** 删除会话（UI SessionItem 的删除按钮）。 */
  @Delete('sessions/:id')
  async deleteSession(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.sessions.deleteSession(user.id, id);
    return { ok: true };
  }

  /**
   * 创作模式的增量 token 生成器:构建创作 agent 并将其 message 流抽成 string deltas。
   * 抽成独立方法而非 IIFE,既保留 `this` 绑定(creationAgent/extractDelta),
   * 又避免 async-generator 在 eslint 下的 require-await 误报。
   */
  private async *creationDeltas(
    userId: string,
    threadId: string,
    message: string,
  ): AsyncGenerator<string> {
    const agent = await this.creationAgent.build(userId);
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: message }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const delta = extractDelta(chunk);
      if (delta) yield delta;
    }
  }

  /**
   * 核心流式入口：multipart FormData -> 逐帧 JSON 推流。
   * 尊重入参 session_id（空→新建），用解析后的 id 作 thread_id；
   * 流成功结束后把这一轮逐字写入 messages 表供 UI 渲染。
   */
  @Post('agents/:id/runs')
  @UseInterceptors(NoFilesInterceptor())
  async runAgent(
    // 路由的 :id 为兼容 AgentOS 而保留;实际 agent 由 mode 决定。
    @CurrentUser() user: RequestUser,
    @Param('id') _id: string,
    @Body()
    body: {
      message?: string;
      session_id?: string;
      stream?: string;
      mode?: 'creation' | 'workspace';
    },
    @Res() res: Response,
  ): Promise<void> {
    const message = body?.message ?? '';
    res.setHeader('Content-Type', 'application/json');

    // mode 缺省:带 session_id 视为 workspace(已建书),否则进入创作问答。
    const mode: 'creation' | 'workspace' =
      body?.mode ?? (body?.session_id ? 'workspace' : 'creation');

    // 创作:每轮构建创作 agent(闭包带 userId),直接 stream。不落库(创作问答临时)。
    // 与 workspace 分支走同一个 StreamAdapter.toFrames,保证 RunContent.content 是
    // 累积全文(UI 端 useAIStreamHandler 用 replace(lastContent) 取增量)。
    if (mode === 'creation') {
      const threadId = body?.session_id ?? randomCreationThreadId();
      try {
        for await (const frame of this.adapter.toFrames(
          'creation',
          threadId,
          this.creationDeltas(user.id, threadId, message),
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
      return;
    }

    // workspace:沿用原流程,streamTurn 来自 WorkspaceSwarmService。
    let sessionId = body?.session_id ?? '';
    let fullReply = '';
    let completed = false;
    try {
      const session = await this.sessions.resolveSession(
        user.id,
        body?.session_id,
        AGENT_ID,
        message,
      );
      sessionId = session.id;
      const { prompt, novelId } = await this.contextAssembler.forSession(
        user.id,
        session.id,
      );
      res.write(
        JSON.stringify({
          event: 'RunStarted',
          agent_id: AGENT_ID,
          session_id: sessionId,
          created_at: now(),
        }) + '\n',
      );
      for await (const item of this.workspace.streamTurn({
        userId: user.id,
        // novelId 为 null 表示该 session 没有对应小说 —— 理论上 workspace 分支
        // 不该跑到这里,但防御性地传空串,让 swarm 在 list/write 工具里抛错,
        // 而不是静默误写到错误的章节。
        novelId: novelId ?? '',
        threadId: sessionId,
        userMessage: message,
        systemPrompt: prompt,
      })) {
        if (typeof item === 'string') {
          fullReply += item;
          res.write(
            JSON.stringify({
              event: 'RunContent',
              content: fullReply,
              created_at: now(),
            }) + '\n',
          );
        } else if (item.type === 'writing-chapter') {
          res.write(
            JSON.stringify({
              event: 'WritingChapter',
              order: item.order,
              created_at: now(),
            }) + '\n',
          );
        }
      }
      res.write(
        JSON.stringify({
          event: 'RunCompleted',
          content: fullReply,
          created_at: now(),
        }) + '\n',
      );
      completed = true;
    } catch (err) {
      const errorFrame: AgentosFrame = {
        event: 'RunError',
        content: err instanceof Error ? err.message : String(err),
        created_at: now(),
      };
      res.write(JSON.stringify(errorFrame) + '\n');
    } finally {
      res.end();
      // 流成功且确有用户消息才落库;DB 写失败不回滚已推送的流(best-effort)。
      if (completed && message) {
        try {
          await this.sessions.appendTurn(
            user.id,
            sessionId,
            message,
            fullReply,
          );
        } catch (err) {
          console.error(
            `[agentos] appendTurn failed for session ${sessionId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }
}
