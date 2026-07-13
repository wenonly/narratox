import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 提示词源文件迁至 src/agentos/prompts/*.md(markdown,便于阅读/编辑)。本文件是 runtime
 * loader:模块加载时读 prompts/<slug>.md,剥掉 YAML frontmatter,导出【同名常量】——
 * 消费方(agent-tree.config.ts 的 PROMPTS map / context-assembler / deep-agent)零改动。
 *
 * 路径解析(候选回退,不依赖 nest-cli assets —— 该版本的 asset 复制器实测不生效):
 *  ① join(__dirname,'prompts')          —— 与 JS 共址(jest 的 src/agentos/prompts;prod postbuild 复制后的 dist/agentos/prompts)
 *  ② join(__dirname,'..','..','src','agentos','prompts') —— 从 dist/agentos 回溯到 src/agentos/prompts(dev / 未复制的 prod 兜底)
 * jest 跑在 src → ① 命中;dev(nest start --watch)与 prod 的 JS 在 dist → ① 缺时 ② 回溯到源。
 *
 * 编辑提示词:改 prompts/*.md → 重启(提示词在模块加载时读入内存,不热重载)。详见 prompts/README.md。
 */
const PROMPTS_DIRS = [
  join(__dirname, 'prompts'),
  join(__dirname, '..', '..', 'src', 'agentos', 'prompts'),
];

let PROMPTS_DIR: string | null = null;
for (const dir of PROMPTS_DIRS) {
  if (existsSync(join(dir, 'main.md'))) {
    PROMPTS_DIR = dir;
    break;
  }
}
if (!PROMPTS_DIR) {
  throw new Error(
    `[agent-prompts] 找不到 prompts/*.md,试过: ${PROMPTS_DIRS.join(' / ')}`,
  );
}

/** frontmatter 块:以 `---\n` 起始到下一个独立 `---` 行;之后是送进 LLM 的 body。 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * 读 prompts/<slug>.md 并返回纯 body:剥 frontmatter,裁掉头尾空白(原常量本无语义性头尾空白,
 * → 与迁移前逐字一致)。读不到 → 启动即抛(快速失败,信息含 slug 与解析到的目录)。
 */
function load(slug: string): string {
  const filePath = join(PROMPTS_DIR as string, `${slug}.md`);
  const raw = readFileSync(filePath, 'utf8');
  const m = raw.match(FRONTMATTER_RE);
  const body = m ? m[2] : raw;
  return body.replace(/^\r?\n+/, '').replace(/\s+$/, '');
}

export const WRITER_AGENT_PROMPT = load('writer');
export const MAIN_ROLE_REMINDER = load('main-role-reminder');
export const MAIN_AGENT_PROMPT = load('main');
export const CHAPTER_ORCHESTRATOR_PROMPT = load('chapter-orchestrator');
export const SETTLER_AGENT_PROMPT = load('settler');
export const VALIDATOR_AGENT_PROMPT = load('validator');
export const CURATOR_AGENT_PROMPT = load('curator');
export const WORLDBUILDER_CRITIC_PROMPT = load('worldbuilder-critic');
export const OUTLINE_CRITIC_PROMPT = load('outline-critic');
export const CHARACTER_CRITIC_PROMPT = load('character-critic');
