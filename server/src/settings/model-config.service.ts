import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';

type ModelConfigRow = Awaited<
  ReturnType<PrismaService['modelConfig']['findUnique']>
>;

/** 脱敏后的响应类型(不含 apiKey)。 */
export type MaskedModelConfig = Omit<NonNullable<ModelConfigRow>, 'apiKey'> & {
  hasApiKey: boolean;
  active: boolean;
};

@Injectable()
export class ModelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<MaskedModelConfig[]> {
    const [configs, activeId] = await Promise.all([
      this.prisma.modelConfig.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.getActiveId(userId),
    ]);
    return configs.map((c) => this.mask(c, c.id === activeId));
  }

  /** 服务端用:返回活动配置【含 apiKey】(供 DeepAgentService 工厂)。 */
  async getActive(userId: string): Promise<NonNullable<ModelConfigRow> | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { activeModelConfig: true },
    });
    return user?.activeModelConfig ?? null;
  }

  async create(
    userId: string,
    dto: CreateModelConfigDto,
  ): Promise<MaskedModelConfig> {
    const created = await this.prisma.modelConfig.create({
      data: { ...dto, userId },
    });
    return this.mask(created, false);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateModelConfigDto,
  ): Promise<MaskedModelConfig> {
    await this.assertOwned(userId, id);
    const { apiKey, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (apiKey !== undefined && apiKey !== '') data.apiKey = apiKey;
    const updated = await this.prisma.modelConfig.update({
      where: { id },
      data,
    });
    const activeId = await this.getActiveId(userId);
    return this.mask(updated, updated.id === activeId);
  }

  async delete(userId: string, id: string): Promise<{ ok: true }> {
    await this.assertOwned(userId, id);
    if ((await this.getActiveId(userId)) === id) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { activeModelConfigId: null },
      });
    }
    await this.prisma.modelConfig.delete({ where: { id } });
    return { ok: true };
  }

  async activate(userId: string, id: string): Promise<{ ok: true }> {
    await this.assertOwned(userId, id);
    await this.prisma.user.update({
      where: { id: userId },
      data: { activeModelConfigId: id },
    });
    return { ok: true };
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.modelConfig.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Model config not found');
  }

  private async getActiveId(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeModelConfigId: true },
    });
    return u?.activeModelConfigId ?? null;
  }

  private mask(
    row: NonNullable<ModelConfigRow>,
    active: boolean,
  ): MaskedModelConfig {
    const { apiKey, ...rest } = row;
    void apiKey;
    return { ...rest, hasApiKey: Boolean(apiKey), active };
  }
}
