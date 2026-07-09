/**
 * 对标拆解维度元数据【单源】。被 5 个工具的 z.enum / FE 镜像消费。
 * 加新维度 = 这里加一行 + FE 镜像(agent-ui/src/lib/benchmark-dimensions.ts)加一行,不再散落 ~10 处。
 *
 * 注意:FE 是独立项目镜像,需手动同步(monorepo 非 workspace,无共享包);两份配置互指注释。
 */
export type DimTabKind = 'list' | 'reading' | 'material';

export interface DimMeta {
  key: string;
  label: string;
  color: string;
  tab: DimTabKind;
  /** tab 上是否显条数 badge。 */
  count: boolean;
}

export const BENCHMARK_DIMENSIONS: readonly DimMeta[] = [
  { key: 'CHAPTER', label: '章节', color: '#6366f1', tab: 'list', count: true },
  { key: 'PLOT', label: '剧情', color: '#F59E0B', tab: 'reading', count: false },
  { key: 'RHYTHM', label: '节奏', color: '#60A5FA', tab: 'reading', count: false },
  { key: 'EMOTION', label: '情绪', color: '#818CF8', tab: 'reading', count: false },
  { key: 'CHARACTER', label: '角色', color: '#22C55E', tab: 'list', count: true },
  { key: 'STYLE', label: '文风', color: '#a78bfa', tab: 'reading', count: false },
  { key: 'MATERIAL', label: '素材', color: '#fb7185', tab: 'material', count: true },
];

export const BENCHMARK_TYPES = BENCHMARK_DIMENSIONS.map((d) => d.key) as [
  string,
  ...string[],
];

export const DIM_BY_KEY: Record<string, DimMeta> = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d]),
);

/** MATERIAL 专用:素材种类(它是什么)。 */
export const MATERIAL_KINDS = ['梗', '名场面', '金句', '套路'] as const;

/** MATERIAL 专用:用途(什么时候用)。 */
export const MATERIAL_PURPOSES = [
  '开篇钩子',
  '爽点',
  '打脸装逼',
  '反转',
  '高潮',
  '低谷',
  '转场',
  '伏笔铺设',
  '情感扣子',
  '悬念',
] as const;
