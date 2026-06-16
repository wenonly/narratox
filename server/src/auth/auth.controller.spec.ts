import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { RequestUser } from './current-user.decorator';

describe('AuthController', () => {
  let controller: AuthController;
  let auth: { register: jest.Mock; login: jest.Mock };

  beforeEach(async () => {
    auth = {
      register: jest.fn().mockResolvedValue({
        token: 't',
        user: { id: 'u1', email: 'a@b.com', username: null },
      }),
      login: jest.fn().mockResolvedValue({
        token: 't',
        user: { id: 'u1', email: 'a@b.com', username: null },
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('register forwards email/password/username to AuthService', async () => {
    const res = await controller.register({ email: 'A@B.com', password: 'password123', username: 'al' });
    expect(auth.register).toHaveBeenCalledWith('A@B.com', 'password123', 'al');
    expect(res).toEqual({ token: 't', user: { id: 'u1', email: 'a@b.com', username: null } });
  });

  it('login forwards email/password to AuthService', async () => {
    await controller.login({ email: 'a@b.com', password: 'password123' });
    expect(auth.login).toHaveBeenCalledWith('a@b.com', 'password123');
  });

  it('me returns the request user unchanged', () => {
    const user: RequestUser = { id: 'u1', email: 'a@b.com' };
    expect(controller.me(user)).toEqual(user);
  });
});
