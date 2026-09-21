import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../apps/app/server/auth/auth.controller';

describe('登录限流', () => {
  it('连续失败达到上限后拒绝，窗口过期后恢复', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.check('ip-a')).toBe(true);
      limiter.recordFailure('ip-a');
    }
    expect(limiter.check('ip-a')).toBe(false);

    // 时间推进超出窗口后应重新放行
    const originalNow = Date.now;
    Date.now = () => originalNow() + 6 * 60 * 1000;
    try {
      expect(limiter.check('ip-a')).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it('不同 IP 互不影响', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i += 1) {
      limiter.recordFailure('ip-a');
    }
    expect(limiter.check('ip-a')).toBe(false);
    expect(limiter.check('ip-b')).toBe(true);
  });

  it('大量不同 IP 失败后条目数有上限，不会无限增长', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 10_500; i += 1) {
      limiter.check(`ip-${i}`);
      limiter.recordFailure(`ip-${i}`);
    }
    // 私有字段仅用于断言，正常路径不依赖它
    expect((limiter as unknown as { attempts: Map<string, number[]> }).attempts.size).toBeLessThanOrEqual(10_000);
  });

  it('登录成功后清空该 IP 的计数', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 4; i += 1) {
      limiter.recordFailure('ip-a');
    }
    expect(limiter.check('ip-a')).toBe(true);
    limiter.reset('ip-a');
    expect(limiter.check('ip-a')).toBe(true);
    limiter.recordFailure('ip-a');
    expect(limiter.check('ip-a')).toBe(true);
  });
});
