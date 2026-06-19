export interface ContentRange {
  start: number
  end: number
}

/**
 * 在 content 里定位 find 的首个命中区间 [start, end)。
 * 先精确匹配;精确不到再"空白归一化匹配"(把连续 \s+ 折叠成单空格后比对,
 * 命中映射回原文区间 —— 保留原文其余空白/排版)。找不到返回 null。
 *
 * 容忍 AI 引用原文时空格/换行的小偏差 —— 这是散文查找替换能否可用的关键。
 */
export function findContentRange(
  content: string,
  find: string,
): ContentRange | null {
  if (!find) return null
  const exact = content.indexOf(find)
  if (exact !== -1) return { start: exact, end: exact + find.length }

  const { norm, spans } = normalizeWithSpans(content)
  const normFind = find.replace(/\s+/g, ' ').trim()
  if (!normFind) return null
  const j = norm.indexOf(normFind)
  if (j === -1) return null
  return { start: spans[j].from, end: spans[j + normFind.length - 1].to }
}

/** 统计 find 在 content 里的精确命中数(与 findContentRange 的"首个"语义一致)。 */
export function countMatches(content: string, find: string): number {
  if (!find) return 0
  let count = 0
  let from = 0
  let idx = content.indexOf(find, from)
  while (idx !== -1) {
    count++
    from = idx + find.length
    idx = content.indexOf(find, from)
  }
  return count
}

/**
 * 把 content 折叠空白:每个连续 \s+ 段 → 一个空格字符。返回归一化串 +
 * spans[i] = 第 i 个归一化字符在原文里的 [from, to)(空格字符对应整个空白段)。
 */
function normalizeWithSpans(content: string): {
  norm: string
  spans: Array<{ from: number; to: number }>
} {
  const norm: string[] = []
  const spans: Array<{ from: number; to: number }> = []
  let i = 0
  while (i < content.length) {
    if (/\s/.test(content[i])) {
      let j = i
      while (j < content.length && /\s/.test(content[j])) j++
      norm.push(' ')
      spans.push({ from: i, to: j })
      i = j
    } else {
      norm.push(content[i])
      spans.push({ from: i, to: i + 1 })
      i++
    }
  }
  return { norm: norm.join(''), spans }
}
