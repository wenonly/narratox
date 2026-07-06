import type { Arc, Chapter, ChapterOutline, Volume } from '@/types/novel'

/** 卷分组结果。volumeId=null 表示「未分卷」(兜底,放列表最后)。 */
export interface VolumeGroup {
  volumeId: string | null
  volumeOrder: number // 排序用;未分卷 = Infinity
  volumeTitle: string | null
  chapters: Chapter[]
}

/**
 * 把章节按卷分组。卷-章映射三层优先级(与 OutlineView 一致):
 * 1. ChapterOutline.volumeId(Phase 12 后真源)
 * 2. Arc.fromChapter ≤ order ≤ Arc.toChapter → arc.volumeId
 * 3. 都没有 → 未分卷(null),放最后
 *
 * 卷按 Volume.order 升序;卷内章节按 Chapter.order 升序。
 * 空卷(没有命中的章节)被过滤掉,不出现在结果里。
 */
export function groupChaptersByVolume(
  chapters: Chapter[],
  volumes: Volume[],
  arcs: Arc[],
  outlines: ChapterOutline[]
): VolumeGroup[] {
  const outlineByOrder = new Map<number, ChapterOutline>()
  for (const o of outlines) outlineByOrder.set(o.chapterOrder, o)

  const resolveVolumeId = (chapter: Chapter): string | null => {
    const outline = outlineByOrder.get(chapter.order)
    if (outline?.volumeId) return outline.volumeId
    const arc = arcs.find(
      (a) =>
        chapter.order >= a.fromChapter &&
        chapter.order <= a.toChapter &&
        a.volumeId
    )
    if (arc?.volumeId) return arc.volumeId
    return null
  }

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

/** 找指定 order 章所属的卷(用于 R-Reading 的「卷位」显示)。返回 null = 未分卷。 */
export function findVolumeForChapter(
  order: number,
  volumes: Volume[],
  arcs: Arc[],
  outlines: ChapterOutline[]
): Volume | null {
  const outline = outlines.find((o) => o.chapterOrder === order)
  if (outline?.volumeId) {
    return volumes.find((v) => v.id === outline.volumeId) ?? null
  }
  const arc = arcs.find(
    (a) => order >= a.fromChapter && order <= a.toChapter && a.volumeId
  )
  if (arc?.volumeId) {
    return volumes.find((v) => v.id === arc.volumeId) ?? null
  }
  return null
}
