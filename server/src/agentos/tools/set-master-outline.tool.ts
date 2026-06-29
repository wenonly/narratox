import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MasterOutlineService } from '../../novel/master-outline.service';

/**
 * outline-writer 的「立总纲」工具(全书级蓝图,1:1 Novel)。userId/novelId 闭包注入。
 * 分卷前先立总纲:主线/结局/力量进阶曲线/暗线时刻表/卷划分。锁战力崩坏 + 暗线遗忘。
 */
export function makeSetMasterOutlineTool({
  userId,
  novelId,
  masterOutlines,
}: {
  userId: string;
  novelId: string;
  masterOutlines: MasterOutlineService;
}) {
  return tool(
    async (input) => {
      await masterOutlines.upsert(userId, novelId, input);
      return { ok: true as const };
    },
    {
      name: 'set_master_outline',
      description:
        '立/更新全书总纲(北极星,1:1 Novel,分卷前先立)。含:theme(故事核+主题)/mainLine(主线脉络)/ending(结局,先定倒推)/powerProgression(力量进阶曲线:[{volume,level,note}],锁战力崩坏)/hiddenLines(暗线时刻表:[{name,type,plant,advance[],reveal}],锁长篇发动机)/volumeSplitLogic(卷划分逻辑)/threeAct(三幕转折点 {act1Turn,act2Turn[灵魂黑夜],act3Turn},各{atVolume,beat})。每轮自动注入主 agent + 写手。',
      schema: z.object({
        theme: z.string().optional().describe('故事核 + 主题(一句话定调)'),
        mainLine: z
          .string()
          .optional()
          .describe('主线脉络(起承转合关键节点/走向)'),
        ending: z.string().optional().describe('结局走向(先定→倒推铺垫)'),
        powerProgression: z
          .array(
            z.object({
              volume: z.number().describe('卷序号'),
              level: z.string().describe('本卷力量跨度,如 炼气→筑基'),
              note: z.string().optional().describe('备注'),
            }),
          )
          .optional()
          .describe('力量/金手指进阶曲线,每卷一档'),
        hiddenLines: z
          .array(
            z.object({
              name: z.string().describe('暗线名,如 身世/家族秘密/幕后黑手'),
              type: z.string().optional(),
              plant: z.string().optional().describe('埋设卷(如 卷1)'),
              advance: z.array(z.string()).optional().describe('推进卷'),
              reveal: z.string().optional().describe('揭示/回收卷(如 卷6)'),
            }),
          )
          .optional()
          .describe('暗线/核心伏笔时刻表'),
        volumeSplitLogic: z.string().optional().describe('卷划分逻辑'),
        threeAct: z
          .object({
            act1Turn: z
              .object({
                atVolume: z.number().describe('第一幕末落在第几卷'),
                beat: z
                  .string()
                  .describe('第一幕末转折(建立→对抗):主角下定决心,正式上路'),
              })
              .optional()
              .describe('建立→对抗 转折'),
            act2Turn: z
              .object({
                atVolume: z.number().describe('第二幕末落在第几卷'),
                beat: z
                  .string()
                  .describe(
                    '第二幕末【灵魂黑夜】:跌入一无所有低谷(全书情绪最低点)',
                  ),
              })
              .optional()
              .describe('对抗→解决 转折(灵魂黑夜,长篇情绪发动机,必填)'),
            act3Turn: z
              .object({
                atVolume: z.number().describe('第三幕末落在第几卷'),
                beat: z.string().describe('第三幕末(解决):最终决战,主角成为谁'),
              })
              .optional()
              .describe('解决 收束'),
          })
          .optional()
          .describe(
            '三幕转折点(全书宏观骨架);三个 atVolume 单调递增且落在已规划卷范围',
          ),
      }),
    },
  );
}
