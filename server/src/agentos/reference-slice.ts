export interface ReferenceLike {
  injectTo: string | null;
  title: string;
  category: string;
  content?: string | null;
}

/**
 * 拼某角色的【写作参考】slice:命中本角色精要(top6、各截 500 字)+ 全量索引(让 agent
 * 知道还有什么可拉)。无精要 → 返回 ''(不注入)。
 * 'both' 兼容:命中任意 role(历史 main+writer 语义;curator 今后用具体角色名)。
 * 纯函数,不带前导换行;调用方自行加间距(ContextAssembler 走 slices.join('\n');
 * resolvePrompt 走 prompt + '\n\n' + slice)。
 */
export function buildReferenceSlice(role: string, refs: ReferenceLike[]): string {
  const essence = refs.filter(
    (r) => r.injectTo === role || r.injectTo === 'both',
  );
  if (!essence.length) return '';
  const index = refs
    .map((r) => `- [${r.injectTo ?? '—'}] ${r.title}(${r.category || '—'})`)
    .join('\n');
  const body = essence
    .slice(0, 6)
    .map((r) => `### ${r.title}\n${(r.content ?? '').slice(0, 500)}`)
    .join('\n\n');
  return `【写作参考】\n索引:\n${index}\n\n精要:\n${body}`;
}
