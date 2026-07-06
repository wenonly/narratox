// scripts/distill_kb/lint.mjs
// 跑法: node scripts/distill_kb/lint.mjs
// 校验 知识库/<6分类>/*.md：硬规则（无🧠/无互链/tags在/非空）+ 字数降幅（对比 HEAD）。
import { readdir, readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRules, wordCount } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../知识库/', import.meta.url));
const CATEGORIES = ['人设档案', '公式模板', '创作须知', '拆文案例', '方法论教程', '词汇素材库'];
const MAX_DROP = 0.4;

let total = 0;
const problems = [];
for (const cat of CATEGORIES) {
  let files;
  try {
    files = await readdir(join(ROOT, cat));
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    total++;
    const p = join(ROOT, cat, f);
    const rel = `知识库/${cat}/${f}`;
    const content = await readFile(p, 'utf8');
    for (const rp of checkRules(content)) problems.push(`${rel}: ${rp}`);
    let head = null;
    try {
      head = execSync(`git show HEAD:${rel}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      /* 新文件无 HEAD，跳过降幅检查 */
    }
    if (head != null) {
      const before = wordCount(head);
      const after = wordCount(content);
      const drop = (before - after) / Math.max(1, before);
      if (drop > MAX_DROP) {
        problems.push(`${rel}: 字数降幅 ${Math.round(drop * 100)}% > ${MAX_DROP * 100}%（复查是否误删）`);
      }
    }
  }
}
console.log(`checked ${total} files.`);
if (problems.length) {
  console.error(`\n❌ ${problems.length} problem(s):`);
  for (const x of problems) console.error('  ' + x);
  process.exit(1);
} else {
  console.log('✅ all good.');
}
