import { makeRestoreChapterTool } from './restore-chapter.tool';
import type { RevisionSnapshotService } from '../../novel/revision-snapshot.service';

describe('restore_chapter tool', () => {
  it('restores the snapshotted content and returns ok', async () => {
    const restore = jest.fn().mockResolvedValue({ ok: true, chars: 500 });
    const snapshots = { restore } as unknown as RevisionSnapshotService;
    const t = makeRestoreChapterTool({
      userId: 'u1',
      novelId: 'n1',
      snapshots,
    });
    const out = await t.invoke({ chapterOrder: 3 });
    expect(restore).toHaveBeenCalledWith('u1', 'n1', 3);
    expect(out).toMatchObject({ ok: true });
  });

  it('returns ok=false with a message when no snapshot exists', async () => {
    const restore = jest
      .fn()
      .mockResolvedValue({ ok: false, reason: 'no_snapshot' });
    const snapshots = { restore } as unknown as RevisionSnapshotService;
    const t = makeRestoreChapterTool({
      userId: 'u1',
      novelId: 'n1',
      snapshots,
    });
    const out = (await t.invoke({ chapterOrder: 3 })) as {
      ok: false;
      message: string;
    };
    expect(out.ok).toBe(false);
    expect(out.message).toContain('快照');
  });
});
