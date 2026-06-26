import { Test } from '@nestjs/testing';
import { VoiceProfileController } from './voice-profile.controller';
import { VoiceProfileService } from './voice-profile.service';

const USER = { id: 'u1', email: 'a@b.com' } as never;

describe('VoiceProfileController', () => {
  let controller: VoiceProfileController;
  let voice: { get: jest.Mock; upsert: jest.Mock };

  beforeEach(async () => {
    voice = {
      get: jest.fn().mockResolvedValue('# 画像'),
      upsert: jest.fn().mockResolvedValue({ profile: '# 画像' }),
    };
    const module = await Test.createTestingModule({
      controllers: [VoiceProfileController],
      providers: [{ provide: VoiceProfileService, useValue: voice }],
    }).compile();
    controller = module.get(VoiceProfileController);
  });

  it('GET forwards to voice.get', async () => {
    await controller.get(USER);
    expect(voice.get).toHaveBeenCalledWith('u1');
  });

  it('PUT forwards profile to voice.upsert', async () => {
    await controller.upsert(USER, { profile: '# 新' });
    expect(voice.upsert).toHaveBeenCalledWith('u1', '# 新');
  });
});
