export interface ForeSummaryLike {
  chapterOrder: number;
  summary: string;
}

/**
 * 拼 writer 的【前情】slice:last N 章摘要,早→晚。
 * listRecent 返回 desc(最新在前),前情叙事用早→晚,故 reverse。
 * 空返 ''(不注入)。纯函数,不带前导换行;调用方自行加间距。
 * 补 writer 的中程视野:N-1 全文(接缝)与 query_memory(远期按需)之间那段近期概览。
 */
export function buildForeSlice(summaries: ForeSummaryLike[]): string {
  if (!summaries.length) return '';
  const recap = summaries
    .slice()
    .reverse()
    .map((s) => `第${s.chapterOrder}章:${s.summary}`)
    .join(' / ');
  return `【前情】${recap}`;
}
