import { Injectable } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const KB_DIR = 'KB_DIR';

/** 知识库的 6 个分类目录名（直接挂在 KB_DIR 根下）。 */
const CATEGORIES = [
  '人设档案',
  '公式模板',
  '创作须知',
  '拆文案例',
  '词汇素材库',
  '方法论教程',
] as const;

export interface KbEntry {
  id: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
  /** 相对 KB_DIR 的路径，如「人设档案/反差萌人设.md」。 */
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

/**
 * 从 md 正文提取 description：
 * 1) 优先取 `> **一句话**：xxx` 的 xxx；
 * 2) 回退取首个 blockquote 行（`> xxx`）；
 * 3) 都没有则返回空串（list 用 name 兜底）。
 */
function extractDescription(body: string): string {
  const m = body.match(/^[^\n]*\*\*一句话\*\*[：:]\s*([^\n]+)/m);
  if (m) return m[1].replace(/[`*>]/g, '').trim();
  const bq = body.match(/^>\s*(.+)/m);
  if (bq) return bq[1].replace(/[`*>]/g, '').trim();
  return '';
}

/** 解析 frontmatter 里的 tags（兼容 `tags: [a, b]` 与块式 `tags:\n  - a`）。 */
function parseTags(frontmatter: string): string[] {
  const lineMatch = frontmatter.match(/^tags\s*:\s*(.+)$/m);
  if (lineMatch && lineMatch[1].trim()) {
    // 行内式 [a, b, c]
    const inline = lineMatch[1].match(/\[(.*)\]/);
    if (inline) {
      return inline[1]
        .split(',')
        .map((t) => t.replace(/["']/g, '').trim())
        .filter(Boolean);
    }
  }
  // 块式：tags: 后跟若干 `  - x`
  const blockMatch = frontmatter.match(/^tags\s*:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (blockMatch) {
    return blockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*-\s*/, '').replace(/["']/g, '').trim())
      .filter(Boolean);
  }
  return [];
}

@Injectable()
export class KnowledgeService {
  private cache: KbEntry[] | null = null;
  private byId = new Map<string, KbEntry>();

  constructor(private readonly kbDir: string) {}

  /** 扫描 KB_DIR/<分类>/*.md，运行时解析，内存缓存。md 文件即唯一真相源。 */
  private async load(): Promise<KbEntry[]> {
    if (this.cache) return this.cache;
    const entries: KbEntry[] = [];
    for (const category of CATEGORIES) {
      const dir = join(this.kbDir, category);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue; // 该分类目录不存在则跳过
      }
      for (const f of files.sort()) {
        if (!f.endsWith('.md')) continue;
        const mdPath = `${category}/${f}`;
        const raw = await readFile(join(this.kbDir, mdPath), 'utf-8');
        const m = raw.match(/^---\n(.*?)\n---\n(.*)$/s);
        const frontmatter = m ? m[1] : '';
        const body = m ? m[2] : raw;
        entries.push({
          id: '', // 稍后统一编号
          name: f.replace(/\.md$/, ''),
          category,
          tags: parseTags(frontmatter),
          description: extractDescription(body),
          md_path: mdPath,
        });
      }
    }
    // 按 (category 固定顺序, 文件名) 排序后递增编号，保证稳定可复现。
    entries.sort(
      (a, b) =>
        CATEGORIES.indexOf(a.category as (typeof CATEGORIES)[number]) -
          CATEGORIES.indexOf(b.category as (typeof CATEGORIES)[number]) ||
        a.name.localeCompare(b.name),
    );
    entries.forEach((e, i) => {
      e.id = `zl${String(i + 1).padStart(4, '0')}`;
    });
    this.cache = entries;
    this.byId = new Map(entries.map((e) => [e.id, e]));
    return entries;
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
      entries = entries.filter((e) => e.tags.includes(filter.tag!));
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
   * 关键词检索(知识库浏览页 /knowledge?search= 用)。
   * 命中:name +5、tag +4、description +3。(均已精校,不再有 OCR 降权。)
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
        if (e.tags.some((t) => t.toLowerCase().includes(q))) score += 4;
        if (e.description.toLowerCase().includes(q)) score += 3;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (opts.category)
      scored = scored.filter((x) => x.e.category === opts.category);
    return scored.slice(0, opts.limit ?? 8).map((x) => x.e);
  }
}
