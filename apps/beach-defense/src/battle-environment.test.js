import { describe, expect, it } from 'vitest';
import {
  BATTLE_ENVIRONMENT_DEFAULTS,
  createBattleEnvironmentSpec,
} from './battle-environment.js';

describe('battle environment specification', () => {
  it('describes a camera-following procedural cloud dome', () => {
    const spec = createBattleEnvironmentSpec();

    expect(spec.sky).toMatchObject({
      kind: 'procedural-cloud-dome',
      followsCamera: true,
      radius: BATTLE_ENVIRONMENT_DEFAULTS.skyRadius,
    });
    expect(spec.sky.segments.width).toBeGreaterThan(16);
    expect(spec.sky.segments.height).toBeGreaterThan(12);
    expect(spec.sky.cloudLayers.map((layer) => layer.id)).toEqual([
      'macro-cumulus',
      'broken-cumulus',
      'high-wisps',
    ]);
  });

  it('keeps only the distant sea haze after Lux3D assets take over solid boundaries', () => {
    const spec = createBattleEnvironmentSpec();
    const boundaryIds = spec.boundaries.map((boundary) => boundary.id);

    expect(boundaryIds).toEqual(['front-surf']);
    expect(spec.boundaries.find((boundary) => boundary.id === 'front-surf').z).toBeGreaterThan(0);
  });

  it('accepts field-specific visual overrides without mutating defaults', () => {
    const spec = createBattleEnvironmentSpec({
      horizonZ: 16,
      fog: { far: 56 },
    });

    expect(spec.boundaries.find((boundary) => boundary.id === 'front-surf').z).toBe(16);
    expect(spec.atmosphere.far).toBe(56);
    expect(BATTLE_ENVIRONMENT_DEFAULTS.fog.far).toBe(94);
  });
});
