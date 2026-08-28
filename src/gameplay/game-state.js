export const GAME_STATE_SCHEMA_VERSION = 'myspace.game-state.v1';

export const GAME_WEAPONS = Object.freeze({
  peaShooter: Object.freeze({ id: 'peaShooter', label: '豌豆射手', tier: 1 }),
  doublePeaShooter: Object.freeze({ id: 'doublePeaShooter', label: '双发射手', tier: 2 }),
  gatlingPeaShooter: Object.freeze({ id: 'gatlingPeaShooter', label: '机枪射手', tier: 3 }),
  cornPult: Object.freeze({ id: 'cornPult', label: '玉米投手', tier: 1 }),
  watermelonPult: Object.freeze({ id: 'watermelonPult', label: '西瓜投手', tier: 2 }),
});

// 西瓜是神秘种子的稀有结果，商店不会直接出售西瓜或西瓜种子。
export const GARDEN_CROP_IDS = Object.freeze(['peaShooter', 'cornPult', 'watermelonPult']);
export const MYSTERY_SEED_ID = 'mysterySeed';
export const MYSTERY_SEED_OUTCOMES = Object.freeze([
  Object.freeze({ speciesId: 'peaShooter', ceiling: 0.58 }),
  Object.freeze({ speciesId: 'cornPult', ceiling: 0.88 }),
  Object.freeze({ speciesId: 'watermelonPult', ceiling: 1 }),
]);

export const SHOP_ITEMS = Object.freeze({
  'pea-shooter-seed': Object.freeze({ id: 'pea-shooter-seed', label: '豌豆射手种子包', price: 150, target: ['seeds', 'peaShooter'] }),
  'corn-pult-seed': Object.freeze({ id: 'corn-pult-seed', label: '玉米投手种子包', price: 180, target: ['seeds', 'cornPult'] }),
  'mystery-seed': Object.freeze({ id: 'mystery-seed', label: '神秘种子', price: 280, target: ['seeds', MYSTERY_SEED_ID] }),
  'quick-grow-fertilizer': Object.freeze({ id: 'quick-grow-fertilizer', label: '速生肥', price: 60, target: ['fertilizer', 'quickGrow'] }),
  'harvest-fertilizer': Object.freeze({ id: 'harvest-fertilizer', label: '丰收肥', price: 90, target: ['fertilizer', 'harvest'] }),
});

export const FUSION_RECIPES = Object.freeze({
  'pea-to-double': Object.freeze({ id: 'pea-to-double', sourceId: 'peaShooter', sourceCount: 3, resultId: 'doublePeaShooter' }),
  'double-to-gatling': Object.freeze({ id: 'double-to-gatling', sourceId: 'doublePeaShooter', sourceCount: 3, resultId: 'gatlingPeaShooter' }),
  'corn-to-cannon': Object.freeze({
    id: 'corn-to-cannon',
    sourceId: 'cornPult',
    sourceCount: 9,
    resultId: 'cornCannon',
    resultGroup: 'consumables',
  }),
});

export const GAME_PLOTS = Object.freeze(['plot-a', 'plot-b', 'plot-c', 'plot-d', 'plot-e', 'plot-f']);
export const GARDEN_GROWTH_DURATIONS_MS = Object.freeze({ seed: 15_000, sprout: 30_000 });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function blankPlots() {
  return Object.fromEntries(GAME_PLOTS.map((plotId) => [plotId, null]));
}

export function createInitialGameState() {
  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    revision: 0,
    sun: 1200,
    inventory: {
      seeds: { peaShooter: 0, cornPult: 0, [MYSTERY_SEED_ID]: 0 },
      fertilizer: { quickGrow: 0, harvest: 0 },
      plants: {
        // 新玩家可立即进入第一场战斗；这是一件背包武器，不对应花园里的已种作物。
        peaShooter: 1,
        doublePeaShooter: 0,
        gatlingPeaShooter: 0,
        cornPult: 0,
        watermelonPult: 0,
      },
      consumables: { cornCannon: 0 },
    },
    garden: { plots: blankPlots(), waterCharges: 3 },
    loadout: { equippedWeaponId: null },
    battle: { victories: 0, defeats: 0, lastResult: 'none', lastReward: 0 },
  };
}

