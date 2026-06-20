export interface NovelSettings {
  style?: string
  language?: string
  chapterWordTarget?: number
  worldviewText?: string
  coreConflict?: string
}

export interface Chapter {
  id: string
  novelId: string
  order: number
  title: string
  content: string
  status: 'DRAFT' | 'COMMITTED'
  createdAt: string
  updatedAt: string
}

export interface NovelListItem {
  id: string
  userId: string
  sessionId: string
  title: string
  genre: string | null
  synopsis: string | null
  status?: 'CONCEPT' | 'ACTIVE'
  settings: NovelSettings
  createdAt: string
  updatedAt: string
}

export interface Novel extends NovelListItem {
  chapters: Chapter[]
}

export interface CreateNovelInput {
  title: string
  genre?: string
  synopsis?: string
  settings?: NovelSettings
}

// ── 大纲(Phase C1):两层结构化 ──
/** 细纲节点:主体 | 动作/变化 | 对象/结果 */
export interface OutlineNode {
  subject: string
  action: string
  target: string
}

export type ChapterOutlineStatus = 'DRAFT' | 'APPROVED' | 'WRITTEN'

/** 卷(大纲/卷纲) */
export interface Volume {
  id: string
  novelId: string
  order: number
  title: string
  goal: string
  synopsis: string
}

/** 章细纲:CBN + CPNs + CEN + 必须覆盖/禁区 */
export interface ChapterOutline {
  id: string
  novelId: string
  volumeId?: string | null
  chapterOrder: number
  title: string
  cbn: OutlineNode
  cpns: OutlineNode[]
  cen: OutlineNode
  mustCover: string[]
  forbidden: string[]
  status: ChapterOutlineStatus
}

export interface OutlineData {
  volumes: Volume[]
  chapterOutlines: ChapterOutline[]
}

// ── 世界观(Phase 2):类型化条目(codex) ──
export type WorldEntryType =
  | 'concept'
  | 'powerSystem'
  | 'location'
  | 'faction'
  | 'race'
  | 'rule'
  | 'item'
  | 'history'

export interface WorldEntry {
  id: string
  novelId: string
  type: WorldEntryType
  name: string
  content: string
}
