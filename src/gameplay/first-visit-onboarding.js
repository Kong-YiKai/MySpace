const STORAGE_PREFIX = 'myspace.first-visit-onboarding.v1.';

/**
 * Returns true exactly once per browser profile and scene id.
 *
 * The game remains usable when storage is unavailable (for example, a strict
 * privacy context): in that case we still show the orientation instead of
 * failing the scene boot.
 */
export function consumeFirstVisit(storage, sceneId) {
  const key = `${STORAGE_PREFIX}${sceneId}`;
  try {
    if (storage?.getItem(key)) return false;
    storage?.setItem(key, 'shown');
    return true;
  } catch {
    return true;
  }
}

export { STORAGE_PREFIX as FIRST_VISIT_ONBOARDING_STORAGE_PREFIX };
