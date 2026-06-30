/**
 * 确定性正文守卫:把 LLM 裁判管不了的退化/机械句式/字数/工程词泄漏下沉成纯函数检测。
 * 无 DB、无 DI —— 由 check-prose.tool.ts 包裹读写。详见
 * docs/superpowers/specs/2026-06-30-prose-guard-design.md
 */

export type FindingType =
  | 'verbatim-repeat' | 'truncation' | 'refusal' | 'leak-tier1'
  | 'em-dash' | 'uniform-length' | 'period-stutter'
  | 'word-count' | 'ai-cliche' | 'leak-tier2';

export interface Finding {
  type: FindingType;
  severity: 'blocking' | 'advisory';
  evidence: string;
  location?: string;
  suggestion: string;
}

export interface ProseGuardReport {
  blocking: Finding[];
  advisory: Finding[];
  autoFixed: string[];
  normalizedContent: string; // auto-fix 后正文;autoFixed 空时 === 原文
  nextAction: 'pass' | 'proceed-validator' | 'revise';
  stats: { wordCount: number; dashPer1k: number; sentenceLens: number[] };
}

export interface Sentence {
  text: string;
  len: number;
  isDialogue: boolean;
}

const DIALOGUE_LINE = /^[「『"][\s\S]*[」』"]$/;

/**
 * 中文分句 + 对话感知。按行处理;每行按终止标点(。！？!?…)切句。
 * 「纯对话行」(整行被引号包裹)标 isDialogue=true —— 句长/碎句检测排除之,
 * 避免网文短促对话大量误伤。混合行(如「他说:"好。"然后走了。」非整行引号)
 * 计为叙述句(保守:只排除纯对话行)。
 */
export function splitSentences(content: string): Sentence[] {
  const out: Sentence[] = [];
  for (const raw of content.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const isDialogue = DIALOGUE_LINE.test(line);
    const parts = line
      .split(/(?<=[。！？!?…])/)
      .map((p) => p.trim())
      // 丢纯标点/引号/空白片段(如 「你来啦。」 在 。 处切后剩下的孤立 」)
      .filter((p) => p && !/^[「」『』"'。！？!?…\s]*$/.test(p));
    for (const text of parts) {
      out.push({ text, len: text.length, isDialogue });
    }
  }
  return out;
}

// ── 共用 ──
const DIALOGUE_LINE_RE = /^[「『"][\s\S]*[」』"]$/;
const nonDialogueLines = (content: string): string[] =>
  content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !DIALOGUE_LINE_RE.test(l));

// ── BLOCKING 检测 ──
const REFUSAL_RE =
  /作为(AI|人工智能|大?语言模型)|^(Sure|Certainly|Here's|Of course|当然可以)|我无法(继续|生成)/;
const LEAK_TIER1_RE = /CBN|CPN|CEN|功能标签|章首钩子|任务描述/;

function detectVerbatimRepeat(content: string): Finding[] {
  const lines = content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1] && lines[i].length >= 8) {
      return [
        {
          type: 'verbatim-repeat',
          severity: 'blocking',
          evidence: lines[i].slice(0, 30),
          location: `第${i}段`,
          suggestion: '相邻整行逐字复读,重写其中一段',
        },
      ];
    }
  }
  return [];
}

function detectTruncation(content: string): Finding[] {
  if (Buffer.byteLength(content, 'utf8') >= 500) return [];
  const lines = content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  if (last && !/[。！？!?…」』"]$/.test(last)) {
    return [
      {
        type: 'truncation',
        severity: 'blocking',
        evidence: last.slice(0, 30),
        suggestion: '正文过短且末尾无终止标点,疑似截断/落盘失败,补完本章',
      },
    ];
  }
  return [];
}

function detectRefusal(content: string): Finding[] {
  for (const l of nonDialogueLines(content)) {
    if (REFUSAL_RE.test(l)) {
      return [
        {
          type: 'refusal',
          severity: 'blocking',
          evidence: l.slice(0, 40),
          suggestion: '正文出现模型拒绝语,重写该段',
        },
      ];
    }
  }
  return [];
}

function detectLeakTier1(content: string): Finding[] {
  for (const l of nonDialogueLines(content)) {
    if (LEAK_TIER1_RE.test(l)) {
      return [
        {
          type: 'leak-tier1',
          severity: 'blocking',
          evidence: l.slice(0, 40),
          suggestion: '正文泄漏作者工具元词汇,删除',
        },
      ];
    }
  }
  return [];
}

/**
 * 确定性正文守卫主入口。纯函数。opts.chapterWordTarget 缺省则跳过字数检测。
 * blocking 已接;advisory/autoFix/normalizedContent/sentenceLens 在后续补全。
 */
export function check(
  content: string,
  opts: { chapterWordTarget?: number } = {},
): ProseGuardReport {
  const blocking: Finding[] = [
    ...detectVerbatimRepeat(content),
    ...detectTruncation(content),
    ...detectRefusal(content),
    ...detectLeakTier1(content),
  ];
  const wordCount = content.length;
  const dashPer1k =
    (content.match(/——/g) || []).length / ((wordCount || 1) / 1000);
  return {
    blocking,
    advisory: [], // 后续填充
    autoFixed: [], // 后续填充
    normalizedContent: content, // 后续:auto-fix 后正文
    nextAction: blocking.length ? 'revise' : 'pass',
    stats: { wordCount, dashPer1k, sentenceLens: [] }, // 后续填 sentenceLens
  };
}
