export const PLANT_STATS = Object.freeze({
  peaShooter: Object.freeze({
    tier: 1,
    damage: 18,
    projectileCount: 1,
    cooldownMs: 480,
    range: 34,
    spread: 0,
  }),
  doublePeaShooter: Object.freeze({
    tier: 2,
    damage: 17,
    projectileCount: 2,
    cooldownMs: 380,
    range: 36,
    spread: 0.038,
  }),
  gatlingPeaShooter: Object.freeze({
    tier: 3,
    damage: 15,
    projectileCount: 4,
    cooldownMs: 220,
    range: 38,
    spread: 0.096,
  }),
  watermelonPult: Object.freeze({
    tier: 2,
    // 直击比单发豌豆更高；范围内的其他敌人吃到较低但足够显著的溅射伤害。
    damage: 78,
    splashDamage: 56,
    splashRadius: 2.2,
    cooldownMs: 1_260,
    horizontalSpeed: 13.5,
    upwardSpeed: 6.5,
    gravity: 10,
    lifetime: 2.4,
  }),
});

export const ZOMBIE_STATS = Object.freeze({
  surferZombie: Object.freeze({
    label: '冲浪僵尸',
    hp: 90,
    speed: 1.2,
    defenseDamage: 1,
    targetHeight: 1.95,
    collisionRadius: 0.82,
    sunReward: 18,
  }),
  impZombie: Object.freeze({
    label: '冲浪小鬼',
    hp: 48,
    speed: 2.35,
    defenseDamage: 1,
    // 保留“小鬼”而非成人僵尸的视觉比例；GLB 归一化后强制缩到普通冲浪僵尸约 56%。
    targetHeight: 1.1,
    collisionRadius: 0.5,
    sunReward: 12,
  }),
  giantZombie: Object.freeze({
    label: '巨人僵尸',
    hp: 780,
    speed: 0.6,
    defenseDamage: 2,
    targetHeight: 3.35,
    collisionRadius: 1.35,
    sunReward: 2,
  }),
});

export const DEFENSE_RULES = Object.freeze({
  maxIntegrity: 6,
  spawnIntervalMs: 850,
  waveRestMs: 4_200,
});

export const TIDE_LEVELS = Object.freeze([
  Object.freeze({
    id: 'tide-01',
    name: '试潮沙滩',
    recommendedWeapon: 'peaShooter',
    waves: Object.freeze([
      Object.freeze(['surferZombie', 'surferZombie']),
      Object.freeze(['surferZombie', 'surferZombie', 'surferZombie']),
      Object.freeze(['surferZombie', 'impZombie', 'surferZombie']),
    ]),
    clearSunReward: 70,
  }),
  Object.freeze({
    id: 'tide-02',
    name: '浪花加速',
    recommendedWeapon: 'peaShooter',
    waves: Object.freeze([
      Object.freeze(['surferZombie', 'surferZombie', 'impZombie']),
      Object.freeze(['surferZombie', 'impZombie', 'surferZombie', 'impZombie']),
      Object.freeze(['surferZombie', 'surferZombie', 'surferZombie', 'impZombie', 'impZombie']),
      Object.freeze(['impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'surferZombie']),
    ]),
    clearSunReward: 110,
  }),
  Object.freeze({
    id: 'tide-03',
    name: '双发试炼',
    recommendedWeapon: 'doublePeaShooter',
    waves: Object.freeze([
      Object.freeze(['surferZombie', 'impZombie', 'surferZombie', 'impZombie']),
      Object.freeze(['surferZombie', 'surferZombie', 'impZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['surferZombie', 'surferZombie', 'surferZombie', 'impZombie', 'impZombie', 'impZombie']),
    ]),
    clearSunReward: 160,
  }),
  Object.freeze({
    id: 'tide-04',
    name: '巨浪警报',
    recommendedWeapon: 'doublePeaShooter',
    waves: Object.freeze([
      Object.freeze(['surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['surferZombie', 'surferZombie', 'impZombie', 'impZombie', 'surferZombie', 'impZombie']),
      Object.freeze(['giantZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
    ]),
    clearSunReward: 260,
  }),
  Object.freeze({
    id: 'tide-05',
    name: '潮汐合围',
    recommendedWeapon: 'gatlingPeaShooter',
    waves: Object.freeze([
      Object.freeze(['surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie']),
      Object.freeze(['giantZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['surferZombie', 'surferZombie', 'impZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['giantZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['impZombie', 'impZombie', 'surferZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie']),
    ]),
    clearSunReward: 380,
  }),
  Object.freeze({
    id: 'tide-06',
    name: '海滩守望者',
    recommendedWeapon: 'gatlingPeaShooter',
    waves: Object.freeze([
      Object.freeze(['surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['giantZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['surferZombie', 'surferZombie', 'impZombie', 'impZombie', 'giantZombie']),
      Object.freeze(['impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['giantZombie', 'giantZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
      Object.freeze(['giantZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie', 'impZombie', 'surferZombie']),
    ]),
    clearSunReward: 600,
  }),
]);
