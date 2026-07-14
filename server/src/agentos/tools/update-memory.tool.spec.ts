import { makeUpdateMemoryTool } from './update-memory.tool';
import type { ProcessMemoryService } from '../../memory/process-memory.service';

interface InvokableTool {
  invoke: (input: unknown) => Promise<unknown>;
}
const invoke =
  (t: InvokableTool) =>
  (input: unknown): Promise<unknown> =>
    t.invoke(input);

const stubService = (result: unknown) =>
  ({ upsert: jest.fn().mockResolvedValue(result) }) as unknown as ProcessMemoryService;

describe('update_memory tool', () => {
  it('成功:传变化段 → 返回最新三段', async () => {
    const svc = stubService({
      rules: '新规矩',
      lessons: '旧经验',
      decisions: '旧决策',
    });
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      processMemory: svc,
    });
    const out = (await invoke(tool)({ rules: '新规矩' })) as {
      ok: boolean;
      rules: string;
    };
    expect(svc.upsert).toHaveBeenCalledWith('u1', 'n1', { rules: '新规矩' });
    expect(out.ok).toBe(true);
    expect(out.rules).toBe('新规矩');
  });

  it('拒绝:三段全 undefined(至少一段必填)', async () => {
    const svc = stubService(null);
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      processMemory: svc,
    });
    const out = (await invoke(tool)({})) as { ok: boolean; reason: string };
    expect(svc.upsert).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_fields');
  });

  it('越权:service 返 null → ok:false reason:denied', async () => {
    const svc = stubService(null);
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'other',
      processMemory: svc,
    });
    const out = (await invoke(tool)({ rules: 'x' })) as {
      ok: boolean;
      reason: string;
    };
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('denied');
  });

  it('空串=主动清空该段(透传给 service)', async () => {
    const svc = stubService({ rules: '', lessons: '', decisions: '' });
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      processMemory: svc,
    });
    await invoke(tool)({ lessons: '' });
    expect(svc.upsert).toHaveBeenCalledWith('u1', 'n1', { lessons: '' });
  });
});
