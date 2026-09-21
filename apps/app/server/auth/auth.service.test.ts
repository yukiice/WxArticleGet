import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

function fixture() {
  let user: any = { id: 'user', username: 'member', role: 'member', sessionVersion: 0, passwordHash: hashPassword('old-password') };
  const tokens = new Map<string, unknown>();
  const auth = new AuthService({ user: {
    findUnique: async () => user,
    update: async ({ data }: any) => { user = { ...user, ...data, sessionVersion: user.sessionVersion + data.sessionVersion.increment }; },
    delete: async () => { user = null; },
  } } as never, {
    signAsync: async (payload: unknown) => { const token = String(tokens.size); tokens.set(token, payload); return token; },
    verifyAsync: async (token: string) => tokens.get(token),
  } as never, {} as never);
  return { auth, tokens };
}

describe('会话撤销', () => {
  it('删除用户后，原令牌不再通过认证', async () => {
    const { auth } = fixture();
    const { token } = await auth.login('member', 'old-password');
    expect(await auth.verify(token)).not.toBeNull();
    await auth.deleteUser('administrator', 'user');
    expect(await auth.verify(token)).toBeNull();
    await expect(auth.roleOf('user')).rejects.toThrow('账号已被删除');
  });

  it('改密码撤销旧会话，但新密码可建立新会话', async () => {
    const { auth } = fixture();
    const { token } = await auth.login('member', 'old-password');
    await auth.changePassword('user', 'old-password', 'new-password');
    expect(await auth.verify(token)).toBeNull();
    await expect(auth.login('member', 'old-password')).rejects.toThrow();
    const fresh = await auth.login('member', 'new-password');
    expect(await auth.verify(fresh.token)).toMatchObject({ sub: 'user', version: 1 });
  });

  it('不接受升级前没有会话版本的令牌', async () => {
    const { auth, tokens } = fixture();
    tokens.set('legacy', { sub: 'user', username: 'member' });
    expect(await auth.verify('legacy')).toBeNull();
  });
});
