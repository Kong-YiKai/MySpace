import { describe, expect, it } from 'vitest';
import {
  buyShopItem,
  claimMaturePlant,
  createInitialGameState,
  equipWeapon,
  mergePlants,
  MYSTERY_SEED_ID,
  migrateLegacyGardenPlants,
  normalizeGameState,
  plantSeed,
  reconcileGardenPlants,
  resolveBattleReward,
  uprootGardenPlant,
  useCornCannon,
  waterGardenPlant,
} from './game-state.js';

describe('shared game state', () => {
  it('connects shop, garden, fusion and battle rewards in one state', () => {
    const now = 1_000_000;
    let state = createInitialGameState();
    state = buyShopItem(state, 'pea-shooter-seed');
    state = buyShopItem(state, 'pea-shooter-seed');
    state = buyShopItem(state, 'pea-shooter-seed');
    expect(state.sun).toBe(750);

    for (const plotId of ['plot-a', 'plot-b', 'plot-c']) {
      state = plantSeed(state, { plotId, speciesId: 'peaShooter', now });
      state = claimMaturePlant(state, { plotId, now: now + 45_000 });
    }
    expect(state.inventory.plants.peaShooter).toBe(4);

    state = mergePlants(state, 'pea-to-double');
    state = equipWeapon(state, 'doublePeaShooter');
    state = resolveBattleReward(state, { result: 'victory', reward: 120 });

    expect(state.inventory.plants.doublePeaShooter).toBe(1);
    expect(state.loadout.equippedWeaponId).toBe('doublePeaShooter');
    expect(state.sun).toBe(870);
    expect(state.battle).toMatchObject({ victories: 1, lastResult: 'victory', lastReward: 120 });
  });

  it('skips the redundant triple stage and merges double shooters directly into gatling', () => {
    let state = createInitialGameState();
    state.inventory.plants.doublePeaShooter = 3;
    state = mergePlants(state, 'double-to-gatling');
    expect(state.inventory.plants).toMatchObject({ doublePeaShooter: 0, gatlingPeaShooter: 1 });
    expect(state.inventory.plants).not.toHaveProperty('triplePeaShooter');
  });

  it('fuses exactly nine corn pults into one consumable corn cannon', () => {
    let state = createInitialGameState();
    state.inventory.plants.cornPult = 9;
    state.loadout.equippedWeaponId = 'cornPult';

    state = mergePlants(state, 'corn-to-cannon');

    expect(state.inventory.plants.cornPult).toBe(0);
    expect(state.inventory.consumables.cornCannon).toBe(1);
    expect(state.loadout.equippedWeaponId).toBeNull();
  });

  it('plants a rare watermelon result from a mystery seed without selling watermelon directly', () => {
    let state = createInitialGameState();
    state = buyShopItem(state, 'mystery-seed');
    expect(state.sun).toBe(920);
    expect(state.inventory.seeds[MYSTERY_SEED_ID]).toBe(1);
    state = plantSeed(state, {
      plotId: 'plot-e',
      speciesId: MYSTERY_SEED_ID,
      now: 20_000,
      // 固定到西瓜概率区间，令测试不会依赖随机数。
      randomValue: 0.95,
    });
    expect(state.garden.plots['plot-e']).toMatchObject({ speciesId: 'watermelonPult', sourceSeedId: MYSTERY_SEED_ID });
    state = claimMaturePlant(state, { plotId: 'plot-e', now: 65_000 });

    expect(state.inventory.plants.watermelonPult).toBe(1);
    expect(state.inventory.seeds[MYSTERY_SEED_ID]).toBe(0);
  });

  it('reports the remaining corn pults when a corn cannon fusion is short of materials', () => {
    const state = createInitialGameState();
    state.inventory.plants.cornPult = 8;

    expect(() => mergePlants(state, 'corn-to-cannon')).toThrow('还需要 1 个玉米投手');
  });

  it('consumes one corn cannon only when the battle can use it', () => {
    let state = createInitialGameState();
    state.inventory.consumables.cornCannon = 1;

    state = useCornCannon(state);

    expect(state.inventory.consumables.cornCannon).toBe(0);
    expect(() => useCornCannon(state)).toThrow('背包中没有玉米加农炮');
  });

  it('normalizes legacy saves that predate the corn cannon consumable', () => {
    const legacyState = createInitialGameState();
    delete legacyState.inventory.consumables;

    const state = normalizeGameState(legacyState);

    expect(state.inventory.consumables).toEqual({ cornCannon: 0 });
  });

  it('does not permit a claim before the plant reaches adulthood', () => {
    let state = createInitialGameState();
    state = buyShopItem(state, 'corn-pult-seed');
    state = plantSeed(state, { plotId: 'plot-a', speciesId: 'cornPult', now: 9_000 });
    expect(() => claimMaturePlant(state, { plotId: 'plot-a', now: 10_000 })).toThrow('植物尚未成熟');
  });

  it('uses the shared water can to advance a growing plant without bypassing maturation', () => {
    let state = createInitialGameState();
    state = buyShopItem(state, 'pea-shooter-seed');
    state = plantSeed(state, { plotId: 'plot-a', speciesId: 'peaShooter', now: 30_000 });
    state = waterGardenPlant(state, { plotId: 'plot-a', now: 31_000 });
    expect(state.garden.waterCharges).toBe(2);
    expect(state.garden.plots['plot-a'].plantedAt).toBe(15_000);
  });

  it('returns an immature plant to its matching seed packet when the shovel clears a plot', () => {
    let state = createInitialGameState();
    state = buyShopItem(state, 'corn-pult-seed');
    state = plantSeed(state, { plotId: 'plot-b', speciesId: 'cornPult', now: 40_000 });

    state = uprootGardenPlant(state, { plotId: 'plot-b', now: 40_100 });

    expect(state.garden.plots['plot-b']).toBeNull();
    expect(state.inventory.seeds.cornPult).toBe(1);
  });

  it('protects mature crops from the shovel so they can only be claimed as weapons', () => {
    let state = createInitialGameState();
    state = buyShopItem(state, 'pea-shooter-seed');
    state = plantSeed(state, { plotId: 'plot-c', speciesId: 'peaShooter', now: 50_000 });

    expect(() => uprootGardenPlant(state, { plotId: 'plot-c', now: 95_000 }))
      .toThrow('这株植物已经成熟，请改用白手套收获');
  });

  it('imports pre-existing garden plants only into a fresh shared save', () => {
    const state = migrateLegacyGardenPlants(createInitialGameState(), {
      plants: [{ id: 'old-plant-a', plotId: 'plot-a', speciesId: 'peaShooter', plantedAt: 100 }],
    });
    expect(state.garden.plots['plot-a']).toMatchObject({ id: 'old-plant-a', speciesId: 'peaShooter' });
    expect(() => migrateLegacyGardenPlants(state, { plants: [] })).toThrow('共享背包已有进度');
  });

  it('gives each new player one battle-ready pea shooter without pre-planting a garden crop', () => {
    const state = createInitialGameState();

    expect(state.inventory.plants.peaShooter).toBe(1);
    expect(Object.values(state.garden.plots).every((plot) => plot === null)).toBe(true);
  });

  it('backfills existing scene plants into empty shared plots without resetting other progress', () => {
    let state = createInitialGameState();
    state = resolveBattleReward(state, { result: 'victory', reward: 160 });

    state = reconcileGardenPlants(state, {
      plants: [
        { id: 'scene-pea-a', plotId: 'plot-a', speciesId: 'peaShooter', plantedAt: 1_000 },
        { id: 'scene-corn-f', plotId: 'plot-f', speciesId: 'cornPult', plantedAt: 2_000 },
      ],
    });

    expect(state.sun).toBe(1_360);
    expect(state.battle.victories).toBe(1);
    expect(state.garden.plots['plot-a']).toEqual({ id: 'scene-pea-a', speciesId: 'peaShooter', plantedAt: 1_000 });
    expect(state.garden.plots['plot-f']).toEqual({ id: 'scene-corn-f', speciesId: 'cornPult', plantedAt: 2_000 });
  });

  it('refuses to overwrite an occupied shared plot with a different scene plant', () => {
    let state = createInitialGameState();
    state = buyShopItem(state, 'pea-shooter-seed');
    state = plantSeed(state, { plotId: 'plot-a', speciesId: 'peaShooter', now: 7_000 });

    expect(() => reconcileGardenPlants(state, {
      plants: [{ id: 'scene-corn-a', plotId: 'plot-a', speciesId: 'cornPult', plantedAt: 7_000 }],
    })).toThrow('plot-a 的共享存档与空间花园不一致');
  });
});
