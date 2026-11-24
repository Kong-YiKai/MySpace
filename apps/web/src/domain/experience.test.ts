import { describe, expect, it } from 'vitest';
import {
  experienceReducer,
  initialExperienceState,
} from './experience';

describe('housing experience state machine', () => {
  it('opens and exits a shell tour before any decoration analysis', () => {
    const shell = experienceReducer(initialExperienceState, { type: 'SHELL_READY' });
    const tour = experienceReducer(shell, { type: 'ENTER_IMMERSIVE' });

    expect(tour.immersive).toBe(true);
    expect(tour.decorationAnalysis).toBeNull();
    expect(experienceReducer(tour, { type: 'EXIT_IMMERSIVE' })).toEqual(shell);
  });

  it('moves from layout selection to a ready shell', () => {
    let state = experienceReducer(initialExperienceState, {
      type: 'SELECT_LAYOUT',
      source: { kind: 'preset', preset: 'studio' },
      name: '大开间',
    });
    expect(state.stage).toBe('shell-generating');

    state = experienceReducer(state, { type: 'SHELL_READY' });
    expect(state.stage).toBe('shell-ready');
    expect(state.progress).toBe(100);
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

  it('accepts uncertain realism for text-only briefs while keeping the image quality gate', () => {
    const analysis = {
      schemaVersion: '1.0' as const,
      analysisId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sourceKind: 'text' as const,
      sourceBrief: '现代奶油风客厅',
      style: {
        name: '现代奶油风', summary: '暖色住宅空间', realism: 'uncertain' as const,
        palette: ['米白'], materials: ['布艺'], lighting: '自然光', negativePrompts: ['cartoon'],
      },
      layoutSummary: '客厅布局', objectCandidates: [], confidence: 0.8, warnings: [], diagnostics: {},
    };
    const textState = experienceReducer(initialExperienceState, {
      type: 'REFERENCE_READY', assetId: null, analysis,
    });
    expect(textState.error).toBeNull();

    const imageState = experienceReducer(initialExperienceState, {
      type: 'REFERENCE_READY', assetId: 'reference-1',
      analysis: { ...analysis, sourceKind: 'image', sourceAssetId: 'reference-1' },
    });
    expect(imageState.error).toContain('写实质量门');
  });
});
