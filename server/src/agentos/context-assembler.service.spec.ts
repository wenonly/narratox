import { ContextAssembler } from './context-assembler.service';
import { SYSTEM_PROMPT } from './agentos.constants';
import type { PrismaService } from '../prisma/prisma.service';

describe('ContextAssembler', () => {
  describe('buildSystemPrompt', () => {
    it('weaves title/genre/synopsis/settings into an author-facing prompt', () => {
      const svc = new ContextAssembler({} as unknown as PrismaService);
      const prompt = svc.buildSystemPrompt({
        title: '剑来',
        genre: '仙侠',
        synopsis: '一个少年的修行路',
        settings: { style: '冷峻', language: 'zh', worldviewText: '九州' },
      });
      expect(prompt).toContain('剑来');
      expect(prompt).toContain('仙侠');
      expect(prompt).toContain('一个少年的修行路');
      expect(prompt).toContain('冷峻');
      expect(prompt).toContain('九州');
    });

    it('works without optional fields', () => {
      const svc = new ContextAssembler({} as unknown as PrismaService);
      const prompt = svc.buildSystemPrompt({
        title: '无题',
        genre: null,
        synopsis: null,
        settings: {},
      });
      expect(prompt).toContain('无题');
    });
  });

  describe('forSession', () => {
    it('returns the novel prompt + novelId when the session belongs to the user', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'nid-1',
        title: 'T',
        genre: 'g',
        synopsis: 's',
        settings: {},
      });
      const svc = new ContextAssembler({
        novel: { findFirst },
      } as unknown as PrismaService);
      const { prompt, novelId } = await svc.forSession('u1', 's1');
      // select now includes id so we can thread novelId to the workspace swarm.
      expect(findFirst).toHaveBeenCalledWith({
        where: { sessionId: 's1', userId: 'u1' },
        select: {
          title: true,
          genre: true,
          synopsis: true,
          settings: true,
          id: true,
        },
      });
      expect(prompt).toContain('T');
      expect(novelId).toBe('nid-1');
    });

    it('falls back to the generic prompt and null novelId when no novel is found', async () => {
      const svc = new ContextAssembler({
        novel: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService);
      const { prompt, novelId } = await svc.forSession('u1', 'orphan');
      expect(prompt).toBe(SYSTEM_PROMPT);
      expect(novelId).toBeNull();
    });
  });
});
