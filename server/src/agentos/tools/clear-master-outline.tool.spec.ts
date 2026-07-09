import { makeClearMasterOutlineTool } from './clear-master-outline.tool';
import type { MasterOutlineService } from '../../novel/master-outline.service';

describe('clear_master_outline tool', () => {
  it('转发给 MasterOutlineService.clear', async () => {
    const clear = jest.fn().mockResolvedValue({ ok: true, warned: false });
    const masterOutlines = { clear } as unknown as MasterOutlineService;
    const t = makeClearMasterOutlineTool({
      userId: 'u1',
      novelId: 'n1',
      masterOutlines,
    });
    await t.invoke({});
    expect(clear).toHaveBeenCalledWith('u1', 'n1');
  });
});
