/**
 * 扁平活动流协议(v2 基石)。
 *
 * 一次回合 = 一条按时间顺序的扁平活动流(不嵌套、无 parent id、无树)。
 * FE 按 id 聚合:Act 创建一个条目,ActDelta 往该条目追加文本增量,
 * ActTool/ActResult 填充工具详情,ActEnd 标记条目结束。
 *
 * stage 条目是「视觉分隔/标题」(如 writer / settler),它**不包含**后续条目;
 * 后续 think/tool 是平级条目,只是时序跟在该 stage 后(FE 用 stage 标题做视觉分组)。
 *
 * think 条目接 GLM 的 reasoning_content(思考 token);content 条目接正文增量。
 * 这就是消除卡顿的关键:GLM 思考阶段(reasoning_content)现在作为 think 条目实时显示,
 * 界面不再冻住再爆一段。
 */
export type ActivityType = 'think' | 'tool' | 'stage' | 'content';

export interface ActStart {
  type: 'Act';
  id: string;
  act: ActivityType;
  label?: string; // stage 名 / tool 名 / 概要
}
export interface ActDelta {
  type: 'ActDelta';
  id: string;
  text: string; // think 的推理 token / content 的正文增量(delta,非累积)
}
export interface ActToolArgs {
  type: 'ActTool';
  id: string;
  args: unknown;
}
export interface ActResult {
  type: 'ActResult';
  id: string;
  result: unknown;
}
export interface ActEnd {
  type: 'ActEnd';
  id: string;
  status: 'ok' | 'error';
  summary?: string;
}
export type ActivityEvent =
  | ActStart
  | ActDelta
  | ActToolArgs
  | ActResult
  | ActEnd;

/**
 * 生成活动 id(单调)。server 运行时,Date.now() 可用(非 workflow sandbox)。
 * 前缀区分活动来源(stage-/tool-/think-/content-),便于日志排查。
 */
let _seq = 0;
export const nextActId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${_seq++}`;