export function normalizeGameState(value) {
  const initial = createInitialGameState();
  if (!value || value.schemaVersion !== GAME_STATE_SCHEMA_VERSION) return initial;
  const next = clone(initial);
  next.revision = Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  next.sun = Number.isFinite(value.sun) && value.sun >= 0 ? Math.floor(value.sun) : initial.sun;
  for (const group of ['seeds', 'fertilizer', 'plants', 'consumables']) {
    for (const key of Object.keys(initial.inventory[group])) {
      const candidate = value.inventory?.[group]?.[key];
      next.inventory[group][key] = Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
    }
  }
  for (const plotId of GAME_PLOTS) {
    const plant = value.garden?.plots?.[plotId];
    if (plant && GARDEN_CROP_IDS.includes(plant.speciesId) && Number.isFinite(plant.plantedAt)) {
      next.garden.plots[plotId] = {
        id: typeof plant.id === 'string' ? plant.id : `plant-${plant.speciesId}-${plotId}-${plant.plantedAt}`,
        speciesId: plant.speciesId,
        plantedAt: plant.plantedAt,
        ...(plant.sourceSeedId === MYSTERY_SEED_ID ? { sourceSeedId: MYSTERY_SEED_ID } : {}),
      };
    }
  }
  next.garden.waterCharges = Number.isInteger(value.garden?.waterCharges) && value.garden.waterCharges >= 0
    ? value.garden.waterCharges
    : initial.garden.waterCharges;
  const equipped = value.loadout?.equippedWeaponId;
  next.loadout.equippedWeaponId = GAME_WEAPONS[equipped] && next.inventory.plants[equipped] > 0 ? equipped : null;
  for (const key of ['victories', 'defeats', 'lastReward']) {
    const candidate = value.battle?.[key];
    next.battle[key] = Number.isInteger(candidate) && candidate >= 0 ? candidate : 0;
  }
  next.battle.lastResult = ['none', 'victory', 'defeat'].includes(value.battle?.lastResult) ? value.battle.lastResult : 'none';
  return next;
}

export function getGardenGrowthStage(plant, now = Date.now()) {
  if (!plant) return null;
  const elapsed = Math.max(0, now - plant.plantedAt);
  if (elapsed < GARDEN_GROWTH_DURATIONS_MS.seed) return 'seed';
  if (elapsed < GARDEN_GROWTH_DURATIONS_MS.seed + GARDEN_GROWTH_DURATIONS_MS.sprout) return 'sprout';
  return 'mature';
}

function commit(state, mutate) {
  const next = normalizeGameState(state);
  mutate(next);
  next.revision += 1;
  return next;
}

export function buyShopItem(state, itemId) {
  const item = SHOP_ITEMS[itemId];
  assert(item, '商店中不存在这个物品');
  return commit(state, (next) => {
    assert(next.sun >= item.price, `阳光不足，还需要 ${item.price - next.sun} 阳光`);
    next.sun -= item.price;
    const [group, key] = item.target;
    next.inventory[group][key] += 1;
  });
}

function resolveMysterySeedOutcome(randomValue = Math.random()) {
  const roll = Number.isFinite(randomValue) ? Math.min(0.999999, Math.max(0, randomValue)) : Math.random();
  return MYSTERY_SEED_OUTCOMES.find((outcome) => roll < outcome.ceiling)?.speciesId ?? 'watermelonPult';
}

export function plantSeed(state, {
  plotId,
  speciesId,
  now = Date.now(),
  plantId: requestedPlantId,
  randomValue,
}) {
  assert(GAME_PLOTS.includes(plotId), '请先选择一个有效花圃');
  assert(['peaShooter', 'cornPult', MYSTERY_SEED_ID].includes(speciesId), '这个种子暂时不能种进后花园');
  return commit(state, (next) => {
    assert(!next.garden.plots[plotId], '这个花圃已经种有植物');
    const seedLabel = speciesId === MYSTERY_SEED_ID ? '神秘种子' : `${GAME_WEAPONS[speciesId].label}种子`;
    assert(next.inventory.seeds[speciesId] > 0, `背包中没有${seedLabel}`);
    next.inventory.seeds[speciesId] -= 1;
    const resolvedSpeciesId = speciesId === MYSTERY_SEED_ID
      ? resolveMysterySeedOutcome(randomValue)
      : speciesId;
    const plantId = typeof requestedPlantId === 'string' && requestedPlantId.trim()
      ? requestedPlantId
      : `plant-${resolvedSpeciesId}-${plotId}-${now}`;
    next.garden.plots[plotId] = {
      id: plantId,
      speciesId: resolvedSpeciesId,
      plantedAt: now,
      ...(speciesId === MYSTERY_SEED_ID ? { sourceSeedId: MYSTERY_SEED_ID } : {}),
    };
  });
}

