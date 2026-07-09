import { makeDeleteCharacterTool } from './delete-character.tool';
import type { CharacterService } from '../../novel/character.service';

describe('delete_character tool', () => {
  it('转发给 CharacterService.deleteCharacter(name, cascade)', async () => {
    const deleteCharacter = jest.fn().mockResolvedValue({
      ok: true,
      name: '沈砚',
      deletedChanges: 3,
    });
    const characters = { deleteCharacter } as unknown as CharacterService;
    const t = makeDeleteCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    const out = await t.invoke({ name: '沈砚', cascade: true });
    expect(deleteCharacter).toHaveBeenCalledWith('u1', 'n1', '沈砚', true);
    expect(out).toMatchObject({ ok: true, name: '沈砚', deletedChanges: 3 });
  });

  it('cascade 默认 false(不传)', async () => {
    const deleteCharacter = jest.fn().mockResolvedValue({
      ok: false,
      error: 'HAS_CHANGES',
      changes: 5,
      hint: '...',
    });
    const characters = { deleteCharacter } as unknown as CharacterService;
    const t = makeDeleteCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({ name: '沈砚' });
    expect(deleteCharacter).toHaveBeenCalledWith('u1', 'n1', '沈砚', false);
  });

  it('HAS_CHANGES 透传(不偷删)', async () => {
    const deleteCharacter = jest.fn().mockResolvedValue({
      ok: false,
      error: 'HAS_CHANGES',
      changes: 5,
      hint: '有 5 条',
    });
    const characters = { deleteCharacter } as unknown as CharacterService;
    const t = makeDeleteCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    const out = (await t.invoke({ name: '沈砚' })) as any;
    expect(out.ok).toBe(false);
    expect(out.error).toBe('HAS_CHANGES');
    expect(out.changes).toBe(5);
  });
});
