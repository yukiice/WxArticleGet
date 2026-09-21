import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@wx/db';
import { USER_ROLE, type UserDto } from '@wx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from './password';

export interface SessionPayload {
  sub: string;
  username: string;
  version: number;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureAdminUser();
  }

  private async ensureAdminUser(): Promise<void> {
    const username = this.config.get<string>('ADMIN_USERNAME') ?? 'admin';
    const password = this.config.get<string>('ADMIN_PASSWORD');

    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      if (existing.role !== USER_ROLE.super) {
        await this.prisma.user.update({ where: { id: existing.id }, data: { role: USER_ROLE.super } });
        this.logger.log(`已将账号「${username}」标记为总管理员`);
      }
      return;
    }
    if (!password) {
      this.logger.warn('未设置 ADMIN_PASSWORD，且不存在任何用户，登录将不可用');
      return;
    }

    await this.prisma.user.create({
      data: { username, passwordHash: hashPassword(password), role: USER_ROLE.super },
    });
    this.logger.log(`已初始化管理员账号：${username}`);
  }

  /** 读取当前账号角色（管理员判定以此为准，避免 JWT 里的旧信息过期） */
  async roleOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new UnauthorizedException('账号已被删除，请重新登录');
    return user.role;
  }

  async listUsers(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, username: true, role: true, createdAt: true },
    });
    const weight: Record<string, number> = { [USER_ROLE.super]: 0, [USER_ROLE.admin]: 1, [USER_ROLE.member]: 2 };
    return users
      .sort((a, b) => (weight[a.role] ?? 9) - (weight[b.role] ?? 9))
      .map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      }));
  }

  /** 管理员调整其他账号的角色（总管理员与自身账号不可修改） */
  async updateUserRole(actorId: string, targetId: string, role: string): Promise<UserDto> {
    const target = await this.ensureMutableUser(actorId, targetId);
    const user = await this.prisma.user.update({
      where: { id: target.id },
      data: { role: role === USER_ROLE.admin ? USER_ROLE.admin : USER_ROLE.member },
    });
    this.logger.log(`账号「${user.username}」角色已调整为 ${user.role}`);
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt.toISOString() };
  }

  /** 管理员删除其他账号（总管理员与自身账号不可删除） */
  async deleteUser(actorId: string, targetId: string): Promise<{ ok: boolean }> {
    const target = await this.ensureMutableUser(actorId, targetId);
    await this.prisma.user.delete({ where: { id: target.id } });
    this.logger.log(`账号「${target.username}」已删除`);
    return { ok: true };
  }

  private async ensureMutableUser(actorId: string, targetId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('账号不存在');
    if (target.id === actorId) throw new BadRequestException('不能修改或删除当前登录账号');
    if (target.role === USER_ROLE.super) throw new BadRequestException('总管理员账号不可修改或删除');
    return target;
  }

  /** 管理员添加内部账号，可指定「管理员 / 成员」角色 */
  async createUser(username: string, password: string, role: string): Promise<UserDto> {
    const normalizedRole = role === USER_ROLE.admin ? USER_ROLE.admin : USER_ROLE.member;
    try {
      const user = await this.prisma.user.create({
        data: { username, passwordHash: hashPassword(password), role: normalizedRole },
      });
      return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt.toISOString() };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('该用户名已被占用');
      }
      throw error;
    }
  }

  async login(username: string, password: string): Promise<{ token: string; username: string; role: string }> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const token = await this.jwt.signAsync({ sub: user.id, username: user.username, version: user.sessionVersion } satisfies SessionPayload, {
      expiresIn: '30d',
    });
    return { token, username: user.username, role: user.role };
  }

  async verify(token: string): Promise<SessionPayload | null> {
    let payload: SessionPayload;
    try {
      payload = await this.jwt.verifyAsync<SessionPayload>(token);
    } catch {
      return null;
    }
    if (!payload || typeof payload.sub !== 'string' || !Number.isInteger(payload.version)) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, sessionVersion: true },
    });
    if (!user || user.sessionVersion !== payload.version) return null;
    return { sub: user.id, username: user.username, version: user.sessionVersion };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('当前密码不正确');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword), sessionVersion: { increment: 1 } },
    });
    return { ok: true };
  }


}

