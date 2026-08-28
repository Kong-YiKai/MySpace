const TAU = Math.PI * 2;

/** The latest shot temporarily owns the weapon pose and disables idle motion. */
export const FIRE_POSE_DURATION_MS = 260;

/** The weapon reaches its maximum recoil scale during the opening part of a shot. */
export const FIRE_POSE_EXPAND_MS = 80;

/** Maximum scale applied by a single shot pulse. It is deliberately not cumulative. */
export const FIRE_SCALE_PEAK = 1.12;

/** Auto-rotation speed used by the stable inspection turntable. */
export const INSPECT_TURN_SPEED_RAD_PER_MS = 0.0007;

/** A centered, slightly forward inspection pose relative to the normal held weapon pose. */
export const INSPECT_POSITION_OFFSET = Object.freeze({
  x: 0,
  y: -0.06,
  z: -0.72,
});

const ZERO_OFFSET = Object.freeze({ x: 0, y: 0, z: 0 });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function smootherStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function wrapRadians(value) {
  const wrapped = value % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * Calculates a weapon-only pose without retaining state or depending on Three.js.
 *
 * `elapsedMs` is the monotonic game clock. `timeSinceLastShotMs` should be `Infinity`
 * before the first shot. The caller owns inspection drag state and supplies its yaw/pitch
 * offsets here, so automatic inspection rotation never erases manual input.
 */
export function getWeaponMotion({
  elapsedMs = 0,
  inspecting = false,
  timeSinceLastShotMs = Infinity,
  inspectYaw = 0,
  inspectPitch = 0,
} = {}) {
  const time = Math.max(0, finiteOr(elapsedMs, 0));
  const manualYaw = finiteOr(inspectYaw, 0);
  const manualPitch = finiteOr(inspectPitch, 0);

  if (inspecting) {
    return {
      mode: 'inspect',
      positionOffset: { ...INSPECT_POSITION_OFFSET },
      rotationOffset: {
        x: manualPitch,
        y: wrapRadians(time * INSPECT_TURN_SPEED_RAD_PER_MS) + manualYaw,
        z: 0,
      },
      scaleMultiplier: 1,
    };
  }

  const shotAge = Math.max(0, finiteOr(timeSinceLastShotMs, Infinity));
  if (shotAge < FIRE_POSE_DURATION_MS) {
    const rising = shotAge / FIRE_POSE_EXPAND_MS;
    const scale = shotAge <= FIRE_POSE_EXPAND_MS
      ? 1 + (FIRE_SCALE_PEAK - 1) * smootherStep(rising)
      : FIRE_SCALE_PEAK - (FIRE_SCALE_PEAK - 1) * smootherStep(
        (shotAge - FIRE_POSE_EXPAND_MS) / (FIRE_POSE_DURATION_MS - FIRE_POSE_EXPAND_MS),
      );

    return {
      mode: 'combat',
      positionOffset: { ...ZERO_OFFSET },
      rotationOffset: { ...ZERO_OFFSET },
      scaleMultiplier: scale,
    };
  }

  const idleMs = shotAge - FIRE_POSE_DURATION_MS;
  const swayFadeIn = smootherStep(idleMs / 180);
  const phase = time * 0.004;

  return {
    mode: 'combat',
    positionOffset: {
      x: Math.sin(phase * 0.75) * 0.007 * swayFadeIn,
      y: Math.sin(phase) * 0.012 * swayFadeIn,
      z: Math.cos(phase * 0.57) * 0.005 * swayFadeIn,
    },
    rotationOffset: {
      x: Math.sin(phase * 0.82) * 0.014 * swayFadeIn,
      y: Math.sin(phase * 0.61) * 0.01 * swayFadeIn,
      z: Math.cos(phase * 0.93) * 0.009 * swayFadeIn,
    },
    scaleMultiplier: 1,
  };
}
