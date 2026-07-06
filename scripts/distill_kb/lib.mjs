// scripts/distill_kb/lib.mjs
// 知识库提炼的纯函数（机械清理 + lint 规则）。无副作用，便于 node:test 单测。

/** 删末尾「### 🧠 整理思考」整节：从该标题行到文件尾。 */
export function stripThinkSection(body) {
  const re = /\n#{2,4}\s*🧠[^\n]*\n[\s\S]*$/;
  const m = body.match(re);
  if (!m) return body;
  return body.slice(0, m.index).replace(/\s*$/, '\n');
}

/** 行内「> 🧠 X」去前缀留内容（单行 blockquote 旁注）。 */
export function unwrapInlineThink(body) {
  return body
    .split('\n')
    .map((line) => {
      const m = line.match(/^>\s*🧠\s?(.*)$/);
      return m ? m[1] : line;
    })
    .join('\n');
}

/** 「[[文件名]]」→「《文件名》」，吃掉互链前后的水平空白（中文排版不留空格，保留换行结构）。 */
export function softenWikiLinks(text) {
  return text.replace(/[^\S\n]*\[\[([^\]]+)\]\][^\S\n]*/g, '《$1》');
}

/** 拆 frontmatter，对正文做三件机械清理，frontmatter 不动。 */
export function processContent(content) {
  const fm = content.match(/^---\n[\s\S]*?\n---\n/);
  if (!fm) {
    let body = content;
    body = stripThinkSection(body);
    body = unwrapInlineThink(body);
    body = softenWikiLinks(body);
    return body.replace(/^\n+/, '');
  }
  const frontmatter = fm[0];
  let body = content.slice(frontmatter.length);
  body = stripThinkSection(body);
  body = unwrapInlineThink(body);
  body = softenWikiLinks(body);
  return frontmatter + body.replace(/^\n+/, '\n');
}

/** 正文字数（去 frontmatter + 去所有空白后的字符数）。 */
export function wordCount(content) {
  const fm = content.match(/^---\n[\s\S]*?\n---\n/);
  const body = fm ? content.slice(fm[0].length) : content;
  return body.replace(/\s/g, '').length;
}

/** 硬规则检查：返回违规字符串数组（空 = 通过）。 */
export function checkRules(content) {
  const problems = [];
  if (content.includes('🧠')) problems.push('残留 🧠');
  if (/\[\[[^\]]+\]\]/.test(content)) problems.push('残留 [[互链]]');
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) problems.push('缺 frontmatter');
  else if (!/^\s*tags\s*:/m.test(fm[1])) problems.push('frontmatter 缺 tags');
  const body = fm ? content.slice(fm[0].length) : content;
  if (body.replace(/[#>\-\s|]/g, '').length < 50) problems.push('正文过短');
  return problems;
}
