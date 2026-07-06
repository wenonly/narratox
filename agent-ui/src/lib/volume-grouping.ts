import type { Arc, Chapter, ChapterOutline, Volume } from '@/types/novel'

/** 卷分组结果。volumeId=null 表示「未分卷」(兜底,放列表最后)。 */
export interface VolumeGroup {
  volumeId: string | null
  volumeOrder: number // 排序用;未分卷 = Infinity
  volumeTitle: string | null
  chapters: Chapter[]
}

/**
 * 把章节按卷分组。卷-章映射只用 ChapterOutline.volumeId(Phase 12 后真源,
 * 与 OutlineView 一致)——不用 Arc.range 反推,后者在弧越界时会把别卷章吞进来
 * (commit b0453c9 修掉的 bug,见 memory arc-volume-range-bug.md)。
 *
 * 没细纲的章进「未分卷」(诚实反映数据:章无 outline.volumeId 时无法定卷)。
 * 卷按 Volume.order 升序;卷内章节按 Chapter.order 升序。
 * 空卷(没有命中的章节)被过滤掉,不出现在结果里。
 *
 * arcs 参数保留接口位(暂未使用)——未来若 Chapter 直接挂 arc 关联,可在此扩展。
 */
export function groupChaptersByVolume(
  chapters: Chapter[],
  volumes: Volume[],
  arcs: Arc[],
  outlines: ChapterOutline[]
): VolumeGroup[] {
  void arcs // 暂未使用,保留接口位避免破坏调用方
  const outlineByOrder = new Map<number, ChapterOutline>()
  for (const o of outlines) outlineByOrder.set(o.chapterOrder, o)

  const resolveVolumeId = (chapter: Chapter): string | null =>
    outlineByOrder.get(chapter.order)?.volumeId ?? null

  const buckets = new Map<string | null, Chapter[]>()
  for (const c of chapters) {
    const vid = resolveVolumeId(c)
    if (!buckets.has(vid)) buckets.set(vid, [])
    buckets.get(vid)!.push(c)
  }
  for (const list of buckets.values()) list.sort((a, b) => a.order - b.order)

  const groups: VolumeGroup[] = volumes
    .map((v) => ({
      volumeId: v.id,
      volumeOrder: v.order,
      volumeTitle: v.title,
      chapters: buckets.get(v.id) ?? []
    }))
    .filter((g) => g.chapters.length > 0)

  const orphans = buckets.get(null)
  if (orphans && orphans.length > 0) {
    // 未分卷组用 Infinity 作 volumeOrder(排序哨兵,放最后)。
    // 注意:Set<number> 内存 OK,但 JSON.stringify(Infinity) 会变 null——如未来持久化折叠态,需先转 -1 之类有限值。
    groups.push({
      volumeId: null,
      volumeOrder: Infinity,
      volumeTitle: null,
      chapters: orphans
    })
  }

  return groups
}

/**
 * 找指定 order 章所属的卷(用于 R-Reading 的「卷位」显示)。返回 null = 未分卷。
 * 只用 ChapterOutline.volumeId(见上 groupChaptersByVolume 的说明,不用 Arc.range)。
 */
export function findVolumeForChapter(
  order: number,
  volumes: Volume[],
  arcs: Arc[],
  outlines: ChapterOutline[]
): Volume | null {
  void arcs
  const outline = outlines.find((o) => o.chapterOrder === order)
  if (outline?.volumeId) {
    return volumes.find((v) => v.id === outline.volumeId) ?? null
  }
  return null
}
