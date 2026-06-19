import type { ActivityEvent } from '../agentos/activity.types';
import { nextActId } from '../agentos/activity.types';
import type { StatelessAgent } from './stateless-agent';

/**
 * 流水线上下文:base 入参 + 各 stage 的产出(供下游 stage 的 input() 读取)。
 * 命令式编排(一串 await,像 inkos)—— stage 顺序跑,无并发。
 */
export interface PipelineCtx {
  userId: string;
  novelId: string;
  input: Record<string, unknown>;
  outputs: Record<string, Record<string, unknown>>;
}

export interface StageSpec {
  name: string;
  agent: StatelessAgent;
  /** 用上游 ctx 组装本 stage 的入参。 */
  input: (ctx: PipelineCtx) => Record<string, unknown>;
}

export interface Pipeline {
  name: string;
  stages: StageSpec[];
}

/**
 * 流水线运行器(spec §3.4)。维护 ctx → 顺序跑 stage(用 input() 组装入参 →
 * agent.run() 流式 → 产出写回 ctx.outputs[stageName])→ 整条流水线的活动事件实时流出。
 *
 * 每个 stage 包一对 Act(stage, label=name) / ActEnd(同 id):stage 是视觉分隔/标题,
 * 后续 think/tool 是平级条目(FE 用 stage 标题做视觉分组)。
 */
export class PipelineRunner {
  async *run(
    pipeline: Pipeline,
    base: { userId: string; novelId: string; input: Record<string, unknown> },
  ): AsyncGenerator<ActivityEvent> {
    const ctx: PipelineCtx = {
      userId: base.userId,
      novelId: base.novelId,
      input: base.input,
      outputs: {},
    };

    for (const stage of pipeline.stages) {
      const stageActId = nextActId('stage');
      yield { type: 'Act', id: stageActId, act: 'stage', label: stage.name };

      let lastErr: unknown;
      const collected: ActivityEvent[] = [];
      try {
        const stageInput = stage.input(ctx);
        for await (const ev of stage.agent.run({
          userId: base.userId,
          novelId: base.novelId,
          input: stageInput,
        })) {
          collected.push(ev);
          yield ev;
        }
        ctx.outputs[stage.name] = { ok: true };
        yield { type: 'ActEnd', id: stageActId, status: 'ok' };
      } catch (err) {
        lastErr = err;
        ctx.outputs[stage.name] = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        yield {
          type: 'ActEnd',
          id: stageActId,
          status: 'error',
          summary: err instanceof Error ? err.message : String(err),
        };
        // 上游 stage 失败 → 终止整条流水线(本批最小,无重试/回滚)。
        throw lastErr;
      }
      // collected 仅用于示意:当前 stage 产出可在下游 input() 里通过 ctx.outputs 取。
      void collected;
    }
  }
}
