/** 活动流帧(loose typing for test harness)。 */
export interface ActivityFrame {
  event: string;
  act?: string;
  label?: string;
  id?: string;
  args?: unknown;
  text?: string;
  content?: string;
  status?: string;
  reason?: string;
  result?: unknown;
  [key: string]: unknown;
}

/** 提取按顺序的工具调用名列表。 */
export function toolsInOrder(frames: ActivityFrame[]): string[] {
  return frames
    .filter((f) => f.event === 'Act' && f.act === 'tool')
    .map((f) => f.label || '')
    .filter(Boolean);
}

/** 断言工具 a 在 b 之前出现(同帧流里)。 */
export function assertBefore(
  frames: ActivityFrame[],
  a: string,
  b: string,
): void {
  const tools = toolsInOrder(frames);
  const ia = tools.indexOf(a);
  const ib = tools.indexOf(b);
  if (ia < 0) throw new Error(`轨迹断言失败:未找到工具 ${a}`);
  if (ib < 0) throw new Error(`轨迹断言失败:未找到工具 ${b}`);
  if (ia >= ib)
    throw new Error(`轨迹断言失败:${a}(#${ia}) 应在 ${b}(#${ib}) 之前`);
}

/** 断言某工具调用次数在 [min,max] 范围。 */
export function assertToolCount(
  frames: ActivityFrame[],
  label: string,
  opts: { min?: number; max?: number },
): void {
  const count = toolsInOrder(frames).filter((t) => t === label).length;
  if (opts.min !== undefined && count < opts.min)
    throw new Error(`${label} 调用 ${count} 次 < 最小 ${opts.min}`);
  if (opts.max !== undefined && count > opts.max)
    throw new Error(`${label} 调用 ${count} 次 > 最大 ${opts.max}`);
}

/** 断言总工具调用数 ≤ max(抓 runaway)。 */
export function assertTotalToolsMax(
  frames: ActivityFrame[],
  max: number,
): void {
  const total = toolsInOrder(frames).length;
  if (total > max)
    throw new Error(`工具调用总数 ${total} > ${max}(疑似 runaway)`);
}

/** 断言流含 RunCompleted(干净终止)。 */
export function assertRunCompleted(frames: ActivityFrame[]): void {
  if (!frames.some((f) => f.event === 'RunCompleted'))
    throw new Error('未出现 RunCompleted(未干净终止或被截断)');
}

/** 断言无 RunError。 */
export function assertNoRunError(frames: ActivityFrame[]): void {
  const err = frames.find((f) => f.event === 'RunError');
  if (err)
    throw new Error(`RunError: ${String(err.content || '').slice(0, 120)}`);
}

/**
 * 断言任何 clear_chapter 前都有 snapshot_chapter(clear 安全网)。
 * 简化:检查 clear 前最近 5 个工具里有 snapshot。
 */
export function assertNoClearWithoutSnapshot(frames: ActivityFrame[]): void {
  const tools = toolsInOrder(frames);
  tools.forEach((t, i) => {
    if (t === 'clear_chapter') {
      const recent = tools.slice(Math.max(0, i - 5), i);
      if (!recent.includes('snapshot_chapter'))
        throw new Error(
          `clear_chapter (#${i}) 前无 snapshot_chapter(数据丢失风险)`,
        );
    }
  });
}