export function migrateLegacyGardenPlants(state, { plants }) {
  assert(Array.isArray(plants), '旧花园迁移数据无效');
  return commit(state, (next) => {
    const totalItems = Object.values(next.inventory.seeds).reduce((sum, value) => sum + value, 0)
      + Object.values(next.inventory.fertilizer).reduce((sum, value) => sum + value, 0)
      + Object.values(next.inventory.plants).reduce((sum, value) => sum + value, 0)
      + Object.values(next.inventory.consumables).reduce((sum, value) => sum + value, 0);
    // 初始豌豆射手是新手战斗装备，不代表玩家已经产生过花园进度；旧场景迁移仍可安全执行。
    const hasOnlyStarterWeapon = totalItems === 1 && next.inventory.plants.peaShooter === 1;
    assert(next.revision === 0 && (totalItems === 0 || hasOnlyStarterWeapon) && GAME_PLOTS.every((plotId) => !next.garden.plots[plotId]), '共享背包已有进度，不能覆盖式迁移旧花园');
    for (const plant of plants) {
      assert(GAME_PLOTS.includes(plant?.plotId), '旧花园存在未知花圃');
      assert(GARDEN_CROP_IDS.includes(plant?.speciesId), '旧花园存在无法迁移的植物');
      assert(Number.isFinite(plant?.plantedAt), '旧花园缺少种植时间');
      assert(!next.garden.plots[plant.plotId], '旧花园有重复花圃记录');
      next.garden.plots[plant.plotId] = {
        id: typeof plant.id === 'string' ? plant.id : `plant-${plant.speciesId}-${plant.plotId}-${plant.plantedAt}`,
        speciesId: plant.speciesId,
        plantedAt: plant.plantedAt,
        ...(plant.sourceSeedId === MYSTERY_SEED_ID ? { sourceSeedId: MYSTERY_SEED_ID } : {}),
      };
    }
  });
}

// 早期花园原型先把植物保存在空间场景里，后来才接入共享背包。
// 这里的对账只会把“共享存档中为空、但场景中实际存在”的花圃补齐；绝不删除
// 共享存档的植物，也绝不在物种/种植时间冲突时覆盖，避免修复时吞掉玩家进度。
export function reconcileGardenPlants(state, { plants }) {
  assert(Array.isArray(plants), '花园对账数据无效');
  const incomingByPlot = new Map();
  for (const plant of plants) {
    assert(GAME_PLOTS.includes(plant?.plotId), '花园对账包含未知花圃');
    assert(GARDEN_CROP_IDS.includes(plant?.speciesId), '花园对账包含未知植物');
    assert(Number.isFinite(plant?.plantedAt), '花园对账缺少种植时间');
    assert(!incomingByPlot.has(plant.plotId), '花园对账出现重复花圃');
    incomingByPlot.set(plant.plotId, {
      id: typeof plant.id === 'string' && plant.id.trim()
        ? plant.id
        : `plant-${plant.speciesId}-${plant.plotId}-${plant.plantedAt}`,
      speciesId: plant.speciesId,
      plantedAt: plant.plantedAt,
      ...(plant.sourceSeedId === MYSTERY_SEED_ID ? { sourceSeedId: MYSTERY_SEED_ID } : {}),
    });
  }

  const normalized = normalizeGameState(state);
  const additions = [];
  for (const [plotId, incoming] of incomingByPlot) {
    const existing = normalized.garden.plots[plotId];
    if (!existing) {
      additions.push([plotId, incoming]);
      continue;
    }
    assert(
      existing.speciesId === incoming.speciesId && existing.plantedAt === incoming.plantedAt,
      `${plotId} 的共享存档与空间花园不一致，已停止自动覆盖`,
    );
  }
  if (!additions.length) return normalized;

  return commit(normalized, (next) => {
    for (const [plotId, plant] of additions) next.garden.plots[plotId] = plant;
  });
}

export function claimMaturePlant(state, { plotId, now = Date.now() }) {
  assert(GAME_PLOTS.includes(plotId), '找不到这个花圃');
  return commit(state, (next) => {
    const plant = next.garden.plots[plotId];
    assert(plant, '这个花圃没有可收取的植物');
    assert(getGardenGrowthStage(plant, now) === 'mature', '植物尚未成熟');
    next.inventory.plants[plant.speciesId] += 1;
    next.garden.plots[plotId] = null;
  });
}

export function waterGardenPlant(state, { plotId, now = Date.now() }) {
  assert(GAME_PLOTS.includes(plotId), '找不到这个花圃');
  return commit(state, (next) => {
    const plant = next.garden.plots[plotId];
    assert(plant, '这个花圃没有需要浇水的植物');
    assert(getGardenGrowthStage(plant, now) !== 'mature', '这株植物已经成熟，可以直接收获');
    assert(next.garden.waterCharges > 0, '水壶暂时没有可用水量，请完成一场战斗后再补水');
    next.garden.waterCharges -= 1;
    // 一次浇水推进一个演示生长阶段，成熟仍由种植时间统一判定。
    plant.plantedAt -= GARDEN_GROWTH_DURATIONS_MS.seed;
  });
}

