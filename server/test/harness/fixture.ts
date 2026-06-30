/** 共享 fixture:L1/L2/L3 复用的固定概念,保证可复现。 */
export const FIXTURE = {
  title: '青衫客',
  genre: '武侠',
  synopsis: '落魄剑客陆青衫卷入一桩灭门奇案,追凶路上步步惊心',
  coreConflict: '查真凶 vs 幕后势力灭口',
  chapterWordTarget: 1500,
  worldviewText:
    '江湖六大门派:武当/少林/峨眉/昆仑/点苍/青城。剑修为尊,本命剑是命根。',
  style: '古龙式短句,节奏快,意境冷',
  /** L2 测试用:前缀标记(便于 cleanup) */
  novelTitlePrefix: 'L2-test-',
} as const;
