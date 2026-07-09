import { makeSetCharacterTool } from './set-character.tool';
import type { CharacterService } from '../../novel/character.service';

describe('set_character tool', () => {
  it('透传 clear_fields 给 upsertCharacter', async () => {
    const upsertCharacter = jest.fn().mockResolvedValue({ id: 'c1' });
    const characters = { upsertCharacter } as unknown as CharacterService;
    const t = makeSetCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({
      name: '沈砚',
      personality: '新描述',
      clear_fields: ['appearance'],
    });
    expect(upsertCharacter).toHaveBeenCalledWith('u1', 'n1', {
      name: '沈砚',
      role: undefined,
      aliases: undefined,
      faction: undefined,
      background: undefined,
      appearance: undefined,
      personality: '新描述',
      motivation: undefined,
      arcGoal: undefined,
      voice: undefined,
      growth: undefined,
      flaw: undefined,
      clear_fields: ['appearance'],
    });
  });

  it('无 clear_fields 时正常透传(undefined)', async () => {
    const upsertCharacter = jest.fn().mockResolvedValue({ id: 'c1' });
    const characters = { upsertCharacter } as unknown as CharacterService;
    const t = makeSetCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({ name: '沈砚', role: 'PROTAGONIST' });
    expect(upsertCharacter).toHaveBeenCalledWith(
      'u1',
      'n1',
      expect.objectContaining({
        name: '沈砚',
        role: 'PROTAGONIST',
        clear_fields: undefined,
      }),
    );
  });

  it('返回 { ok: true, name }', async () => {
    const upsertCharacter = jest.fn().mockResolvedValue({ id: 'c1' });
    const characters = { upsertCharacter } as unknown as CharacterService;
    const t = makeSetCharacterTool({ userId: 'u1', novelId: 'n1', characters });
    const r = await t.invoke({ name: '沈砚' });
    expect(r).toEqual({ ok: true, name: '沈砚' });
  });
});
