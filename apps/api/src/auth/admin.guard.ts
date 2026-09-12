import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { USER_ROLE } from '@wx/shared';
import type { Request } from 'express';
import { AuthService, type SessionPayload } from './auth.service';

/** 仅管理员可访问（角色实时查库，避免 JWT 信息过期） */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user?: SessionPayload }).user;
    if (!user) throw new UnauthorizedException('未登录');

    const role = await this.auth.roleOf(user.sub);
    if (role !== USER_ROLE.super && role !== USER_ROLE.admin) {
      throw new ForbiddenException('仅管理员可执行此操作');
    }
    return true;
  }
}
