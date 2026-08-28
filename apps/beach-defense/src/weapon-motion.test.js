import { describe, expect, it } from 'vitest';
import {
  FIRE_POSE_DURATION_MS,
  FIRE_POSE_EXPAND_MS,
  FIRE_SCALE_PEAK,
  INSPECT_POSITION_OFFSET,
  INSPECT_TURN_SPEED_RAD_PER_MS,
  getWeaponMotion,
} from './weapon-motion.js';

describe('getWeaponMotion', () => {
  it('returns a restrained idle breathing/sway pose after the firing pose has settled', () => {
    const motion = getWeaponMotion({
      elapsedMs: 753,
      timeSinceLastShotMs: FIRE_POSE_DURATION_MS + 180,
    });

    expect(motion.mode).toBe('combat');
    expect(motion.scaleMultiplier).toBe(1);
    expect(Math.abs(motion.positionOffset.x)).toBeLessThanOrEqual(0.007);
    expect(Math.abs(motion.positionOffset.y)).toBeLessThanOrEqual(0.012);
    expect(Math.abs(motion.rotationOffset.x)).toBeLessThanOrEqual(0.014);
    expect(Math.abs(motion.rotationOffset.y)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(motion.positionOffset.y) + Math.abs(motion.rotationOffset.x)).toBeGreaterThan(0);
  });

  it('suppresses idle sway during the bounded firing pose and creates a soft 1.0 to 1.12 pulse', () => {
    const justFired = getWeaponMotion({ elapsedMs: 100, timeSinceLastShotMs: 0 });
    const peak = getWeaponMotion({
      elapsedMs: 100 + FIRE_POSE_EXPAND_MS,
      timeSinceLastShotMs: FIRE_POSE_EXPAND_MS,
    });
    const settling = getWeaponMotion({
      elapsedMs: 100 + FIRE_POSE_DURATION_MS - 1,
      timeSinceLastShotMs: FIRE_POSE_DURATION_MS - 1,
    });

    expect(justFired.scaleMultiplier).toBe(1);
    expect(peak.scaleMultiplier).toBeCloseTo(FIRE_SCALE_PEAK, 6);
    expect(settling.scaleMultiplier).toBeGreaterThan(1);
    expect(settling.scaleMultiplier).toBeLessThan(FIRE_SCALE_PEAK);
    expect(peak.positionOffset).toEqual({ x: 0, y: 0, z: 0 });
    expect(peak.rotationOffset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('is stateless and never lets rapid shots accumulate beyond the one-shot peak', () => {
    const inputs = [0, 20, 80, 130, 220, 259].map((timeSinceLastShotMs) => ({
      elapsedMs: 2_000,
      timeSinceLastShotMs,
    }));
    const scales = inputs.map((input) => getWeaponMotion(input).scaleMultiplier);

    expect(Math.max(...scales)).toBeLessThanOrEqual(FIRE_SCALE_PEAK);
    expect(getWeaponMotion(inputs[2])).toEqual(getWeaponMotion(inputs[2]));
  });

  it('keeps inspection centered while preserving manual yaw/pitch over the automatic turntable', () => {
    const elapsedMs = 1_000;
    const inspectYaw = 0.42;
    const inspectPitch = -0.18;
    const motion = getWeaponMotion({
      elapsedMs,
      inspecting: true,
      inspectYaw,
      inspectPitch,
      timeSinceLastShotMs: 0,
    });

    expect(motion.mode).toBe('inspect');
    expect(motion.positionOffset).toEqual(INSPECT_POSITION_OFFSET);
    expect(motion.scaleMultiplier).toBe(1);
    expect(motion.rotationOffset.x).toBe(inspectPitch);
    expect(motion.rotationOffset.y).toBeCloseTo(
      elapsedMs * INSPECT_TURN_SPEED_RAD_PER_MS + inspectYaw,
      6,
    );
  });
});
