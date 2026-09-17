import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Request, Res, UseGuards } from '@nestjs/common';
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
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

/** 登录失败限流：按 IP 记录最近失败时间，窗口内超过上限则拒绝；成功登录后清空该 IP。 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  check(key: string): boolean {
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
    this.attempts.set(key, recent);
    return recent.length < RATE_LIMIT_MAX_ATTEMPTS;
  }

  recordFailure(key: string): void {
    const recent = this.attempts.get(key) ?? [];
    recent.push(Date.now());
    this.attempts.set(key, recent);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

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
  private readonly loginLimiter = new LoginRateLimiter();
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Request() request: { ip?: string },
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ username: string; role: string }> {
    // 登录是唯一公开入口，这里按 IP 做内存限流；生产多实例部署时需改为共享存储。
    const ip = request.ip ?? 'unknown';
    if (!this.loginLimiter.check(ip)) {
      throw new HttpException('登录尝试过于频繁，请稍后再试', 429);
    }
    const input = parseOrThrow(loginSchema, body);
    let result: { token: string; username: string; role: string };
    try {
      result = await this.auth.login(input.username, input.password);
    } catch (error) {
      this.loginLimiter.recordFailure(ip);
      throw error;
    }
    this.loginLimiter.reset(ip);


    response.cookie(AUTH_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps(this.config.get<string>('APP_BASE_URL')),
      maxAge: THIRTY_DAYS_MS,
      path: '/',
    });

    return { username: result.username, role: result.role };
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

