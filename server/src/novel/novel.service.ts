import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AGENT_ID } from '../agentos/agentos.constants';
import { ResourceRegistry } from '../resources/resource-registry';
import type { AcceptDto } from './dto/accept.dto';
import type { CreateNovelDto } from './dto/create-novel.dto';
import type { UpdateNovelDto } from './dto/update-novel.dto';

@Injectable()
export class NovelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ResourceRegistry,
  ) {}

  /** 建小说 + 1:1 聊天 Session + 种第一章。 */
  async create(userId: string, dto: CreateNovelDto) {
    const sessionId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: { id: sessionId, userId, agentId: AGENT_ID, name: dto.title },
      });
      return tx.novel.create({
        data: {
          userId,
          sessionId,
          title: dto.title,
          genre: dto.genre ?? null,
          synopsis: dto.synopsis ?? null,
          settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
          chapters: { create: [{ order: 1, title: '第1章' }] },
        },
        include: { chapters: { orderBy: { order: 'asc' } } },
      });
    });
  }

  list(userId: string) {
    return this.prisma.novel.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(userId: string, id: string) {
    const novel = await this.prisma.novel.findFirst({
      where: { id, userId },
      include: { chapters: { orderBy: { order: 'asc' } } },
    });
    if (!novel) throw new NotFoundException('Novel not found');
    return novel;
  }

  async update(userId: string, id: string, dto: UpdateNovelDto) {
    await this.assertOwned(userId, id);
    return this.prisma.novel.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.genre !== undefined && { genre: dto.genre }),
        ...(dto.synopsis !== undefined && { synopsis: dto.synopsis }),
        ...(dto.settings !== undefined && {
          settings: dto.settings as Prisma.InputJsonValue,
        }),
      },
    });
  }

  delete(userId: string, id: string) {
    return this.prisma.novel.deleteMany({ where: { id, userId } });
  }

  /** 「采纳」:校验小说归属后,把变更交给 mutation 层分发。 */
  async accept(userId: string, novelId: string, dto: AcceptDto) {
    await this.assertOwned(userId, novelId);
    await this.registry.dispatch(userId, {
      resource: 'chapter',
      targetId: dto.chapterId,
      op: dto.op,
      content: dto.content,
    });
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }
}
