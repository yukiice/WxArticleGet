import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  updateUserSchema,
  type UserDto,
} from '@wx/shared';
import type { Response } from 'express';
import { parseOrThrow } from '../common/zod';
import { AdminGuard } from './admin.guard';
import { AuthService, type SessionPayload } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AUTH_COOKIE } from './jwt-auth.guard';
import { Public } from './public.decorator';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Cookie 是否加 Secure：由对外地址是否 HTTPS 决定，不依赖 NODE_ENV。 */
function isHttps(baseUrl: string | undefined): boolean {
  try {
    return new URL(baseUrl ?? '').protocol === 'https:';
  } catch {
    return false;
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ username: string; role: string }> {
    const input = parseOrThrow(loginSchema, body);
    const { token, username, role } = await this.auth.login(input.username, input.password);

    response.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps(this.config.get<string>('APP_BASE_URL')),
      maxAge: THIRTY_DAYS_MS,
      path: '/',
    });

    return { username, role };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response): { ok: boolean } {
    response.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: SessionPayload): Promise<{ sub: string; username: string; role: string }> {
    return { sub: user.sub, username: user.username, role: await this.auth.roleOf(user.sub) };
  }

  @Get('users')
  @UseGuards(AdminGuard)
  listUsers(): Promise<UserDto[]> {
    return this.auth.listUsers();
  }

  @Post('users')
  @UseGuards(AdminGuard)
  createUser(@Body() body: unknown): Promise<UserDto> {
    const input = parseOrThrow(createUserSchema, body);
    return this.auth.createUser(input.username, input.password, input.role);
  }

  @Patch('users/:id')
  @UseGuards(AdminGuard)
  updateUser(
    @CurrentUser() user: SessionPayload,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<UserDto> {
    const input = parseOrThrow(updateUserSchema, body);
    return this.auth.updateUserRole(user.sub, id, input.role);
  }

  @Delete('users/:id')
  @UseGuards(AdminGuard)
  deleteUser(@CurrentUser() user: SessionPayload, @Param('id') id: string): Promise<{ ok: boolean }> {
    return this.auth.deleteUser(user.sub, id);
  }

  @Post('password')
  changePassword(@CurrentUser() user: SessionPayload, @Body() body: unknown) {
    const input = parseOrThrow(changePasswordSchema, body);
    return this.auth.changePassword(user.sub, input.currentPassword, input.newPassword);
  }
}

