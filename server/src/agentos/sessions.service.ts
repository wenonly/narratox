import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Session } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_NAME = 30;

function seedName(hint: string): string {
  const trimmed = hint.trim();
  if (!trimmed) return 'New chat';
  return trimmed.length > MAX_NAME ? trimmed.slice(0, MAX_NAME) : trimmed;
}

/** 一轮对话（配对后的 user+assistant），用于 GET /sessions/:id/runs。 */
export interface RunPair {
  userContent: string;
  assistantContent: string;
  createdAt: Date;
  /** assistant 行的 activities（未落库时为 null）。 */
  activities: unknown;
  /** user 行的 DB id(撤回锚点)。 */
  userMessageId: string;
  /** user 行的 langgraph message id(撤回定位 checkpoint);历史行可能为 null。 */
  langGraphId: string | null;
  /** assistant 行整轮失败标记(功能①回显)。 */
  isError: boolean;
}

/**
 * 纯 Prisma 的 UI 只读模型：sessions 列表/命名 + 逐字 transcript。
 * agent 记忆由 checkpointer 管理，不读本服务写入的 messages。
 * 所有方法都按 userId 隔离——用户永远读写不到别人的会话。
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 解析会话（按 userId 隔离）：
   * - 无 id → 为该用户新建(uuid)；
   * - 有 id 且归属本用户 → 复用；
   * - 有 id 但属于他人（或不存在）→ 为该用户新建一个随机 uuid，
   *   不泄露、不复用别人的会话。
   */
  async resolveSession(
    userId: string,
    maybeId: string | undefined,
    agentId: string,
    firstNameHint: string,
  ): Promise<Session> {
    if (maybeId) {
      const existing = await this.prisma.session.findUnique({
        where: { id: maybeId },
      });
      if (existing && existing.userId === userId) return existing;
    }
    return this.prisma.session.create({
      data: {
        id: randomUUID(),
        userId,
        agentId,
        name: seedName(firstNameHint),
      },
    });
  }

  /** 列出某用户某 agent 的会话，按 updated_at 倒序。 */
  async listSessions(userId: string, agentId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, agentId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 把逐字消息配对成 runs（user 在前、紧跟其 assistant），oldest-first。 */
  async getRuns(userId: string, sessionId: string): Promise<RunPair[]> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!owned) return [];
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    const runs: RunPair[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const userRow = messages[i] as {
        role: string;
        content: string;
        id: string;
        langGraphId: string | null;
        createdAt: Date;
      };
      const assistantRow = messages[i + 1] as {
        role: string;
        content: string;
        activities?: unknown;
        isError?: boolean;
      };
      if (userRow.role === 'user' && assistantRow.role === 'assistant') {
        runs.push({
          userContent: userRow.content,
          assistantContent: assistantRow.content,
          createdAt: userRow.createdAt,
          activities: assistantRow.activities ?? null,
          userMessageId: userRow.id,
          langGraphId: userRow.langGraphId,
          isError: assistantRow.isError ?? false,
        });
        i++; // consume the assistant message too
      }
    }
    return runs;
  }

  /**
   * 轮次开始:立即建 user 消息行(带 langGraphId,供撤回定位 checkpoint),
   * 并刷新 updatedAt。整轮失败时该行也保留(错误 assistant 行由 finishTurn 写)。
   * 返回新建行 id;不属于本用户 → null(no-op,绝不改别人的会话)。
   */
  async startTurn(
    userId: string,
    sessionId: string,
    userContent: string,
    langGraphId: string,
  ): Promise<string | null> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!owned) return null;
    const created = await this.prisma.message.create({
      data: { sessionId, role: 'user', content: userContent, langGraphId },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
    return created.id;
  }

  /**
   * 轮次结束:写 assistant 消息行(成功/失败都调)。isError=true 时 content 为错误文案。
   * 不属于本用户 → no-op。userId 仅作二次 ownership 校验(行本身按 sessionId 归属)。
   */
  async finishTurn(
    userId: string,
    sessionId: string,
    assistantContent: string,
    activities: unknown,
    isError: boolean,
  ): Promise<void> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!owned) return;
    await this.prisma.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: assistantContent,
        activities: activities ?? undefined,
        isError,
      },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  /** 删除会话行（仅限本用户；messages 随 onDelete:Cascade 一并删除）。 */
  async deleteSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    });
  }
}
