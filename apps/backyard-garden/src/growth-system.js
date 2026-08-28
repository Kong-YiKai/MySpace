export const GROWTH_STAGE = Object.freeze({
  SEED: 'seed',
  SPROUT: 'sprout',
  MATURE: 'mature',
  CLAIMED: 'claimed',
});

export const PLANT_SPECIES = Object.freeze({
  peaShooter: {
    label: '豌豆射手',
    matureWeaponId: 'peaShooter',
    color: '#86d75b',
  },
  cornPult: {
    label: '玉米投手',
    matureWeaponId: 'cornPult',
    color: '#ffd14f',
  },
  watermelonPult: {
    label: '西瓜投手',
    matureWeaponId: 'watermelonPult',
    color: '#8bd563',
  },
});

export const DEMO_GROWTH_DURATIONS_MS = Object.freeze({
  seed: 15_000,
  sprout: 30_000,
});

export function getGrowthVisualAssetIds(speciesId, stage) {
  if (stage === GROWTH_STAGE.SEED) return ['shared-seedling-v1'];
  if (stage === GROWTH_STAGE.SPROUT && speciesId === 'peaShooter') return ['shared-sprout-v1'];
  if (stage === GROWTH_STAGE.SPROUT && speciesId === 'cornPult') return ['corn-pult-sprout-v1'];
  if (stage === GROWTH_STAGE.SPROUT && speciesId === 'watermelonPult') return ['watermelon-pult-sprout-v1'];
  if (stage === GROWTH_STAGE.MATURE && speciesId === 'peaShooter') return ['pea-shooter-adult-v1'];
  if (stage === GROWTH_STAGE.MATURE && speciesId === 'cornPult') return ['corn-pult-adult-v1'];
  if (stage === GROWTH_STAGE.MATURE && speciesId === 'watermelonPult') return ['watermelon-pult-adult-v1'];
  return [];
}

export function getGrowthStage(growth, now = Date.now()) {
  if (growth.stage === GROWTH_STAGE.CLAIMED) return GROWTH_STAGE.CLAIMED;
  const elapsed = Math.max(0, now - growth.plantedAt);
  if (elapsed < growth.stageDurationsMs.seed) return GROWTH_STAGE.SEED;
  if (elapsed < growth.stageDurationsMs.seed + growth.stageDurationsMs.sprout) return GROWTH_STAGE.SPROUT;
  return GROWTH_STAGE.MATURE;
}

export function getGrowthProgress(growth, now = Date.now()) {
  const elapsed = Math.max(0, now - growth.plantedAt);
  const total = growth.stageDurationsMs.seed + growth.stageDurationsMs.sprout;
  return Math.min(1, elapsed / total);
}

export function getStageDescription(growth, now = Date.now()) {
  const stage = getGrowthStage(growth, now);
  if (stage === GROWTH_STAGE.SEED) return '初生期植株正在扎根';
  if (stage === GROWTH_STAGE.SPROUT) return '青春期植株正在舒展';
  if (stage === GROWTH_STAGE.MATURE) return '已成熟，可领取为武器';
  return '已领取到战斗装备库';
}

