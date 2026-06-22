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
    expect(map['方法论教程']).toBe(1);
    expect(map['人设档案']).toBe(1);
  });

  it('filters by category', async () => {
    const { entries } = await svc.list({ category: '人设档案' });
    expect(entries.map((e) => e.id)).toEqual(['kb0002']);
  });

  it('filters by tag (matches any tag dimension value)', async () => {
    const { entries } = await svc.list({ tag: '言情' });
    expect(entries.map((e) => e.id)).toEqual(['kb0002']);
  });

  it('searches by name/description substring (case-insensitive)', async () => {
    const { entries } = await svc.list({ search: '雪花' });
    expect(entries.map((e) => e.id)).toEqual(['kb0001']);
  });

  it('getEntry returns body with frontmatter stripped', async () => {
    const r = await svc.getEntry('kb0001');
    expect(r).not.toBeNull();
    expect(r!.content.startsWith('一、从一句话梗概开始')).toBe(true);
    expect(r!.entry.name).toBe('测试-雪花写作法');
  });

  it('getEntry returns null for unknown id', async () => {
    expect(await svc.getEntry('nope')).toBeNull();
  });

  it('search scores results and deprioritizes OCR source', async () => {
    const res = await svc.search('花');
    const ids = res.map((e) => e.id);
    expect(ids).toContain('kb0002');
    expect(ids).toContain('kb0001');
    expect(ids.indexOf('kb0001')).toBeLessThanOrEqual(ids.indexOf('kb0002'));
  });
});
