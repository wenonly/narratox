import { Test } from '@nestjs/testing';
import { VoiceProfileController } from './voice-profile.controller';
import { VoiceProfileService } from './voice-profile.service';
import type { RequestUser } from '../auth/current-user.decorator';

const USER: RequestUser = { id: 'u1', email: 'a@b.com' };

describe('VoiceProfileController', () => {
  let controller: VoiceProfileController;
  let voice: {
    list: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    generate: jest.Mock;
  };

  beforeEach(async () => {
    voice = {
      list: jest.fn().mockResolvedValue([{ id: 'v1' }]),
      create: jest.fn().mockResolvedValue({ id: 'v1' }),
      update: jest.fn().mockResolvedValue({ id: 'v1' }),
      remove: jest.fn().mockResolvedValue({ ok: true }),
      generate: jest.fn().mockResolvedValue({ profile: '# 画像' }),
    };
    const module = await Test.createTestingModule({
      controllers: [VoiceProfileController],
      providers: [{ provide: VoiceProfileService, useValue: voice }],
    }).compile();
    controller = module.get(VoiceProfileController);
  });

  it('GET forwards to voice.list', async () => {
    await controller.list(USER);
    expect(voice.list).toHaveBeenCalledWith('u1');
  });

  it('POST forwards dto to voice.create', async () => {
    await controller.create(USER, { name: '鲁迅风', profile: '# 画像' });
    expect(voice.create).toHaveBeenCalledWith('u1', {
      name: '鲁迅风',
      profile: '# 画像',
    });
  });

  it('PATCH :id forwards dto to voice.update', async () => {
    await controller.update(USER, 'v1', { name: '改名' });
    expect(voice.update).toHaveBeenCalledWith('u1', 'v1', { name: '改名' });
  });

  it('DELETE :id forwards to voice.remove', async () => {
    const out = await controller.remove(USER, 'v1');
    expect(voice.remove).toHaveBeenCalledWith('u1', 'v1');
    expect(out).toEqual({ ok: true });
  });

  it('POST generate forwards samples to voice.generate', async () => {
    await controller.generate(USER, { samples: ['一段样本'] });
    expect(voice.generate).toHaveBeenCalledWith('u1', ['一段样本']);
  });
});
