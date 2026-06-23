export interface KbEntry {
  id: string
  name: string
  category: string
  tags: string[]
  description: string
}

export interface KbCategory {
  name: string
  count: number
}

export interface KbListFilter {
  category?: string
  tag?: string
  search?: string
}

export interface KbEntryDetail {
  entry: KbEntry
  content: string
}
