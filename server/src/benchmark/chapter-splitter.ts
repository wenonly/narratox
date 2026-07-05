export interface SplitChapter {
  chapterNo: number;
  title: string;
  offset: number;
  length: number;
  text: string;
}

const MARKER = /第\s*([0-9一二三四五六七八九十百千零两]+)\s*[章回节卷]/g;
// leading 版(非 global,^ 锚定):只剥离开头的章节标记,不破坏 title 里对「第N章」的引用。
const MARKER_LEADING =
  /^第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节卷][\s:：]*/;
const CHUNK_SIZE = 2000;

/**
 * 按章节标记切分原文。标记形如「第一章」「第3章」「第N回」「第N节」「第N卷」,
 * 支持阿拉伯数字与中文数字。无标记 → 按 ~2000 字均分(网文章节常见长度),title 空。
 *
 * 切分逻辑:
 *  - 先 trim 文本,空文本返回 []
 *  - 用全局正则 matchAll 找所有章节标记的命中位置
 *  - 无命中 → 按 CHUNK_SIZE 切片
 *  - 有命中 → 第 i 章的范围 = [matches[i].index, matches[i+1].index 或末尾);
 *    第一章的 start 强制为 0(标记前的非章节文本/楔子并入第一章,确保 offset 0 起覆盖全文)
 *  - 标题取「标记行」(marker 到行尾)去掉开头的章节标记后的剩余;
 *    只剥离开头一个 marker,title 里对「第N章」的引用不破坏。
 */
export function splitChapters(raw: string): SplitChapter[] {
  if (!raw.trim()) return [];

  const matches = [...raw.matchAll(MARKER)];

  if (matches.length === 0) {
    const out: SplitChapter[] = [];
    for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
      const text = raw.slice(i, i + CHUNK_SIZE);
      out.push({
        chapterNo: out.length + 1,
        title: '',
        offset: i,
        length: text.length,
        text,
      });
    }
    return out;
  }

  const out: SplitChapter[] = [];
  for (let i = 0; i < matches.length; i++) {
    const markerStart = matches[i].index ?? 0;
    const start = i === 0 ? 0 : markerStart; // 第一章含前缀(offset 0 覆盖全文)
    const end =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? raw.length)
        : raw.length;
    const text = raw.slice(start, end);
    let lineEnd = raw.indexOf('\n', markerStart);
    if (lineEnd === -1 || lineEnd > end) lineEnd = end;
    const title = raw
      .slice(markerStart, lineEnd)
      .replace(MARKER_LEADING, '')
      .trim();
    out.push({
      chapterNo: i + 1,
      title,
      offset: start,
      length: text.length,
      text,
    });
  }
  return out;
}
