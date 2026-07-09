import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MasterOutlineService } from '../../novel/master-outline.service';

/** outline-writer 的「清空总纲」工具。删整行;ACTIVE 返 warning(不拦)。 */
export function makeClearMasterOutlineTool({
  userId,
  novelId,
  masterOutlines,
}: {
  userId: string;
  novelId: string;
  masterOutlines: MasterOutlineService;
}) {
  return tool(async () => masterOutlines.clear(userId, novelId), {
    name: 'clear_master_outline',
    description:
      '删总纲整行(1:1 Novel)。ACTIVE 小说返 warning(总纲是北极星:writer 将失去战力/主线/三幕锚点),但不拦。仅在作者明确要求重建总纲时调用。重建走 set_master_outline。',
    schema: z.object({}),
  });
}
