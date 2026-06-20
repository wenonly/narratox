import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Verdict =
  | { ok: true; chars: number }
  | { ok: false; reason: 'no_chapter' | 'no_snapshot' };

/**
 * 修订回滚支撑(D1)。进程内 `Map<novelId:order, content>` 存修订前的章节正文。
 * 修订闭环在单个 runAgent turn 内完成,无需跨重启持久化。key 覆盖写,不清理(小)。
 *
 * snapshot:读当前 Chapter.content 入 map(修订前调用)。
 * restore:把 map 内容写回 Chapter.content(若修订后更差则回滚原版)。
 * user-scoped(经 novel:{userId})。
 */
@Injectable()
export class RevisionSnapshotService {
  private readonly snapshots = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async snapshot(
    userId: string,
    novelId: string,
    order: number,
  ): Promise<Verdict> {
    const ch = await this.prisma.chapter.findFirst({
      where: { novelId, order, novel: { userId } },
      select: { content: true },
    });
    if (!ch) return { ok: false, reason: 'no_chapter' };
    const content = ch.content ?? '';
    this.snapshots.set(`${novelId}:${order}`, content);
    return { ok: true, chars: content.length };
  }

  async restore(
    userId: string,
    novelId: string,
    order: number,
  ): Promise<Verdict> {
    const key = `${novelId}:${order}`;
    const content = this.snapshots.get(key);
    if (content === undefined) return { ok: false, reason: 'no_snapshot' };
    const ch = await this.prisma.chapter.findFirst({
      where: { novelId, order, novel: { userId } },
      select: { id: true },
    });
    if (!ch) return { ok: false, reason: 'no_chapter' };
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content },
    });
    return { ok: true, chars: content.length };
  }
}
