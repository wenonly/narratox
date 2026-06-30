import { BadRequestException } from '@nestjs/common';
import { AgentModelController } from './agent-model.controller';
import { buildAgentGroups } from '../agentos/agent-tree.config';

const overrides = {
  listForApi: jest.fn(),
  upsert: jest.fn(),
  remove: jest.fn(),
};

const ctrl = new AgentModelController(overrides as never);
const user = { id: 'u1' };

beforeEach(() => jest.clearAllMocks());

describe('AgentModelController', () => {
  it('GET /agent-tree 返回派生分组', () => {
    expect(ctrl.getTree()).toEqual(buildAgentGroups());
  });
  it('GET /agent-models 返回 override map({modelId,temperature})', async () => {
    overrides.listForApi.mockResolvedValue({
      writer: { modelId: 'm1', temperature: 0.3 },
    });
    await expect(ctrl.list(user as never)).resolves.toEqual({
      writer: { modelId: 'm1', temperature: 0.3 },
    });
  });
  it('PUT /agent-models/:agentKey 透传 dto(含 temperature)', async () => {
    const dto = { modelId: 'm1', temperature: 0.3 };
    await ctrl.upsert(user as never, 'writer', dto);
    expect(overrides.upsert).toHaveBeenCalledWith('u1', 'writer', dto);
  });
  it('PUT unknown agentKey 抛 BadRequest(typo 防护)', async () => {
    await expect(
      ctrl.upsert(user as never, 'wrtier', { modelId: 'm1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(overrides.upsert).not.toHaveBeenCalled();
  });
  it('DELETE /agent-models/:agentKey 调 remove', async () => {
    await ctrl.remove(user as never, 'writer');
    expect(overrides.remove).toHaveBeenCalledWith('u1', 'writer');
  });
});
