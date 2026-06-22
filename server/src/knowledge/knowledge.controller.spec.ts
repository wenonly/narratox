import { NotFoundException } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  let svc: { list: jest.Mock; getEntry: jest.Mock };

  beforeEach(() => {
    svc = { list: jest.fn(), getEntry: jest.fn() };
    controller = new KnowledgeController(svc as unknown as KnowledgeService);
  });

  it('list() delegates filter to service', async () => {
    svc.list.mockResolvedValue({ categories: [], entries: [] });
    await controller.list('方法论教程', '大纲', '雪花');
    expect(svc.list).toHaveBeenCalledWith({
      category: '方法论教程',
      tag: '大纲',
      search: '雪花',
    });
  });

  it('entry() returns detail from service', async () => {
    const detail = { entry: { id: 'kb0001' }, content: '正文' };
    svc.getEntry.mockResolvedValue(detail);
    await expect(controller.entry('kb0001')).resolves.toEqual(detail);
  });

  it('entry() throws NotFoundException when missing', async () => {
    svc.getEntry.mockResolvedValue(null);
    await expect(controller.entry('nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});
