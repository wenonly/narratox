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
