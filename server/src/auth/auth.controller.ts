import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService, type AuthUser } from './auth.service';
import { CurrentUser, type RequestUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(
    @Body() dto: RegisterDto,
  ): Promise<{ token: string; user: AuthUser }> {
    return this.auth.register(dto.email, dto.password, dto.username);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto): Promise<{ token: string; user: AuthUser }> {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.getUserById(user.id);
  }
}
