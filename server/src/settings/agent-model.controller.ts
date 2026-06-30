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
  AGENT_TREE,
  buildAgentGroups,
  collectSpecs,
  type AgentGroup,
} from '../agentos/agent-tree.config';
import { UpsertAgentOverrideDto } from './dto/agent-model-override.dto';

/** agentKey 必须命中 AGENT_TREE 里的真实 agent,防 typo/任意值产生 phantom 行。 */
const KNOWN_AGENT_KEYS = new Set(collectSpecs(AGENT_TREE).map((s) => s.name));

@Controller('settings')
export class AgentModelController {
  constructor(private readonly overrides: AgentModelOverrideService) {}

  /** 派生的 agent 分组(设置页渲染用)。无用户态,但仍走鉴权。 */
  @Get('agent-tree')
  getTree(): AgentGroup[] {
    return buildAgentGroups();
  }

  @Get('agent-models')
  list(@CurrentUser() user: RequestUser): Promise<Record<string, string>> {
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
    await this.overrides.upsert(user.id, agentKey, dto.modelConfigId);
  }

  @Delete('agent-models/:agentKey')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('agentKey') agentKey: string,
  ): Promise<void> {
    return this.overrides.remove(user.id, agentKey);
  }
}
