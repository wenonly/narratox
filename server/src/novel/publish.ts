/**
 * 发布格式化(纯函数,无 DI)。把章节 markdown 投影成「可直接粘贴到番茄/起点」
 * 的纯文本成稿。详见 docs/superpowers/specs/2026-06-30-novel-publish-design.md
 */

/** 剥 markdown 标记,保留正文与段落换行。 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片 → 删
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接 [t](u) → t
    .replace(/^#{1,6}\s+/gm, '') // 标题 # → 去标记
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 粗 **t** → t
    .replace(/__([^_]+)__/g, '$1') // 粗 __t__ → t
    .replace(/\*([^*]+)\*/g, '$1') // 斜 *t* → t
    .replace(/_([^_]+)_/g, '$1') // 斜 _t_ → t
    .replace(/`([^`]+)`/g, '$1') // 行内码 `c` → c
    .replace(/^>\s?/gm, '') // 引用 > → 去
    .replace(/^\s*[-*+]\s+/gm, '') // 无序列表 - * + → 去
    .replace(/^\s*\d+\.\s+/gm, '') // 有序列表 1. → 去
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, '') // 水平线 ---/***/___ → 删
    .replace(/\n{3,}/g, '\n\n') // 连续空行压成一个
    .trim();
}

export interface PublishOptions {
  from: number; // ≤0 → 从首章
  to: number; // ≤0 或 > max → 到末章
  includeTitle: boolean;
  includeSynopsis: boolean;
  indent: boolean; // 每段首行加全角空格×2
}

/**
 * novel + chapters → 平台成稿文本。章节按 order 升序,from..to 过滤(clamp)。
 */
export function formatForPublish(
  novel: { title: string; synopsis: string | null },
  chapters: Array<{ order: number; title: string; content: string }>,
  opts: PublishOptions,
): string {
  const sorted = [...chapters].sort((a, b) => a.order - b.order);
  const orders = sorted.map((c) => c.order);
  const min = orders.length ? Math.min(...orders) : 1;
  const max = orders.length ? Math.max(...orders) : 1;
  const from = opts.from > 0 ? opts.from : min;
  const to = opts.to > 0 ? opts.to : max;
  const inRange = sorted.filter((c) => c.order >= from && c.order <= to);

  const parts: string[] = [];
  if (opts.includeSynopsis && novel.synopsis) {
    parts.push(novel.synopsis.trim());
  }
  for (const c of inRange) {
    let body = stripMarkdown(c.content || '');
    if (opts.indent) {
      body = body
        .split('\n')
        .map((line) => (line.trim() ? `　　${line.trim()}` : line))
        .join('\n');
    }
    const head = opts.includeTitle ? `第${c.order}章 ${c.title || ''}\n\n` : '';
    parts.push(`${head}${body}`);
  }
  return parts.join('\n\n');
}
