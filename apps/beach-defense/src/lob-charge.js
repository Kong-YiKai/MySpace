const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

export const LOB_CHARGE_DEFAULTS = Object.freeze({
  durationMs: 1_050,
  minimumProgress: 0.12,
  minimumDamageMultiplier: 0.58,
  maximumDamageMultiplier: 1.55,
});

export function clampUnit(value) {
  return Math.min(1, Math.max(0, finiteOr(value, 0)));
}

export function getLobChargeProgress({ startedAt, now, durationMs = LOB_CHARGE_DEFAULTS.durationMs } = {}) {
  const safeDuration = Math.max(1, finiteOr(durationMs, LOB_CHARGE_DEFAULTS.durationMs));
  return clampUnit((finiteOr(now, 0) - finiteOr(startedAt, 0)) / safeDuration);
}

/**
 * Keep the charge model engine-agnostic so the visible guide and real projectile
 * always consume the identical launch numbers.
 */
export function getLobShotProfile(attack, progress = 0) {
  const charge = clampUnit(progress);
  const minimumDamageMultiplier = finiteOr(attack?.minimumDamageMultiplier, LOB_CHARGE_DEFAULTS.minimumDamageMultiplier);
  const maximumDamageMultiplier = finiteOr(attack?.maximumDamageMultiplier, LOB_CHARGE_DEFAULTS.maximumDamageMultiplier);
  const minimumHorizontalSpeed = finiteOr(attack?.minimumHorizontalSpeed, finiteOr(attack?.horizontalSpeed, 0) * 0.42);
  const minimumUpwardSpeed = finiteOr(attack?.minimumUpwardSpeed, finiteOr(attack?.upwardSpeed, 0) * 0.42);
  const maximumHorizontalSpeed = finiteOr(attack?.horizontalSpeed, 0);
  const maximumUpwardSpeed = finiteOr(attack?.upwardSpeed, 0);
  // 让短按与满蓄力精准落在设计数值上，而不是因 IEEE 浮点插值产生 14.399999… 这类边界误差。
  const interpolate = (minimum, maximum) => {
    if (charge <= 0) return minimum;
    if (charge >= 1) return maximum;
    return minimum + (maximum - minimum) * charge;
  };
  const horizontalSpeed = interpolate(minimumHorizontalSpeed, maximumHorizontalSpeed);
  const upwardSpeed = interpolate(minimumUpwardSpeed, maximumUpwardSpeed);
  const damageMultiplier = minimumDamageMultiplier + (maximumDamageMultiplier - minimumDamageMultiplier) * charge;

  return {
    ...attack,
    charge,
    horizontalSpeed,
    upwardSpeed,
    damage: Math.max(1, Math.round(finiteOr(attack?.damage, 0) * damageMultiplier)),
    splashDamage: Math.max(1, Math.round(finiteOr(attack?.splashDamage, finiteOr(attack?.damage, 0)) * damageMultiplier)),
  };
}

export function estimateLobRange({ startHeight = 0, horizontalSpeed = 0, upwardSpeed = 0, gravity = 9.8 } = {}) {
  const safeGravity = Math.max(0.001, finiteOr(gravity, 9.8));
  const safeHeight = Math.max(0, finiteOr(startHeight, 0));
  const safeUpwardSpeed = Math.max(0, finiteOr(upwardSpeed, 0));
  const landingTime = (safeUpwardSpeed + Math.sqrt(safeUpwardSpeed ** 2 + 2 * safeGravity * safeHeight)) / safeGravity;
  return Math.max(0, finiteOr(horizontalSpeed, 0) * landingTime);
}
