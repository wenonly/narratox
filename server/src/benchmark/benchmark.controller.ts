import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { BenchmarkService } from './benchmark.service';
import { DissectAgentService } from '../agentos/dissect-agent.service';

/**
 * 对标拆解 HTTP 入口(路由前缀 /benchmarks):
 *  - POST /upload:multipart file → BenchmarkService.upload 切章落库;
 *  - GET /:list / detail;
 *  - POST /:id/dissect:启动后台拆解 + 同连接流化活动帧(SSE-like newline-JSON);
 *  - GET /:id/stream:断线重连 —— 订阅正在跑的 job emitter;
 *  - DELETE /:id。
 *
 * 拆解是后台异步任务(DissectAgentService.startDissect 不 await),HTTP 连接只负责
 * 把 emitter 的 activity 事件流化给前端;客户端断开会停流化但不停 agent(后台继续跑)。
 */
@Controller('benchmarks')
export class BenchmarkController {
  constructor(
    private readonly benchmarks: BenchmarkService,
    private readonly dissectService: DissectAgentService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
  ): Promise<{ id: string; chapterCount: number; estTokens: number }> {
    if (!file) throw new Error('未收到文件');
    const rawText = file.buffer.toString('utf-8');
    const book = await this.benchmarks.upload(
      user.id,
      title || file.originalname,
      rawText,
    );
    const chapterCount = (book.chapters as unknown[])?.length ?? 0;
    return { id: book.id, chapterCount, estTokens: chapterCount * 4000 };
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.benchmarks.list(user.id);
  }

  @Get(':id')
  async detail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.benchmarks.getWithEntries(user.id, id);
  }

  /**
   * 启动拆解并把活动帧流化到当前连接(newline-JSON)。流程:
   *  1. 防 RUNNING 重复启动;
   *  2. startDissect(后台 IIFE 跑 agent)+ 取 job emitter;
   *  3. RunStarted 头帧 → 心跳(15s)→ activity 帧流化 → 'done' 事件收尾 RunCompleted。
   * 客户端断开(req close)→ 仅停流化(清理监听),后台 agent 继续。
   */
  @Post(':id/dissect')
  async dissect(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(payload) + '\n');
    };

    const book = await this.benchmarks.get(user.id, id);
    if (book.status === 'RUNNING') {
      writeFrame({ event: 'RunError', content: '该任务正在拆解中' });
      res.end();
      return;
    }

    await this.dissectService.startDissect(user.id, id);
    const job = this.dissectService.getJob(id);

    writeFrame({ event: 'RunStarted', book_id: id, created_at: Date.now() });

    const heartbeat = setInterval(
      () => writeFrame({ event: 'Heartbeat' }),
      15_000,
    );
    const onActivity = (ev: unknown): void =>
      writeFrame({ event: 'activity', activity: ev });
    job?.emitter.on('activity', onActivity);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      job?.emitter.off('activity', onActivity);
      if (!res.writableEnded) {
        writeFrame({ event: 'RunCompleted', created_at: Date.now() });
        res.end();
      }
    };
    job?.emitter.once('done', cleanup);
    req.on('close', cleanup);
  }

  /**
   * 断线重连:订阅正在跑的 job emitter。job 不在(已结束 / 未启动)→ 立即回 RunCompleted + book.status。
   */
  @Get(':id/stream')
  async stream(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(JSON.stringify(payload) + '\n');
      }
    };

    const job = this.dissectService.getJob(id);
    if (!job) {
      const book = await this.benchmarks.get(user.id, id);
      writeFrame({ event: 'RunCompleted', status: book.status });
      res.end();
      return;
    }

    const heartbeat = setInterval(
      () => writeFrame({ event: 'Heartbeat' }),
      15_000,
    );
    const onActivity = (ev: unknown): void =>
      writeFrame({ event: 'activity', activity: ev });
    job.emitter.on('activity', onActivity);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      job.emitter.off('activity', onActivity);
      if (!res.writableEnded) {
        writeFrame({ event: 'RunCompleted' });
        res.end();
      }
    };
    job.emitter.once('done', cleanup);
    req.on('close', cleanup);
  }

  @Delete(':id')
  async delete(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.benchmarks.delete(user.id, id);
    return { ok: true };
  }
}
