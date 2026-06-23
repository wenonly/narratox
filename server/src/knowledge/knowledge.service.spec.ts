import { join } from 'node:path';
import { KnowledgeService } from './knowledge.service';

const FIXTURE = join(__dirname, '../../test/fixtures/kb');

describe('KnowledgeService', () => {
  let svc: KnowledgeService;
  beforeEach(() => {
    svc = new KnowledgeService(FIXTURE);
  });

  it('lists all entries with category counts', async () => {
    const { categories, entries } = await svc.list({});
    expect(entries).toHaveLength(2);
    const map = Object.fromEntries(categories.map((c) => [c.name, c.count]));
    expect(map['人设档案']).toBe(1);
    expect(map['方法论教程']).toBe(1);
  });

  it('assigns stable zl{NN} ids by category-then-name order', async () => {
    const { entries } = await svc.list({});
    // 人设档案(CATEGORIES 第 0)排在 方法论教程(第 5)前
    expect(entries.map((e) => e.id)).toEqual(['zl0001', 'zl0002']);
    expect(entries[0].category).toBe('人设档案');
    expect(entries[1].category).toBe('方法论教程');
  });

  it('filters by category', async () => {
    const { entries } = await svc.list({ category: '人设档案' });
    expect(entries.map((e) => e.id)).toEqual(['zl0001']);
  });

  it('filters by flat tag', async () => {
    const { entries } = await svc.list({ tag: '言情' });
    expect(entries.map((e) => e.id)).toEqual(['zl0001']);
  });

  it('extracts description from the 一句话 blockquote', async () => {
    const { entries } = await svc.list({});
    const renfang = entries.find((e) => e.id === 'zl0001')!;
    expect(renfang.description).toContain('三步塑造高岭之花');
  });

  it('searches by name/description substring (case-insensitive)', async () => {
    const { entries } = await svc.list({ search: '雪花' });
    expect(entries.map((e) => e.id)).toEqual(['zl0002']);
  });

  it('getEntry returns body with frontmatter stripped (keeps 一句话)', async () => {
    const r = await svc.getEntry('zl0002');
    expect(r).not.toBeNull();
    expect(r!.content.startsWith('> **一句话**')).toBe(true);
    expect(r!.entry.name).toBe('测试-雪花写作法');
    expect(r!.entry.tags).toEqual(['大纲']);
  });

  it('getEntry returns null for unknown id', async () => {
    expect(await svc.getEntry('nope')).toBeNull();
  });

  it('search scores results (name > tag > description)', async () => {
    // 「花」同时命中两条的名字(各 +5),稳定排序保留原顺序
    const res = await svc.search('花');
    const ids = res.map((e) => e.id);
    expect(ids).toContain('zl0001');
    expect(ids).toContain('zl0002');
    expect(ids.indexOf('zl0001')).toBeLessThanOrEqual(ids.indexOf('zl0002'));
  });

  it('search matches tags', async () => {
    const res = await svc.search('大纲');
    expect(res.map((e) => e.id)).toEqual(['zl0002']);
  });

  it('search returns empty for empty/whitespace query', async () => {
    expect(await svc.search('')).toEqual([]);
    expect(await svc.search('   ')).toEqual([]);
  });
});
