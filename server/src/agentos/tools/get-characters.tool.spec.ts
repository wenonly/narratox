import { makeGetCharactersTool } from './get-characters.tool';
import type { CharacterService } from '../../novel/character.service';

describe('get_characters tool', () => {
  it('返回 lean(name/role/aliases/currentState),不带稳定档案', async () => {
    const listCharacters = jest.fn().mockResolvedValue([
      {
        name: '沈砚',
        role: 'PROTAGONIST',
        aliases: ['沈少'],
        faction: '棺材铺',
        background: '少掌柜',
        appearance: '青衫',
        personality: '外冷内热',
        motivation: '复仇',
        arcGoal: '放下',
        voice: '寡言',
        currentState: {
          status: { value: '被通缉', chapterOrder: 5, reason: '' },
        },
      },
    ]);
    const characters = { listCharacters } as unknown as CharacterService;
    const t = makeGetCharactersTool({ userId: 'u1', novelId: 'n1', characters });

    const out = await t.invoke({});

    expect(listCharacters).toHaveBeenCalledWith('u1', 'n1', undefined);
    expect(out.characters).toHaveLength(1);
    const c = out.characters[0];
    expect(c).toMatchObject({
      name: '沈砚',
      role: 'PROTAGONIST',
      aliases: ['沈少'],
    });
    expect(c.currentState).toEqual({
      status: { value: '被通缉', chapterOrder: 5, reason: '' },
    });
    // lean:不带稳定档案字段
    expect(c).not.toHaveProperty('personality');
    expect(c).not.toHaveProperty('motivation');
    expect(c).not.toHaveProperty('appearance');
  });

  it('超 30 截断 + note 提示', async () => {
    const all = Array.from({ length: 40 }, (_, i) => ({
      name: `角色${i}`,
      role: 'SUPPORTING',
      aliases: [],
      currentState: {},
    }));
    const listCharacters = jest.fn().mockResolvedValue(all);
    const characters = { listCharacters } as unknown as CharacterService;
    const t = makeGetCharactersTool({ userId: 'u1', novelId: 'n1', characters });

    const out = await t.invoke({});

    expect(out.characters).toHaveLength(30);
    expect(out.note).toContain('40');
  });
});