export function createPlantEntity({
  id,
  speciesId,
  plotId,
  position,
  plantedAt = Date.now(),
  stageDurationsMs = DEMO_GROWTH_DURATIONS_MS,
  sourceSeedId = null,
}) {
  const species = PLANT_SPECIES[speciesId];
  if (!species) throw new Error(`Unsupported plant species: ${speciesId}`);
  return {
    id,
    label: species.label,
    kind: 'garden-plant',
    parentId: plotId,
    transform: { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    assetRefs: getGrowthVisualAssetIds(speciesId, GROWTH_STAGE.SEED),
    tags: ['plant', speciesId, 'growable'],
    interactive: true,
    components: {
      semantic: { category: 'plant', role: 'garden-crop', abilities: ['inspect-growth', 'claim-weapon'] },
      growth: {
        speciesId,
        stage: GROWTH_STAGE.SEED,
        plantedAt,
        stageDurationsMs,
        matureWeaponId: species.matureWeaponId,
        readyToClaim: false,
        ...(sourceSeedId ? { sourceSeedId } : {}),
      },
    },
  };
}

export function getPendingGrowthCommands(manifest, now = Date.now()) {
  const commands = [];
  for (const entity of manifest.entities.filter((candidate) => candidate.kind === 'garden-plant')) {
    const growth = entity.components.growth;
    const nextStage = getGrowthStage(growth, now);
    const readyToClaim = nextStage === GROWTH_STAGE.MATURE;
    if (growth.stage !== nextStage || growth.readyToClaim !== readyToClaim) {
      commands.push({
        type: 'SET_COMPONENT',
        entityId: entity.id,
        component: 'growth',
        value: { ...growth, stage: nextStage, readyToClaim },
      });
      const nextAssetRefs = getGrowthVisualAssetIds(growth.speciesId, nextStage);
      const currentAssetRefs = entity.assetRefs ?? [];
      for (const assetRef of currentAssetRefs.filter((assetRef) => !nextAssetRefs.includes(assetRef))) {
        commands.push({ type: 'DETACH_ASSET', entityId: entity.id, assetRef });
      }
      for (const assetRef of nextAssetRefs.filter((assetRef) => !currentAssetRefs.includes(assetRef))) {
        commands.push({ type: 'ATTACH_ASSET', entityId: entity.id, assetRef });
      }
    }
  }
  return commands;
}

export function createPlantingCommands(manifest, {
  speciesId,
  plotId,
  now = Date.now(),
  // 场景与共享背包需要引用同一株植物。恢复已有进度时由共享存档提供 ID；
  // 新种植仍保留原来的默认命名，避免影响已有存档。
  plantId: requestedPlantId,
  sourceSeedId = null,
}) {
  const plot = manifest.entities.find((entity) => entity.id === plotId && entity.kind === 'spatial-anchor');
  if (!plot) throw new Error('请先选择一个有效花圃');
  if (plot.components.occupancy?.entityId) throw new Error(`${plot.label} 已经种有植物`);
  const plantId = typeof requestedPlantId === 'string' && requestedPlantId.trim()
    ? requestedPlantId
    : `plant-${speciesId}-${now}`;
  const [x, y, z] = plot.transform.position;
  const plant = createPlantEntity({
    id: plantId,
    speciesId,
    plotId,
    position: [x, y - 1.8, z],
    plantedAt: now,
    sourceSeedId,
  });
  return [
    { type: 'ADD_ENTITY', entity: plant },
    { type: 'SET_COMPONENT', entityId: plotId, component: 'occupancy', value: { entityId: plantId } },
  ];
}

export function createClaimCommands(manifest, plantId) {
  const plant = manifest.entities.find((entity) => entity.id === plantId && entity.kind === 'garden-plant');
  if (!plant) throw new Error('找不到这株植物');
  const growth = plant.components.growth;
  if (growth.stage !== GROWTH_STAGE.MATURE || !growth.readyToClaim) throw new Error('植物尚未成熟');
  const inventory = manifest.entities.find((entity) => entity.id === 'player-loadout');
  const existing = inventory.components.inventory.weapons;
  const nextWeapons = existing.includes(growth.matureWeaponId) ? existing : [...existing, growth.matureWeaponId];
  return [
    { type: 'SET_COMPONENT', entityId: plant.id, component: 'growth', value: { ...growth, stage: GROWTH_STAGE.CLAIMED, readyToClaim: false } },
    { type: 'SET_COMPONENT', entityId: plant.parentId, component: 'occupancy', value: { entityId: null } },
    { type: 'SET_COMPONENT', entityId: inventory.id, component: 'inventory', value: { weapons: nextWeapons } },
  ];
}

export function createUprootCommands(manifest, plantId) {
  const plant = manifest.entities.find((entity) => entity.id === plantId && entity.kind === 'garden-plant');
  if (!plant) throw new Error('找不到要清理的植物');
  const growth = plant.components.growth;
  if (growth.stage === GROWTH_STAGE.MATURE || growth.readyToClaim) throw new Error('这株植物已经成熟，请改用白手套收获');
  return [
    { type: 'REMOVE_ENTITY', entityId: plant.id },
    { type: 'SET_COMPONENT', entityId: plant.parentId, component: 'occupancy', value: { entityId: null } },
  ];
}
