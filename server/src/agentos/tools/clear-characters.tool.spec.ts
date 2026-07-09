import { makeClearCharactersTool } from './clear-characters.tool';
import type { CharacterService } from '../../novel/character.service';

describe('clear_characters tool', () => {
  it('转发给 CharacterService.clearCharacters', async () => {
    const clearCharacters = jest.fn().mockResolvedValue({
      ok: true,
      deletedCharacters: 5,
      deletedChanges: 20,
      warned: true,
      reason: 'ACTIVE',
    });
    const characters = { clearCharacters } as unknown as CharacterService;
    const t = makeClearCharactersTool({ userId: 'u1', novelId: 'n1', characters });
    await t.invoke({});
    expect(clearCharacters).toHaveBeenCalledWith('u1', 'n1');
  });

  it('ACTIVE warning 透传', async () => {
    const clearCharacters = jest.fn().mockResolvedValue({
      ok: true,
      deletedCharacters: 3,
      deletedChanges: 9,
      warned: true,
      reason: '全书角色 bible 已清空',
    });
    const characters = { clearCharacters } as unknown as CharacterService;
    const t = makeClearCharactersTool({ userId: 'u1', novelId: 'n1', characters });
    const out = (await t.invoke({})) as any;
    expect(out.warned).toBe(true);
    expect(out.reason).toContain('清空');
  });

  it('empty 透传', async () => {
    const clearCharacters = jest.fn().mockResolvedValue({ ok: false, reason: 'empty' });
    const characters = { clearCharacters } as unknown as CharacterService;
    const t = makeClearCharactersTool({ userId: 'u1', novelId: 'n1', characters });
    const out = (await t.invoke({})) as any;
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('empty');
  });
});
