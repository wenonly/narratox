/**
 * GET /novels/:id/chapters/:order/summary 返回的形状(从 DB 重建)。
 * settled=false → 前端继续轮询。
 */
export interface MemoryData {
  settled: boolean;
  chapterOrder: number;
  summary: string;
  roleChanges: { name: string; change: string }[];
  entities: {
    type: 'item' | 'place' | 'setting';
    name: string;
    note: string;
  }[];
  newHooks: { id: string; description: string }[];
  resolvedHooks: { id: string; description: string }[];
}
