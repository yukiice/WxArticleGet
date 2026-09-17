import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../apps/api/src/auth/auth.controller';

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
