import { describe, expect, it } from 'vitest';
import { PLANT_STATS } from './battle-balance.js';

describe('watermelon pult battle balance', () => {
  it('is a slower lobbed weapon with a real splash radius', () => {
    const watermelon = PLANT_STATS.watermelonPult;

    expect(watermelon.splashRadius).toBeGreaterThan(2);
    expect(watermelon.splashDamage).toBeGreaterThan(0);
    expect(watermelon.cooldownMs).toBeGreaterThan(PLANT_STATS.peaShooter.cooldownMs);
    expect(watermelon.damage).toBeGreaterThan(PLANT_STATS.peaShooter.damage);
  });
});
