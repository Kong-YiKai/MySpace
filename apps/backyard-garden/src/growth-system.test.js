import { describe, expect, it } from 'vitest';
import { createBackyardManifest, DAVE_DEFAULT_ANCHOR, getPlotPlantYaw, PLOT_INTERACTION_FOOTPRINT } from './backyard.scene.js';
import {
  DEMO_GROWTH_DURATIONS_MS,
  GROWTH_STAGE,
  createClaimCommands,
  createPlantingCommands,
  createUprootCommands,
  getGrowthVisualAssetIds,
  getGrowthStage,
  getPendingGrowthCommands,
} from './growth-system.js';

describe('后花园三阶段种植系统', () => {
  it('将正式花圃锚点烘焙为不重叠的米级交互范围', () => {
    const plots = createBackyardManifest().entities.filter((entity) => entity.kind === 'spatial-anchor');
    expect(PLOT_INTERACTION_FOOTPRINT).toEqual({ width: 1.25, depth: 1.25 });

    for (let leftIndex = 0; leftIndex < plots.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < plots.length; rightIndex += 1) {
        const [leftX, , leftZ] = plots[leftIndex].transform.position;
        const [rightX, , rightZ] = plots[rightIndex].transform.position;
        const overlaps = Math.abs(leftX - rightX) < PLOT_INTERACTION_FOOTPRINT.width
          && Math.abs(leftZ - rightZ) < PLOT_INTERACTION_FOOTPRINT.depth;
        expect(overlaps, `${plots[leftIndex].id} 与 ${plots[rightIndex].id} 的点击范围不能重叠`).toBe(false);
      }
    }
  });

  it('为新玩家提供温室地面上的正式戴夫锚点，不回退到旧 PLY 坐标', () => {
    const manifest = createBackyardManifest();
    const dave = manifest.entities.find((entity) => entity.id === 'crazy-dave-guide');
    expect(dave.transform.position).toEqual(DAVE_DEFAULT_ANCHOR);
    expect(DAVE_DEFAULT_ANCHOR).not.toEqual([-42, -12, 20]);
    expect(DAVE_DEFAULT_ANCHOR[1]).toBeGreaterThan(1);
    expect(DAVE_DEFAULT_ANCHOR[1]).toBeLessThan(2);
  });

  it('按种子、幼苗、成熟三个阶段推进', () => {
    const plantedAt = 1_000;
    const growth = { stage: GROWTH_STAGE.SEED, plantedAt, stageDurationsMs: DEMO_GROWTH_DURATIONS_MS };
    expect(getGrowthStage(growth, plantedAt + 14_999)).toBe(GROWTH_STAGE.SEED);
    expect(getGrowthStage(growth, plantedAt + 15_000)).toBe(GROWTH_STAGE.SPROUT);
    expect(getGrowthStage(growth, plantedAt + 45_000)).toBe(GROWTH_STAGE.MATURE);
  });

  it('只允许在空花圃种植，并把占用状态写入同一事务', () => {
    const manifest = createBackyardManifest();
    const commands = createPlantingCommands(manifest, { speciesId: 'peaShooter', plotId: 'plot-a', now: 2_000 });
    expect(commands).toHaveLength(2);
    expect(commands[0].entity.parentId).toBe('plot-a');
    expect(commands[1]).toEqual({ type: 'SET_COMPONENT', entityId: 'plot-a', component: 'occupancy', value: { entityId: 'plant-peaShooter-2000' } });
    expect(commands[0].entity.assetRefs).toEqual(['shared-seedling-v1']);
  });

  it('恢复共享存档时保留共享植物 ID，避免两套花园状态再次错位', () => {
    const manifest = createBackyardManifest();
    const [addPlant, occupyPlot] = createPlantingCommands(manifest, {
      speciesId: 'peaShooter',
      plotId: 'plot-d',
      now: 2_000,
      plantId: 'plant-peaShooter-plot-d-2000',
    });

    expect(addPlant.entity.id).toBe('plant-peaShooter-plot-d-2000');
    expect(occupyPlot.value.entityId).toBe('plant-peaShooter-plot-d-2000');
  });

  it('保留神秘种子的来源，让青年期视觉巡检只监控真正的神秘植株', () => {
    const manifest = createBackyardManifest();
    const [addPlant] = createPlantingCommands(manifest, {
      speciesId: 'watermelonPult',
      plotId: 'plot-e',
      now: 2_000,
      sourceSeedId: 'mysterySeed',
    });

    expect(addPlant.entity.components.growth.sourceSeedId).toBe('mysterySeed');
  });

  it('按物种和阶段替换视觉资产，不再让共享幼苗冒充玉米或西瓜', () => {
    expect(getGrowthVisualAssetIds('peaShooter', GROWTH_STAGE.SEED)).toEqual(['shared-seedling-v1']);
    expect(getGrowthVisualAssetIds('peaShooter', GROWTH_STAGE.SPROUT)).toEqual(['shared-sprout-v1']);
    expect(getGrowthVisualAssetIds('cornPult', GROWTH_STAGE.SPROUT)).toEqual(['corn-pult-sprout-v1']);
    expect(getGrowthVisualAssetIds('watermelonPult', GROWTH_STAGE.SPROUT)).toEqual(['watermelon-pult-sprout-v1']);
    expect(getGrowthVisualAssetIds('peaShooter', GROWTH_STAGE.MATURE)).toEqual(['pea-shooter-adult-v1']);
    expect(getGrowthVisualAssetIds('cornPult', GROWTH_STAGE.MATURE)).toEqual(['corn-pult-adult-v1']);
    expect(getGrowthVisualAssetIds('watermelonPult', GROWTH_STAGE.MATURE)).toEqual(['watermelon-pult-adult-v1']);
  });

  it('将 A/B/C 花圃中的植物模型转向与后三块区分开', () => {
    const manifest = createBackyardManifest();
    const getPlot = (id) => manifest.entities.find((entity) => entity.id === id);
    expect(getPlotPlantYaw(getPlot('plot-a'))).toBe(Math.PI);
    expect(getPlotPlantYaw(getPlot('plot-b'))).toBe(Math.PI);
    expect(getPlotPlantYaw(getPlot('plot-c'))).toBe(Math.PI);
    expect(getPlotPlantYaw(getPlot('plot-d'))).toBe(0);
  });

  it('成熟判定只从已保存的时间状态推进，不由视觉模型决定', () => {
    const manifest = createBackyardManifest();
    const [addPlant] = createPlantingCommands(manifest, { speciesId: 'cornPult', plotId: 'plot-b', now: 1_000 });
    manifest.entities.push(addPlant.entity);
    const commands = getPendingGrowthCommands(manifest, 46_000);
    expect(commands[0].value.stage).toBe(GROWTH_STAGE.MATURE);
    expect(commands[0].value.readyToClaim).toBe(true);
  });

  it('领取成熟植物时释放花圃并只解锁对应武器', () => {
    const manifest = createBackyardManifest();
    const [addPlant, occupyPlot] = createPlantingCommands(manifest, { speciesId: 'peaShooter', plotId: 'plot-c', now: 1_000 });
    addPlant.entity.components.growth.stage = GROWTH_STAGE.MATURE;
    addPlant.entity.components.growth.readyToClaim = true;
    manifest.entities.push(addPlant.entity);
    manifest.entities.find((entity) => entity.id === occupyPlot.entityId).components.occupancy = occupyPlot.value;

    const commands = createClaimCommands(manifest, addPlant.entity.id);
    expect(commands).toHaveLength(3);
    expect(commands[0].value.stage).toBe(GROWTH_STAGE.CLAIMED);
    expect(commands[1]).toEqual({ type: 'SET_COMPONENT', entityId: 'plot-c', component: 'occupancy', value: { entityId: null } });
    expect(commands[2].value.weapons).toEqual(['peaShooter']);
  });

  it('铁铲会释放未成熟植物占用的花圃', () => {
    const manifest = createBackyardManifest();
    const [addPlant, occupyPlot] = createPlantingCommands(manifest, { speciesId: 'cornPult', plotId: 'plot-b', now: 2_000 });
    manifest.entities.push(addPlant.entity);
    manifest.entities.find((entity) => entity.id === occupyPlot.entityId).components.occupancy = occupyPlot.value;

    expect(createUprootCommands(manifest, addPlant.entity.id)).toEqual([
      { type: 'REMOVE_ENTITY', entityId: addPlant.entity.id },
      { type: 'SET_COMPONENT', entityId: 'plot-b', component: 'occupancy', value: { entityId: null } },
    ]);
  });
});
