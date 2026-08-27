import { describe, expect, it } from 'vitest';
import {
  experienceReducer,
  initialExperienceState,
  isDecorVisible,
} from './experience';

describe('housing experience state machine', () => {
  it('moves from layout selection to editable decorated scene', () => {
    let state = experienceReducer(initialExperienceState, {
      type: 'SELECT_LAYOUT',
      source: { kind: 'preset', preset: 'studio' },
      name: '大开间',
    });
    expect(state.stage).toBe('shell-generating');

    state = experienceReducer(state, { type: 'SHELL_READY' });
    state = experienceReducer(state, { type: 'START_DECORATION' });
    state = experienceReducer(state, {
      type: 'DECOR_PROGRESS',
      progress: 65,
      message: '布置家具',
    });
    expect(state.stage).toBe('decor-generating');
    expect(isDecorVisible(state.stage, state.progress)).toBe(true);

    state = experienceReducer(state, { type: 'DECOR_READY' });
    state = experienceReducer(state, { type: 'SELECT_OBJECT', objectId: 'sofa' });
    expect(state.selectedObject).toBe('sofa');
  });

  it('returns a rejected upload to selection with an actionable error', () => {
    const validating = experienceReducer(initialExperienceState, { type: 'VALIDATE_PLAN' });
    const rejected = experienceReducer(validating, {
      type: 'PLAN_REJECTED',
      message: '未识别到户型结构',
    });
    expect(rejected.stage).toBe('layout-selection');
    expect(rejected.error).toContain('户型');
  });
});
