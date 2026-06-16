import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
  };

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
  });

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('signed-token') } },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('register', () => {
    it('hashes the password, stores a real hash, lowercases email, issues a token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(
        async ({ data }: { data: { email: string; passwordHash: string; username: string | null } }) => ({
          id: 'u1', email: data.email, username: data.username,
        }),
      );

      const res = await service.register('A@B.com', 'password123', 'al');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
      const created = (prisma.user.create as jest.Mock).mock.calls[0][0].data;
      expect(created.email).toBe('a@b.com');
      expect(created.passwordHash).not.toBe('password123');
      expect(await bcrypt.compare('password123', created.passwordHash)).toBe(true);
      expect(res).toEqual({ token: 'signed-token', user: { id: 'u1', email: 'a@b.com', username: 'al' } });
    });

    it('throws ConflictException when the email is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(service.register('a@b.com', 'password123')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues a token when the password matches', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', username: 'al', passwordHash: hash });
      const res = await service.login('a@b.com', 'password123');
      expect(res).toEqual({ token: 'signed-token', user: { id: 'u1', email: 'a@b.com', username: 'al' } });
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('a@b.com', 'password123')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when the password is wrong', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', username: null, passwordHash: hash });
      await expect(service.login('a@b.com', 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