// 铁铲只清理尚未成年的作物，并返还原种子。这样手持工具有真实业务作用，
// 又不会让误点铁铲把已经成熟、可领取的武器直接销毁。
export function uprootGardenPlant(state, { plotId, now = Date.now() }) {
  assert(GAME_PLOTS.includes(plotId), '找不到这个花圃');
  return commit(state, (next) => {
    const plant = next.garden.plots[plotId];
    assert(plant, '这个花圃没有可清理的植物');
    assert(getGardenGrowthStage(plant, now) !== 'mature', '这株植物已经成熟，请改用白手套收获');
    const returnedSeedId = plant.sourceSeedId
      ?? (plant.speciesId === 'watermelonPult' ? MYSTERY_SEED_ID : plant.speciesId);
    next.inventory.seeds[returnedSeedId] += 1;
    next.garden.plots[plotId] = null;
  });
}

export function mergePlants(state, recipeId) {
  const recipe = FUSION_RECIPES[recipeId];
  assert(recipe, '找不到这个合成配方');
  return commit(state, (next) => {
    const sourceGroup = recipe.sourceGroup ?? 'plants';
    const resultGroup = recipe.resultGroup ?? 'plants';
    const sourceCount = recipe.sourceCount ?? 3;
    const sourceInventory = next.inventory[sourceGroup];
    const resultInventory = next.inventory[resultGroup];
    assert(sourceInventory && resultInventory, '合成配方的库存类型无效');
    assert(Number.isInteger(sourceCount) && sourceCount > 0, '合成配方的材料数量无效');
    assert(Object.hasOwn(sourceInventory, recipe.sourceId), '合成配方的材料无效');
    assert(Object.hasOwn(resultInventory, recipe.resultId), '合成配方的产物无效');

    const sourceLabel = GAME_WEAPONS[recipe.sourceId]?.label ?? recipe.sourceId;
    const missingCount = Math.max(0, sourceCount - sourceInventory[recipe.sourceId]);
    assert(missingCount === 0, `还需要 ${missingCount} 个${sourceLabel}`);
    sourceInventory[recipe.sourceId] -= sourceCount;
    resultInventory[recipe.resultId] += 1;
    if (sourceGroup === 'plants'
      && next.loadout.equippedWeaponId === recipe.sourceId
      && sourceInventory[recipe.sourceId] === 0) {
      next.loadout.equippedWeaponId = resultGroup === 'plants' ? recipe.resultId : null;
    }
  });
}

export function useCornCannon(state) {
  return commit(state, (next) => {
    assert(next.inventory.consumables.cornCannon > 0, '背包中没有玉米加农炮');
    next.inventory.consumables.cornCannon -= 1;
  });
}

export function equipWeapon(state, weaponId) {
  assert(GAME_WEAPONS[weaponId], '找不到这个植物武器');
  return commit(state, (next) => {
    assert(next.inventory.plants[weaponId] > 0, '背包中尚未拥有这个植物武器');
    next.loadout.equippedWeaponId = weaponId;
  });
}

export function resolveBattleReward(state, { result, reward = 0 }) {
  assert(['victory', 'defeat'].includes(result), '战斗结算结果无效');
  assert(Number.isInteger(reward) && reward >= 0, '战斗奖励无效');
  return commit(state, (next) => {
    if (result === 'victory') {
      next.sun += reward;
      next.battle.victories += 1;
      next.garden.waterCharges = Math.min(3, next.garden.waterCharges + 1);
    } else {
      next.battle.defeats += 1;
    }
    next.battle.lastResult = result;
    next.battle.lastReward = result === 'victory' ? reward : 0;
  });
}

export function executeGameCommand(state, command) {
  assert(command && typeof command.type === 'string', '游戏命令无效');
  const payload = command.payload ?? {};
  switch (command.type) {
    case 'buyShopItem': return buyShopItem(state, payload.itemId);
    case 'plantSeed': return plantSeed(state, payload);
    case 'migrateLegacyGardenPlants': return migrateLegacyGardenPlants(state, payload);
    case 'reconcileGardenPlants': return reconcileGardenPlants(state, payload);
    case 'claimMaturePlant': return claimMaturePlant(state, payload);
    case 'waterGardenPlant': return waterGardenPlant(state, payload);
    case 'uprootGardenPlant': return uprootGardenPlant(state, payload);
    case 'mergePlants': return mergePlants(state, payload.recipeId);
    case 'useCornCannon': return useCornCannon(state);
    case 'equipWeapon': return equipWeapon(state, payload.weaponId);
    case 'resolveBattleReward': return resolveBattleReward(state, payload);
    default: throw new Error('不支持的游戏命令');
  }
}
