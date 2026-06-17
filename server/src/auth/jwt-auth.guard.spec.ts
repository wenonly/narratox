import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwt: { verifyAsync: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    jwt = { verifyAsync: jest.fn() };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const module = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwt },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();
    guard = module.get(JwtAuthGuard);
  });

  type FakeReq = {
    headers: { authorization?: string };
    user?: { id: string; email: string };
  };

  const ctxWith = (authorization?: string): ExecutionContext => {
    const req: FakeReq = { headers: authorization ? { authorization } : {} };
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  };

  it('passes and sets req.user for a valid Bearer token', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', email: 'a@b.com' });
    const c = ctxWith('Bearer good-token');
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(
      c.switchToHttp().getRequest<{ user?: { id: string; email: string } }>()
        .user,
    ).toEqual({
      id: 'u1',
      email: 'a@b.com',
    });
  });

  it('throws 401 when there is no Authorization header', async () => {
    await expect(guard.canActivate(ctxWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws 401 when the token fails to verify', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt malformed'));
    await expect(
      guard.canActivate(ctxWith('Bearer bad')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when the scheme is not Bearer', async () => {
    await expect(
      guard.canActivate(ctxWith('Token xyz')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('skips auth for @Public handlers without touching JwtService', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctxWith())).resolves.toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });
});
