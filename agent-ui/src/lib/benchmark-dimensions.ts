/**
 * 对标拆解维度元数据【FE 单源镜像】。被 DissectPage 的 tab/label/color/groupByType/
 * ReviewView 消费。与 server/src/benchmark/dimensions.ts 对应(monorepo 非 workspace,
 * 无共享包 → 手动同步,两份互指)。
 *
 * 加新维度 = 这里加一行 + types/benchmark.ts union 加值。
 */
import type { BenchmarkEntryType } from '@/types/benchmark'

export type DimTabKind = 'list' | 'reading' | 'material'

export interface DimMeta {
  key: BenchmarkEntryType
  label: string
  color: string
  tab: DimTabKind
  /** tab 上是否显条数 badge。 */
  count: boolean
}

export const BENCHMARK_DIMENSIONS: readonly DimMeta[] = [
  { key: 'CHAPTER', label: '章节', color: '#6366f1', tab: 'list', count: true },
  { key: 'PLOT', label: '剧情', color: '#F59E0B', tab: 'reading', count: false },
  { key: 'RHYTHM', label: '节奏', color: '#60A5FA', tab: 'reading', count: false },
  { key: 'EMOTION', label: '情绪', color: '#818CF8', tab: 'reading', count: false },
  { key: 'CHARACTER', label: '角色', color: '#22C55E', tab: 'list', count: true },
  { key: 'STYLE', label: '文风', color: '#a78bfa', tab: 'reading', count: false },
  { key: 'MATERIAL', label: '素材', color: '#fb7185', tab: 'material', count: true }
]

export const DIM_BY_KEY = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d])
) as Record<BenchmarkEntryType, DimMeta>

export const ENTRY_TYPE_LABEL = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d.label])
) as Record<BenchmarkEntryType, string>

export const DIM_COLOR = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d.color])
) as Record<BenchmarkEntryType, string>

/** Tab 顺序 + count 标记。 */
export const TAB_LIST: { key: BenchmarkEntryType; label: string; count: boolean }[] =
  BENCHMARK_DIMENSIONS.map((d) => ({ key: d.key, label: d.label, count: d.count }))

/** MATERIAL 专用:kind 种类(镜像 server MATERIAL_KINDS)。 */
export const MATERIAL_KINDS = ['梗', '名场面', '金句', '套路'] as const
/** MATERIAL 专用:purpose 用途(镜像 server MATERIAL_PURPOSES)。 */
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
  '悬念'
] as const
