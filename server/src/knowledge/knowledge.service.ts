import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const KB_DIR = 'KB_DIR';

export interface KbEntry {
  id: string;
  name: string;
  category: string;
  tags: Record<string, string[]>;
  description: string;
  source: string;
  source_method: string;
  source_ocr: boolean;
  chars: number;
  content_hash: string;
  md_path: string;
}

export interface KbCategoryCount {
  name: string;
  count: number;
}

export interface KbListFilter {
  category?: string;
  tag?: string;
  search?: string;
}

@Injectable()
export class KnowledgeService {
  private cache: KbEntry[] | null = null;
  private byId = new Map<string, KbEntry>();

  constructor(private readonly kbDir: string) {}

  private async load(): Promise<KbEntry[]> {
    if (this.cache) return this.cache;
    const raw = await readFile(join(this.kbDir, 'kb_index.json'), 'utf-8');
    const data = JSON.parse(raw) as KbEntry[];
    this.cache = data;
    this.byId = new Map(data.map((e) => [e.id, e]));
    return data;
  }

  async categories(): Promise<KbCategoryCount[]> {
    const entries = await this.load();
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  async list(
    filter: KbListFilter = {},
  ): Promise<{ categories: KbCategoryCount[]; entries: KbEntry[] }> {
    let entries = await this.load();
    if (filter.category)
      entries = entries.filter((e) => e.category === filter.category);
    if (filter.tag)
      entries = entries.filter((e) =>
        Object.values(e.tags).flat().includes(filter.tag!),
      );
    if (filter.search) {
      const q = filter.search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q),
      );
    }
    return { categories: await this.categories(), entries };
  }

  async getEntry(
    id: string,
  ): Promise<{ entry: KbEntry; content: string } | null> {
    await this.load();
    const entry = this.byId.get(id);
    if (!entry) return null;
    const raw = await readFile(join(this.kbDir, entry.md_path), 'utf-8');
    const m = raw.match(/^---\n.*?\n---\n(.*)$/s);
    return { entry, content: (m ? m[1] : raw).trim() };
  }

  /**
   * 关键词检索(Plan 2 的 curator search_knowledge 工具也会用)。
   * 命中:name +5、tag +4、description +3;OCR 来源 -1 降权。
   */
  async search(
    query: string,
    opts: { category?: string; limit?: number } = {},
  ): Promise<KbEntry[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const entries = await this.load();
    let scored = entries
      .map((e) => {
        let score = 0;
        if (e.name.toLowerCase().includes(q)) score += 5;
        if (
          Object.values(e.tags)
            .flat()
            .some((t) => t.toLowerCase().includes(q))
        )
          score += 4;
        if (e.description.toLowerCase().includes(q)) score += 3;
        if (e.source_ocr) score -= 1;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (opts.category)
      scored = scored.filter((x) => x.e.category === opts.category);
    return scored.slice(0, opts.limit ?? 8).map((x) => x.e);
  }
}
