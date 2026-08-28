import { describe, expect, it } from 'vitest';
import { TIDE_LEVELS } from './battle-balance.js';
import { completeLevel, createInitialLevelProgress, isLevelUnlocked, restoreLevelProgress } from './level-progression.js';

describe('battle level progression', () => {
  it('starts with only the first demo level unlocked', () => {
    const progress = createInitialLevelProgress(TIDE_LEVELS);
    expect(progress.unlockedLevelIds).toEqual(['tide-01']);
    expect(isLevelUnlocked(progress, 'tide-02')).toBe(false);
  });

  it('unlocks exactly the next level after a victory', () => {
    const progress = completeLevel(createInitialLevelProgress(TIDE_LEVELS), TIDE_LEVELS, 'tide-01');
    expect(progress.unlockedLevelIds).toEqual(['tide-01', 'tide-02']);
    expect(isLevelUnlocked(progress, 'tide-03')).toBe(false);
  });

  it('keeps saves valid when stale or duplicate ids are present', () => {
    expect(restoreLevelProgress({ unlockedLevelIds: ['removed', 'tide-02', 'tide-02'] }, TIDE_LEVELS))
      .toEqual({ unlockedLevelIds: ['tide-01', 'tide-02'] });
  });

  it('repairs missing, malformed, and future-version saves to a safe first-level state', () => {
    expect(restoreLevelProgress(undefined, TIDE_LEVELS))
      .toEqual({ unlockedLevelIds: ['tide-01'] });
    expect(restoreLevelProgress({ unlockedLevelIds: 'tide-04' }, TIDE_LEVELS))
      .toEqual({ unlockedLevelIds: ['tide-01'] });
    expect(restoreLevelProgress({ unlockedLevelIds: ['tide-99'] }, TIDE_LEVELS))
      .toEqual({ unlockedLevelIds: ['tide-01'] });
    expect(isLevelUnlocked(undefined, 'tide-01')).toBe(false);
  });

  it('ignores a completion event for an unknown future level id', () => {
    const progress = completeLevel(createInitialLevelProgress(TIDE_LEVELS), TIDE_LEVELS, 'tide-99');
    expect(progress).toEqual({ unlockedLevelIds: ['tide-01'] });
  });

  it('does not invent a level after the final victory', () => {
    const lastLevel = TIDE_LEVELS.at(-1);
    const progress = completeLevel({ unlockedLevelIds: TIDE_LEVELS.map((level) => level.id) }, TIDE_LEVELS, lastLevel.id);
    expect(progress.unlockedLevelIds).toEqual(TIDE_LEVELS.map((level) => level.id));
  });

  it('treats duplicate level definitions as one playable level when advancing', () => {
    const levels = [
      { id: 'tide-01' },
      { id: 'tide-01' },
      { id: 'tide-02' },
    ];
    const progress = completeLevel(createInitialLevelProgress(levels), levels, 'tide-01');
    expect(progress.unlockedLevelIds).toEqual(['tide-01', 'tide-02']);
  });
});
