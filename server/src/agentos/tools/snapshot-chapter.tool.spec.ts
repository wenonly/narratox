import { makeSnapshotChapterTool } from './snapshot-chapter.tool';
import type { RevisionSnapshotService } from '../../novel/revision-snapshot.service';

describe('snapshot_chapter tool', () => {
  it('delegates to RevisionSnapshotService.snapshot with bound ids', async () => {
    const snapshot = jest.fn().mockResolvedValue({ ok: true, chars: 500 });
    const snapshots = { snapshot } as unknown as RevisionSnapshotService;
    const t = makeSnapshotChapterTool({
      userId: 'u1',
      novelId: 'n1',
      snapshots,
    });
    const out = await t.invoke({ chapterOrder: 3 });
    expect(snapshot).toHaveBeenCalledWith('u1', 'n1', 3);
    expect(out).toMatchObject({ ok: true, chars: 500 });
  });
});
