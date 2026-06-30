import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assembleModelConfig } from '../agentos/vendor-model-assembler';
import type { ModelConfigRecord } from '../agentos/model-factory';

/**
 * 重构后职责缩为「读 activeModelId 拼装 ModelConfigRecord 给 DeepAgentService」。
 * 厂商/模型 CRUD 由 VendorService/ModelService 负责(见 vendor.service.ts / model.service.ts)。
 * 保留类名 ModelConfigService(AgentosModule 注入它拿 active 配置)。
 */
@Injectable()
export class ModelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** 服务端用:返回活动模型【含 apiKey】,Model+Vendor 拼装成 ModelConfigRecord。 */
  async getActive(userId: string): Promise<ModelConfigRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { activeModel: { include: { vendor: true } } },
    });
    const m = user?.activeModel;
    if (!m) return null;
    return assembleModelConfig(m, m.vendor);
  }
}
