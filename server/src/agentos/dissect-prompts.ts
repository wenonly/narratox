import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 拆解(对标书 dissection)提示词 loader。仿 agent-prompts.ts 的 runtime loader 模式:
 * 模块加载时读 prompts/dissect-*.md,剥掉 YAML frontmatter,导出 6 个【同名常量】供
 * dissect-tree.config.ts 的 DISSECT_PROMPTS map 消费。
 *
 * 路径解析(候选回退,与 agent-prompts.ts 同策略):
 *  ① join(__dirname,'prompts')          —— 与 JS 共址(jest 的 src/agentos/prompts;prod postbuild 复制后的 dist/agentos/prompts)
 *  ② join(__dirname,'..','..','src','agentos','prompts') —— 从 dist/agentos 回溯到 src/agentos/prompts(dev / 未复制的 prod 兜底)
 *
 * 探针文件用 dissect-main.md(拆解树的根 prompt),与 agent-prompts 的 main.md 探针解耦。
 * 编辑提示词:改 prompts/dissect-*.md → 重启(模块加载时读入内存,不热重载)。
 */
const PROMPTS_DIRS = [
  join(__dirname, 'prompts'),
  join(__dirname, '..', '..', 'src', 'agentos', 'prompts'),
];

let PROMPTS_DIR: string | null = null;
for (const dir of PROMPTS_DIRS) {
  if (existsSync(join(dir, 'dissect-main.md'))) {
    PROMPTS_DIR = dir;
    break;
  }
}
if (!PROMPTS_DIR) {
  throw new Error(
    `[dissect-prompts] 找不到 prompts/dissect-*.md,试过: ${PROMPTS_DIRS.join(' / ')}`,
  );
}

/** frontmatter 块:以 `---\n` 起始到下一个独立 `---` 行;之后是送进 LLM 的 body。 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * 读 prompts/<slug>.md 并返回纯 body:剥 frontmatter,裁掉头尾空白。读不到 → 启动即抛
 * (快速失败,信息含 slug 与解析到的目录)。
 */
function load(slug: string): string {
  const filePath = join(PROMPTS_DIR as string, `${slug}.md`);
  const raw = readFileSync(filePath, 'utf8');
  const m = raw.match(FRONTMATTER_RE);
  const body = m ? m[2] : raw;
  return body.replace(/^\r?\n+/, '').replace(/\s+$/, '');
}

export const DISSECT_MAIN_PROMPT = load('dissect-main');
export const CHAPTER_EXTRACTOR_PROMPT = load('chapter-extractor');
export const PLOT_ANALYST_PROMPT = load('plot-analyst');
export const CHARACTER_EXTRACTOR_PROMPT = load('character-extractor');
export const STYLE_ANALYST_PROMPT = load('style-analyst');
export const DISSECT_CRITIC_PROMPT = load('dissect-critic');
