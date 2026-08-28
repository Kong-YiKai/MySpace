export const LEVEL_PROGRESS_STORAGE_KEY = 'myspace.beach-defense.level-progress.v1';

function getPlayableLevels(levels) {
  const seenIds = new Set();
  return levels.filter((level) => {
    const levelId = level?.id;
    if (typeof levelId !== 'string' || !levelId || seenIds.has(levelId)) return false;
    seenIds.add(levelId);
    return true;
  });
}

export function createInitialLevelProgress(levels) {
  const playableLevels = getPlayableLevels(levels);
  return { unlockedLevelIds: playableLevels.length ? [playableLevels[0].id] : [] };
}

export function restoreLevelProgress(rawProgress, levels) {
  const playableLevels = getPlayableLevels(levels);
  const validIds = new Set(playableLevels.map((level) => level.id));
  const savedIds = Array.isArray(rawProgress?.unlockedLevelIds) ? rawProgress.unlockedLevelIds : [];
  const unlockedLevelIds = savedIds.filter((levelId, index) => (
    validIds.has(levelId) && savedIds.indexOf(levelId) === index
  ));
  if (playableLevels.length && !unlockedLevelIds.includes(playableLevels[0].id)) {
    unlockedLevelIds.unshift(playableLevels[0].id);
  }
  return { unlockedLevelIds };
}

export function completeLevel(progress, levels, completedLevelId) {
  const playableLevels = getPlayableLevels(levels);
  const nextProgress = restoreLevelProgress(progress, playableLevels);
  const completedIndex = playableLevels.findIndex((level) => level.id === completedLevelId);
  if (completedIndex < 0) return nextProgress;
  const completedId = playableLevels[completedIndex].id;
  if (!nextProgress.unlockedLevelIds.includes(completedId)) nextProgress.unlockedLevelIds.push(completedId);
  const nextLevel = playableLevels[completedIndex + 1];
  if (nextLevel && !nextProgress.unlockedLevelIds.includes(nextLevel.id)) {
    nextProgress.unlockedLevelIds.push(nextLevel.id);
  }
  return nextProgress;
}

export function isLevelUnlocked(progress, levelId) {
  return Array.isArray(progress?.unlockedLevelIds) && progress.unlockedLevelIds.includes(levelId);
}
