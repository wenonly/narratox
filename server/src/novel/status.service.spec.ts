import { StatusService } from './status.service';

const NOVEL_ACTIVE = { id: 'n1', status: 'ACTIVE', settings: {}, sessionId: 's1' };
const NOVEL_CONCEPT = { id: 'n1', status: 'CONCEPT', settings: { title: 't', genre: 'g' }, sessionId: 's1' };

// 给定 Novel 行 + 各表计数,返回带默认值的 prisma mock。
const mockPrisma = (over: {
  novel?: any;
  chapters?: any[];
  chapterAggMax?: number;
  plannedMax?: number;
  plannedCount?: number;
  counts?: Partial<Record<'ref' | 'world' | 'vol' | 'arc' | 'char' | 'event', number>>;
  lastMsgActivities?: any;
}) => ({
  novel: { findFirst: jest.fn().mockResolvedValue(over.novel ?? NOVEL_ACTIVE) },
  chapter: {
    aggregate: jest.fn().mockResolvedValue({ _max: { order: over.chapterAggMax ?? 8 }, _count: {} }),
    findMany: jest.fn().mockResolvedValue(over.chapters ?? [{ content: '一二三', status: 'COMMITTED', order: 1 }]),
  },
  worldEntry: { count: jest.fn().mockResolvedValue(over.counts?.world ?? 2) },
  novelReference: { count: jest.fn().mockResolvedValue(over.counts?.ref ?? 1) },
  volume: { count: jest.fn().mockResolvedValue(over.counts?.vol ?? 1), findUnique: jest.fn().mockResolvedValue(null) },
  arc: { count: jest.fn().mockResolvedValue(over.counts?.arc ?? 2) },
  character: { count: jest.fn().mockResolvedValue(over.counts?.char ?? 1) },
  chapterOutline: {
    aggregate: jest.fn().mockResolvedValue({ _max: { chapterOrder: over.plannedMax ?? 22 } }),
    count: jest.fn().mockResolvedValue(over.plannedCount ?? 22),
  },
  event: { count: jest.fn().mockResolvedValue(over.counts?.event ?? 3) },
  message: { findFirst: jest.fn().mockResolvedValue(over.lastMsgActivities !== undefined ? { activities: over.lastMsgActivities } : null) },
});

const mockEvents = (openHooks: any[] = [{ stale: false }, { stale: true }]) => ({
  listOpen: jest.fn().mockResolvedValue(openHooks),
});
const mockArcs = (arc: any = null) => ({ findArcByChapter: jest.fn().mockResolvedValue(arc) });

describe('StatusService.getOverview', () => {
  it('ACTIVE:进度 + frontier + 覆盖 + 健康', async () => {
    const prisma = mockPrisma({ chapters: [{ content: '一二三', status: 'COMMITTED', order: 1 }, { content: '四五六七八九', status: 'COMMITTED', order: 2 }] });
    const svc = new StatusService(prisma as any, mockEvents() as any, mockArcs() as any);
    const out: any = await svc.getOverview('u1', 'n1');
    expect(out.status).toBe('ACTIVE');
    expect(out.totalWords).toBe(9); // 3 + 6(字符数)
    expect(out.chapterCount).toBe(2);
    expect(out.frontierChapter).toBe(3); // maxOrder(2)+1
    expect(out.coverage.plannedChapters).toBe(22);
    expect(out.coverage.plannedRemaining).toBe(22 - 3 + 1); // 20
    expect(out.health.openHooks).toBe(2);
    expect(out.health.staleHooks).toBe(1);
    expect(out.health.majorEvents).toBe(3);
  });

  it('currentArc 命中 + currentVolume 取 arc.volumeId', async () => {
    const prisma = mockPrisma({});
    prisma.volume.findUnique = jest.fn().mockResolvedValue({ order: 1, title: '初入江湖' });
    const svc = new StatusService(prisma as any, mockEvents() as any, mockArcs({ order: 2, title: '拜师', volumeId: 'v1', fromChapter: 9, toChapter: 15 }) as any);
    const out: any = await svc.getOverview('u1', 'n1');
    expect(out.currentArc).toMatchObject({ order: 2, title: '拜师' });
    expect(out.currentVolume).toMatchObject({ title: '初入江湖' });
  });

  it('CONCEPT + 基础未齐 + 角色缺 → nextStep collect_basics,onboarding.readyToWrite=false', async () => {
    const prisma = mockPrisma({ novel: NOVEL_CONCEPT, counts: { char: 0 } });
    const svc = new StatusService(prisma as any, mockEvents() as any, mockArcs() as any);
    const out: any = await svc.getOverview('u1', 'n1');
    expect(out.onboarding.basics.title).toBe(true);
    expect(out.onboarding.basics.synopsis).toBe(false);
    expect(out.onboarding.readyToWrite).toBe(false);
    expect(out.nextStep).toBe('collect_basics');
  });

  it('ACTIVE + plannedRemaining≤3 → nextStep plan_more', async () => {
    // maxOrder 来自 chapters 数组(impl 不用 aggregate 的 order):order=20 → frontier=21
    const prisma = mockPrisma({ chapters: [{ content: 'x', status: 'COMMITTED', order: 20 }], plannedMax: 22 }); // remaining=22-21+1=2
    const svc = new StatusService(prisma as any, mockEvents() as any, mockArcs() as any);
    const out: any = await svc.getOverview('u1', 'n1');
    expect(out.coverage.plannedRemaining).toBe(2);
    expect(out.nextStep).toBe('plan_more');
  });

  it('recentPhase 从最后一条 message activities 派生(末个工具)', async () => {
    const prisma = mockPrisma({ lastMsgActivities: { steps: [{ tool: 'set_world_entry' }, { tool: 'append_section' }] } });
    const svc = new StatusService(prisma as any, mockEvents() as any, mockArcs() as any);
    const out: any = await svc.getOverview('u1', 'n1');
    expect(out.recentPhase).toBe('写正文'); // append_section 末个命中
  });

  it('novel 不属 user → null', async () => {
    const prisma = mockPrisma({});
    prisma.novel.findFirst.mockResolvedValue(null);
    const svc = new StatusService(prisma as any, mockEvents() as any, mockArcs() as any);
    expect(await svc.getOverview('u1', 'n1')).toBeNull();
  });
});
