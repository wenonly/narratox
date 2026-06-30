import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModelDto, UpdateModelDto } from './dto/model.dto';

/**
 * 模型(Model)CRUD —— 挂在 Vendor 下,带 per-model temperature/name。
 * 归属校验经「vendor.models.some(id) AND vendor.userId」走通,确保跨用户不可访问。
 */
@Injectable()
export class ModelService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, vendorId: string, dto: CreateModelDto) {
    await this.assertVendorOwned(userId, vendorId);
    return this.prisma.model.create({ data: { ...dto, vendorId } });
  }

  async update(userId: string, id: string, dto: UpdateModelDto) {
    await this.assertModelOwned(userId, id);
    return this.prisma.model.update({ where: { id }, data: dto });
  }

  async delete(userId: string, id: string) {
    await this.assertModelOwned(userId, id);
    await this.prisma.model.delete({ where: { id } });
  }

  /** 设为默认模型:校验归属后更新 User.activeModelId。 */
  async activate(userId: string, id: string) {
    await this.assertModelOwned(userId, id);
    await this.prisma.user.update({
      where: { id: userId },
      data: { activeModelId: id },
    });
  }

  private async assertVendorOwned(userId: string, vendorId: string) {
    const owned = await this.prisma.vendor.findFirst({
      where: { id: vendorId, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Vendor not found');
  }

  private async assertModelOwned(userId: string, modelId: string) {
    const owned = await this.prisma.vendor.findFirst({
      where: { models: { some: { id: modelId } }, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Model not found');
  }
}
