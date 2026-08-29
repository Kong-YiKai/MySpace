import { describe, expect, it } from 'vitest';
import { estimateLobRange, getLobChargeProgress, getLobShotProfile } from './lob-charge.js';

describe('投手蓄力', () => {
  const attack = {
    horizontalSpeed: 14.4,
    minimumHorizontalSpeed: 5.2,
    upwardSpeed: 6.9,
    minimumUpwardSpeed: 2.6,
    damage: 52,
    splashDamage: 52,
    gravity: 10.4,
    minimumDamageMultiplier: 0.58,
    maximumDamageMultiplier: 1.55,
  };

  it('将按住时间限定在 0 到 100% 的蓄力范围内', () => {
    expect(getLobChargeProgress({ startedAt: 1_000, now: 900, durationMs: 1_000 })).toBe(0);
    expect(getLobChargeProgress({ startedAt: 1_000, now: 1_500, durationMs: 1_000 })).toBe(0.5);
    expect(getLobChargeProgress({ startedAt: 1_000, now: 2_400, durationMs: 1_000 })).toBe(1);
  });

  it('使短按近投、满蓄力远投，并同时提高伤害', () => {
    const close = getLobShotProfile(attack, 0);
    const far = getLobShotProfile(attack, 1);
    expect(close.horizontalSpeed).toBe(5.2);
    expect(close.upwardSpeed).toBe(2.6);
    expect(close.damage).toBe(30);
    expect(far.horizontalSpeed).toBe(14.4);
    expect(far.upwardSpeed).toBe(6.9);
    expect(far.damage).toBe(81);
    expect(estimateLobRange({ ...far, startHeight: 1.4 })).toBeGreaterThan(estimateLobRange({ ...close, startHeight: 1.4 }));
  });
});
