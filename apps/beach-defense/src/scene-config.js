export const BEACH_DEFENSE_CONFIG = Object.freeze({
  field: {
    width: 12,
    minZ: -9,
    // The playable beach is deliberately split into a 4 m player strip and a
    // 16 m approach strip: the intended 2:8 combat composition.
    maxZ: 11,
    defenseLineZ: -5,
    waterEndZ: 11,
  },
  player: {
    eyeHeight: 1.65,
    speed: 5.6,
    start: Object.freeze({ x: 0, z: -7 }),
    bounds: Object.freeze({ minX: -4.8, maxX: 4.8, minZ: -8.6, maxZ: -5.35 }),
  },
  enemy: {
    lanes: Object.freeze([-3, 0, 3]),
    spawnZ: 10.2,
    escapeZ: -5.15,
    speed: 0.72,
    maxHealth: 3,
  },
  projectile: {
    speed: 18,
    lifetime: 1.7,
    hitRadius: 0.84,
  },
});

export function clampPlayerPosition(position) {
  const { bounds } = BEACH_DEFENSE_CONFIG.player;
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, position.z)),
  };
}

export function isInsideEnemyZone(z) {
  const { defenseLineZ, waterEndZ } = BEACH_DEFENSE_CONFIG.field;
  return z > defenseLineZ && z < waterEndZ;
}

export function getCombatZoneDepths() {
  const { minZ, defenseLineZ, waterEndZ } = BEACH_DEFENSE_CONFIG.field;
  return {
    player: defenseLineZ - minZ,
    enemy: waterEndZ - defenseLineZ,
  };
}
