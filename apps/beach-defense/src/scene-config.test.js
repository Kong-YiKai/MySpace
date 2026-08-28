import { describe, expect, it } from 'vitest';
import {
  BEACH_DEFENSE_CONFIG,
  clampPlayerPosition,
  getCombatZoneDepths,
  isInsideEnemyZone,
} from './scene-config.js';

describe('beach defense scene limits', () => {
  it('keeps the player inside the two-unit defense strip', () => {
    expect(clampPlayerPosition({ x: 99, z: 99 })).toEqual({
      x: BEACH_DEFENSE_CONFIG.player.bounds.maxX,
      z: BEACH_DEFENSE_CONFIG.player.bounds.maxZ,
    });
    expect(clampPlayerPosition({ x: -99, z: -99 })).toEqual({
      x: BEACH_DEFENSE_CONFIG.player.bounds.minX,
      z: BEACH_DEFENSE_CONFIG.player.bounds.minZ,
    });
  });

  it('keeps the enemy approach separate from the player strip', () => {
    expect(isInsideEnemyZone(BEACH_DEFENSE_CONFIG.field.defenseLineZ)).toBe(false);
    expect(isInsideEnemyZone(0)).toBe(true);
    expect(isInsideEnemyZone(BEACH_DEFENSE_CONFIG.field.waterEndZ)).toBe(false);
  });

  it('uses the intended 2:8 player-to-enemy depth ratio', () => {
    const depths = getCombatZoneDepths();

    expect(depths).toEqual({ player: 4, enemy: 16 });
    expect(depths.enemy / depths.player).toBe(4);
  });
});
