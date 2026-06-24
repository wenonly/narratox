import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AGENT_ID } from './agentos.constants';
import { ContextAssembler } from './context-assembler.service';
import { SessionsService } from './sessions.service';
import { DeepAgentService } from './deep-agent.service';
import type { ActivityEvent } from './activity.types';
import { nextActId } from './activity.types';
import { aggregateActivities } from './activity-aggregator';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { parseReadingChapterOrder } from './reading-chapter';

const now = (): number => Math.floor(Date.now() / 1000);
const toUnix = (d: Date): number => Math.floor(d.getTime() / 1000);

@Controller()
export class AgentosController {
  private readonly logger = new Logger(AgentosController.name);

  constructor(
    private readonly deepAgent: DeepAgentService,
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
    Array<{
      run_input: string;
      content: string;
      activities: unknown;
      created_at: number;
    }>
  > {
    const runs = await this.sessions.getRuns(user.id, id);
    return runs.map((r) => ({
      run_input: r.userContent,
      content: r.assistantContent,
      activities: r.activities,
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
   * 核心流式入口:multipart FormData → 会话 agent →(可选)写章流水线 → 扁平活动流。
   *
   * 流式协议:RunStarted 包头 / RunCompleted 包尾;中间是扁平活动帧(Act/ActDelta/ActTool/
   * ActResult/ActEnd,每帧即时 flush 不缓冲)。会话 agent 的 think(推理)/content(正文)/tool,
   * 以及 run_pipeline 触发的 writer/settler 流水线活动,都汇入同一条扁平流。
   *
   * 聊天回复:聚合 collected 活动流 → contentMarkdown(带标记)+ activities,流首 startTurn 落 user 行(带 langGraphId),流末 finishTurn 落 assistant 行(isError 区分成功/失败),供 UI 渲染 + 历史恢复。
   */
  @Post('agents/:id/runs')
  @UseInterceptors(NoFilesInterceptor())
  async runAgent(
    // 路由的 :id 为兼容 AgentOS 而保留;实际 agent 由 session 绑定的小说决定。
    @CurrentUser() user: RequestUser,
    @Param('id') _id: string,
    @Body()
    body: {
      message?: string;
      session_id?: string;
      stream?: string;
      readingChapterOrder?: string;
    },
    @Res() res: Response,
    @Req() req?: Request,
  ): Promise<void> {
    const message = body?.message ?? '';
    const readingChapterOrder = parseReadingChapterOrder(
      body?.readingChapterOrder,
    );
    res.setHeader('Content-Type', 'application/json');

    // 客户端断开 → abort LangGraph stream(停掉 LLM/工具执行)。正常结束时 stream
    // 已结束,abort 无副作用。req 可选以兼容单测直接调用。
    const ac = new AbortController();
    req?.on('close', () => ac.abort());

    // socket 关闭后 write 会抛 ERR_STREAM_WRITE_AFTER_END —— 统一防御。
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(payload) + '\n');
    };

    let sessionId = body?.session_id ?? '';
    let contentMarkdown = '';
    let activities: unknown = {};
    let completed = false;
    let userMessageId: string | null = null;
    let errorMessage: string | null = null;
    try {
      const session = await this.sessions.resolveSession(
        user.id,
        body?.session_id,
        AGENT_ID,
        message,
      );
      sessionId = session.id;

      // 轮次开始:立即落 user 行(带 langGraphId,供消息撤回定位 checkpoint)。
      // 仅当确有用户输入时才写 —— 空消息不入库(避免空 user 行)。
      if (message) {
        try {
          userMessageId = await this.sessions.startTurn(
            user.id,
            sessionId,
            message,
            sessionId,
          );
        } catch (err) {
          // startTurn 失败不阻断流(user 行缺失则 finishTurn 也不再写)。
          this.logger.error(
            `[agentos] startTurn failed for session ${sessionId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }

      const { prompt, novelId } = await this.contextAssembler.forSession(
        user.id,
        session.id,
      );
      writeFrame({
        event: 'RunStarted',
        agent_id: AGENT_ID,
        session_id: sessionId,
        created_at: now(),
      });

      // 活动帧汇:每个 ActivityEvent 即时写一帧 newline-JSON(不缓冲),同时收进
      // collected。流末 aggregate → { contentMarkdown, activitiesLookup };
      // contentMarkdown 含 ::think/tool/stage 标记(与 FE 流式构建同构),
      // 落 assistant message.content 供刷新时重建交错文档。
      const collected: ActivityEvent[] = [];
      const emit = (ev: ActivityEvent): void => {
        collected.push(ev);
        writeFrame({ event: ev.type, ...ev, created_at: now() });
      };

      if (novelId) {
        await this.deepAgent.runTurn({
          userId: user.id,
          novelId,
          threadId: sessionId,
          userMessage: message,
          systemPrompt: prompt,
          emit,
          signal: ac.signal,
          readingChapterOrder,
        });
      } else {
        // 防御:工作台 session 必有关联小说;查不到时给一条可读提示而非崩溃。
        const id = nextActId('content');
        const fallback = '（未找到关联的小说,请从书架进入一本小说后再对话。）';
        emit({ type: 'Act', id, act: 'content' });
        emit({ type: 'ActDelta', id, text: fallback });
        emit({ type: 'ActEnd', id, status: 'ok' });
      }

      const aggregated = aggregateActivities(collected);
      contentMarkdown = aggregated.contentMarkdown;
      activities = aggregated.activities;

      writeFrame({
        event: 'RunCompleted',
        content: contentMarkdown,
        created_at: now(),
      });
      completed = true;
    } catch (err) {
      // 记录完整错误(类型/message/stack/cause)—— RunError 帧只带 message,栈会丢。
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        err instanceof Error ? err : new Error(String(err)),
        `[agentos] run stream failed (session ${sessionId})`,
      );
      writeFrame({
        event: 'RunError',
        content: errorMessage,
        created_at: now(),
      });
    } finally {
      res.end();
      // 有 user 行才补 assistant 行(成功/失败都补):成功落聚合正文+activities,
      // 失败落错误文案(isError=true)。DB 写失败不回滚已推送的流(best-effort)。
      // 模型可能只调工具(append_section)而不输出聊天文字 → contentMarkdown 为空 → 给占位,
      // 保持 user/assistant 配对且不显示空气泡。
      if (userMessageId !== null) {
        const isError = !completed;
        const reply = isError
          ? (errorMessage ?? '（运行失败）')
          : contentMarkdown.trim() || '（已写入章节正文）';
        try {
          await this.sessions.finishTurn(
            user.id,
            sessionId,
            reply,
            activities,
            isError,
          );
        } catch (err) {
          this.logger.error(
            `[agentos] finishTurn failed for session ${sessionId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }
  }
}
