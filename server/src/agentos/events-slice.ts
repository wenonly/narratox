export interface EventSliceItem {
  chapterOrder: number;
  description: string;
  involvedCharacters?: string[] | null;
  location?: string | null;
}

/**
 * 拼 writer 的【近期关键事件】slice:最近 N 条 MAJOR 事件,早→晚(叙事顺序)。
 * listRecentMajor 返回 desc(最新在前),叙事用早→晚,故 reverse。
 * 空返 ''(不注入)。纯函数,不带前导换行;调用方自行加间距。
 *
 * writer 的「事件记忆」常驻层:跨 5 章摘要窗口仍记得发生了什么(修 Phase 11
 * 想治的「超 5 章遗忘剧情」——此前 listRecentMajor 是死代码、无任何注入)。
 * 末尾脚注引导 writer 用 get_events 按需拉更多(MINOR / 更早 / 某事件详情)。
 */
export function buildEventsSlice(events: EventSliceItem[]): string {
  if (!events.length) return '';
  const recap = events
    .slice()
    .reverse()
    .map((e) => {
      const parts = [`第${e.chapterOrder}章:${e.description}`];
      const who = (e.involvedCharacters ?? []).filter(Boolean).join('/');
      if (who) parts.push(`涉及:${who}`);
      if (e.location) parts.push(`@${e.location}`);
      return parts.join(' ');
    })
    .join(' / ');
  return `【近期关键事件】${recap}\n(以上为最近 MAJOR 简表;需要 MINOR / 更早 / 某事件详情 → get_events 按需拉取)`;
}
