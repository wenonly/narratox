import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

/**
 * 厂商(Vendor)CRUD —— 凭证级(provider/baseUrl/apiKey),下挂 N 个 Model。
 * 响应一律脱敏(apiKey 不出服务,只返 hasApiKey)。
 */
@Injectable()
export class VendorService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    // 读 user.activeModelId 用于给每个 model 标记 active(默认模型)。
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeModelId: true },
    });
    const activeModelId = user?.activeModelId ?? null;
    const rows = await this.prisma.vendor.findMany({
      where: { userId },
      include: { models: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ apiKey, ...rest }) => ({
      ...rest,
      hasApiKey: Boolean(apiKey),
      models: rest.models.map((m) => ({
        ...m,
        active: m.id === activeModelId,
      })),
    }));
  }

  async create(userId: string, dto: CreateVendorDto) {
    const row = await this.prisma.vendor.create({
      data: { ...dto, userId },
      include: { models: true },
    });
    const { apiKey, ...rest } = row;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }

  async update(userId: string, id: string, dto: UpdateVendorDto) {
    await this.assertOwned(userId, id);
    const data: Record<string, unknown> = { ...dto };
    // 空串或 undefined = 不改 apiKey
    if (dto.apiKey === undefined || dto.apiKey === '') delete data.apiKey;
    const row = await this.prisma.vendor.update({
      where: { id },
      data,
      include: { models: true },
    });
    const { apiKey, ...rest } = row;
    return { ...rest, hasApiKey: Boolean(apiKey) };
  }

  async delete(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.vendor.delete({ where: { id } });
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.vendor.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Vendor not found');
  }
}
