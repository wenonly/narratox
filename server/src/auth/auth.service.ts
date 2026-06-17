import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const SALT_ROUNDS = 10;

export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET env var is required');
    }
  }

  async register(
    email: string,
    password: string,
    username?: string,
  ): Promise<AuthResult> {
    const normalized = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existing) throw new ConflictException('email already registered');

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email: normalized, passwordHash, username: username ?? null },
    });
    return this.issue(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const normalized = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (!user) throw new UnauthorizedException('invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    return this.issue(user);
  }

  async getUserById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new UnauthorizedException('user not found');
    return { id: user.id, email: user.email, username: user.username };
  }

  private async issue(user: {
    id: string;
    email: string;
    username: string | null;
  }): Promise<AuthResult> {
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return {
      token,
      user: { id: user.id, email: user.email, username: user.username },
    };
  }
}
