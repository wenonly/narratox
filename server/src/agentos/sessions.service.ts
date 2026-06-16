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
}

/**
 * 纯 Prisma 的 UI 只读模型：sessions 列表/命名 + 逐字 transcript。
 * agent 记忆由 checkpointer 管理，不读本服务写入的 messages。
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 解析会话：无 id→新建(uuid)；有 id 且存在→复用；有 id 但缺失→按该 id 建(upsert)。
   * 新建时用首条用户消息截断 30 字作为 name。
   */
  async resolveSession(
    maybeId: string | undefined,
    agentId: string,
    firstNameHint: string,
  ): Promise<Session> {
    if (maybeId) {
      const existing = await this.prisma.session.findUnique({
        where: { id: maybeId },
      });
      if (existing) return existing;
      return this.prisma.session.create({
        data: { id: maybeId, agentId, name: seedName(firstNameHint) },
      });
    }
    return this.prisma.session.create({
      data: { id: randomUUID(), agentId, name: seedName(firstNameHint) },
    });
  }

  /** 列出某 agent 的所有会话，按 updated_at 倒序。 */
  async listSessions(agentId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { agentId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 把逐字消息配对成 runs（user 在前、紧跟其 assistant），oldest-first。 */
  async getRuns(sessionId: string): Promise<RunPair[]> {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    const runs: RunPair[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
        runs.push({
          userContent: messages[i].content,
          assistantContent: messages[i + 1].content,
          createdAt: messages[i].createdAt,
        });
        i++; // consume the assistant message too
      }
    }
    return runs;
  }

  /** 流结束后落库一轮的逐字 user+assistant，并刷新 updatedAt。 */
  async appendTurn(
    sessionId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    await this.prisma.message.create({
      data: { sessionId, role: 'user', content: userContent },
    });
    await this.prisma.message.create({
      data: { sessionId, role: 'assistant', content: assistantContent },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  /** 删除会话行（messages 随 onDelete:Cascade 一并删除）。 */
  async deleteSession(sessionId: string): Promise<void> {
    await this.prisma.session.delete({ where: { id: sessionId } });
  }
}
