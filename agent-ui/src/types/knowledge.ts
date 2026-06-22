export interface KbEntry {
  id: string
  name: string
  category: string
  tags: Record<string, string[]>
  description: string
  source: string
  source_ocr: boolean
  chars: number
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
  entry: KbEntry & { source_method: string; content_hash: string }
  content: string
}
