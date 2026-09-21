import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionPayload } from './auth.service';

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SessionPayload => {
  const request = context.switchToHttp().getRequest<Request & { user?: SessionPayload }>();
  if (!request.user?.sub) throw new UnauthorizedException('未登录');
  return request.user;
});
