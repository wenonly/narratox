// scripts/distill_kb/clean_mechanics.mjs
// 跑法: node scripts/distill_kb/clean_mechanics.mjs
// 全量机械清理 知识库/<6分类>/*.md：删🧠整节 / 去行内🧠 / 转互链。确定性，幂等。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processContent } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../知识库/', import.meta.url));
const CATEGORIES = ['人设档案', '公式模板', '创作须知', '拆文案例', '方法论教程', '词汇素材库'];

let changed = 0;
let total = 0;
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
    const before = await readFile(p, 'utf8');
    const after = processContent(before);
    if (after !== before) {
      await writeFile(p, after, 'utf8');
      changed++;
      console.log(`cleaned: ${cat}/${f}`);
    }
  }
}
console.log(`\n${changed}/${total} files cleaned.`);
