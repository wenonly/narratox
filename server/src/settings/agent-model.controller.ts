import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { AgentModelOverrideService } from './agent-model-override.service';
import {
  buildAgentGroups,
  type AgentGroup,
} from '../agentos/agent-tree.config';
import { UpsertAgentOverrideDto } from './dto/agent-model-override.dto';

/**
 * 有效 agentKey = 设置 UI 实际渲染的 key 集合。buildAgentGroups 同时遍历
 * AGENT_TREE + DISSECT_TREE,这里复用同一函数作为单一真相源:
 * UI 里点得到 ⇔ override 可保存,二者永不漂移。防 typo / 任意值产生 phantom 行。
 */
const KNOWN_AGENT_KEYS = new Set(
  buildAgentGroups().flatMap((g) => g.agents.map((a) => a.key)),
);

@Controller('settings')
export class AgentModelController {
  constructor(private readonly overrides: AgentModelOverrideService) {}

  /** 派生的 agent 分组(设置页渲染用)。无用户态,但仍走鉴权。 */
  @Get('agent-tree')
  getTree(): AgentGroup[] {
    return buildAgentGroups();
  }

  @Get('agent-models')
  list(
    @CurrentUser() user: RequestUser,
  ): Promise<
    Record<string, { modelId: string | null; temperature: number | null }>
  > {
    return this.overrides.listForApi(user.id);
  }

  @Put('agent-models/:agentKey')
  async upsert(
    @CurrentUser() user: RequestUser,
    @Param('agentKey') agentKey: string,
    @Body() dto: UpsertAgentOverrideDto,
  ): Promise<void> {
    if (!KNOWN_AGENT_KEYS.has(agentKey)) {
      throw new BadRequestException(`Unknown agent: ${agentKey}`);
    }
    // 透传整个 dto:service 取 modelId / temperature(两者都空 = 清除;否则 upsert modelId 可空)。
    await this.overrides.upsert(user.id, agentKey, dto);
  }

  @Delete('agent-models/:agentKey')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('agentKey') agentKey: string,
  ): Promise<void> {
    return this.overrides.remove(user.id, agentKey);
  }
}
