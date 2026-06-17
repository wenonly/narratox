export interface NovelSettings {
  style?: string
  language?: string
  chapterWordTarget?: number
  worldviewText?: string
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

export interface Novel {
  id: string
  userId: string
  sessionId: string
  title: string
  genre: string | null
  synopsis: string | null
  settings: NovelSettings
  createdAt: string
  updatedAt: string
  chapters: Chapter[]
}

export interface CreateNovelInput {
  title: string
  genre?: string
  synopsis?: string
  settings?: NovelSettings
}
