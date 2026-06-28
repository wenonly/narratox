import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ReferenceInput {
  title: string;
  category?: string;
  content?: string;
  injectTo?: string | null;
  source?: string | null;
}

/**
 * 小说级参考资料(Plan 2)。curator 子 agent 在立项时从全局 KB 提炼出本书专属
 * 参考资料(去冗余),固化进 DB。写作全程按 injectTo 注入对应 agent context,
 * 其余条目由 agent 用 get_reference 工具按需拉取。
 *
 * 多租户隔离:novel 必须属于该 userId(同 WorldEntryService)。注入/面板/curator
 * 覆写都按 `novel:{userId}` 范围,模型无法越权访问其他用户的小说。
 */
@Injectable()
export class NovelReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwned(userId: string, novelId: string) {
    const n = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!n) throw new ForbiddenException('小说不存在或不属于该用户');
  }

  /** 面板 + 索引用:全部条目。 */
  async listAll(userId: string, novelId: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.novelReference.findMany({
      where: { novelId, novel: { userId } },
      orderBy: { order: 'asc' },
    });
  }

  /** 注入用:injectTo 命中 role 或 'both'。role 为任意 agent 角色名(如 main/writer/validator)。 */
  async listForInject(userId: string, novelId: string, role: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.novelReference.findMany({
      where: {
        novelId,
        novel: { userId },
        OR: [{ injectTo: role }, { injectTo: 'both' }],
      },
      orderBy: { order: 'asc' },
    });
  }

  /** curator 批量覆写:先清后插(幂等)。 */
  async replaceAll(userId: string, novelId: string, entries: ReferenceInput[]) {
    await this.assertOwned(userId, novelId);
    await this.prisma.novelReference.deleteMany({
      where: { novelId, novel: { userId } },
    });
    if (!entries.length) return { count: 0 };
    return this.prisma.novelReference.createMany({
      data: entries.map((e, i) => ({
        novelId,
        userId,
        title: e.title,
        category: e.category ?? '',
        content: e.content ?? '',
        injectTo: e.injectTo ?? null,
        source: e.source ?? null,
        order: i,
      })),
    });
  }

  async update(
    userId: string,
    novelId: string,
    rid: string,
    dto: Partial<ReferenceInput>,
  ) {
    await this.assertOwned(userId, novelId);
    // rid 必须属于本 novel:仅 assertOwned(novelId) 不够 —— rid 可能是别的 novel
    // (甚至别的用户)的参考资料,裸 update({where:{id:rid}}) 会改到别人的行(跨租户)。
    const owned = await this.prisma.novelReference.findFirst({
      where: { id: rid, novelId, novel: { userId } },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Reference not found');
    return this.prisma.novelReference.update({
      where: { id: owned.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.injectTo !== undefined && { injectTo: dto.injectTo }),
      },
    });
  }
}
