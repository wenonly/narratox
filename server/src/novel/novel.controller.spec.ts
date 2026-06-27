import { Test } from '@nestjs/testing';
import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';
import { ChapterService } from './chapter.service';
import { OutlineService } from './outline.service';
import { WorldEntryService } from './world-entry.service';
import { NovelReferenceService } from './novel-reference.service';
import { CharacterService } from './character.service';
import { StoryEventService } from '../memory/story-event.service';
import type { RequestUser } from '../auth/current-user.decorator';

const USER: RequestUser = { id: 'u1', email: 'a@b.com' };

describe('NovelController', () => {
  let controller: NovelController;
  let novels: {
    create: jest.Mock;
    list: jest.Mock;
    get: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    setVoiceProfile: jest.Mock;
  };
  let chapters: { list: jest.Mock; create: jest.Mock; update: jest.Mock };
  let outlines: { listOutline: jest.Mock };
  let world: { listEntries: jest.Mock };
  let references: { listAll: jest.Mock; update: jest.Mock };
  let characters: { listCharacters: jest.Mock };
  let hooks: { listForStatusView: jest.Mock };

  beforeEach(async () => {
    novels = {
      create: jest.fn().mockResolvedValue({ id: 'n1' }),
      list: jest.fn().mockResolvedValue([{ id: 'n1' }]),
      get: jest.fn().mockResolvedValue({ id: 'n1', chapters: [] }),
      update: jest.fn().mockResolvedValue({ id: 'n1' }),
      delete: jest.fn().mockResolvedValue({ count: 1 }),
      setVoiceProfile: jest.fn().mockResolvedValue({ ok: true }),
    };
    chapters = {
      list: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      create: jest.fn().mockResolvedValue({ id: 'c1', order: 1 }),
      update: jest.fn().mockResolvedValue({ id: 'c1' }),
    };
    outlines = {
      listOutline: jest
        .fn()
        .mockResolvedValue({ volumes: [], chapterOutlines: [] }),
    };
    world = { listEntries: jest.fn().mockResolvedValue([]) };
    references = {
      listAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'r1' }),
    };
    characters = { listCharacters: jest.fn().mockResolvedValue([]) };
    hooks = { listForStatusView: jest.fn().mockResolvedValue([]) };
    const module = await Test.createTestingModule({
      controllers: [NovelController],
      providers: [
        { provide: NovelService, useValue: novels },
        { provide: ChapterService, useValue: chapters },
        { provide: OutlineService, useValue: outlines },
        { provide: WorldEntryService, useValue: world },
        { provide: NovelReferenceService, useValue: references },
        { provide: CharacterService, useValue: characters },
        { provide: StoryEventService, useValue: hooks },
      ],
    }).compile();
    controller = module.get(NovelController);
  });

  it('POST /novels forwards dto to NovelService.create', async () => {
    await controller.create(USER, { title: 'T' });
    expect(novels.create).toHaveBeenCalledWith('u1', { title: 'T' });
  });

  it('GET /novels lists', async () => {
    const result = await controller.list(USER);
    expect(novels.list).toHaveBeenCalledWith('u1');
    expect(result).toEqual([{ id: 'n1' }]);
  });

  it('GET /novels/:id returns novel + chapters', async () => {
    await controller.get(USER, 'n1');
    expect(novels.get).toHaveBeenCalledWith('u1', 'n1');
  });

  it('GET /novels/:id/chapters lists chapters', async () => {
    await controller.listChapters(USER, 'n1');
    expect(chapters.list).toHaveBeenCalledWith('u1', 'n1');
  });

  it('GET /novels/:id/outline forwards to OutlineService.listOutline', async () => {
    await controller.getOutline(USER, 'n1');
    expect(outlines.listOutline).toHaveBeenCalledWith('u1', 'n1');
  });

  it('GET /novels/:id/worldview forwards to WorldEntryService.listEntries', async () => {
    await controller.getWorldview(USER, 'n1');
    expect(world.listEntries).toHaveBeenCalledWith('u1', 'n1');
  });

  it('POST /novels/:id/chapters creates a chapter', async () => {
    await controller.createChapter(USER, 'n1', { title: '二' });
    expect(chapters.create).toHaveBeenCalledWith('u1', 'n1', { title: '二' });
  });

  it('PATCH /novels/:id/chapters/:cid forwards to ChapterService.update', async () => {
    await controller.updateChapter(USER, 'n1', 'c1', { content: 'x' });
    expect(chapters.update).toHaveBeenCalledWith('u1', 'n1', 'c1', {
      content: 'x',
    });
  });

  it('DELETE /novels/:id deletes and returns ok', async () => {
    const result = await controller.delete(USER, 'n1');
    expect(novels.delete).toHaveBeenCalledWith('u1', 'n1');
    expect(result).toEqual({ ok: true });
  });

  it('PATCH /novels/:id forwards dto to NovelService.update', async () => {
    await controller.update(USER, 'n1', { title: 'T2' });
    expect(novels.update).toHaveBeenCalledWith('u1', 'n1', { title: 'T2' });
  });

  describe('NovelController references', () => {
    it('GET /novels/:id/references forwards to references.listAll', async () => {
      await controller.getReferences(USER, 'n1');
      expect(references.listAll).toHaveBeenCalledWith('u1', 'n1');
    });

    it('PATCH /novels/:id/references/:rid forwards dto to references.update', async () => {
      await controller.updateReference(USER, 'n1', 'r1', {
        injectTo: 'both',
      });
      expect(references.update).toHaveBeenCalledWith(
        'u1',
        'n1',
        'r1',
        expect.objectContaining({ injectTo: 'both' }),
      );
    });
  });

  describe('PUT /novels/:id/voice-profile', () => {
    it('forwards voiceProfileId to novels.setVoiceProfile and returns ok', async () => {
      const out = await controller.setVoiceProfile(USER, 'n1', {
        voiceProfileId: 'v1',
      });
      expect(novels.setVoiceProfile).toHaveBeenCalledWith('u1', 'n1', 'v1');
      expect(out).toEqual({ ok: true });
    });

    it('forwards null voiceProfileId (clear) to novels.setVoiceProfile', async () => {
      await controller.setVoiceProfile(USER, 'n1', { voiceProfileId: null });
      expect(novels.setVoiceProfile).toHaveBeenCalledWith('u1', 'n1', null);
    });
  });
});
