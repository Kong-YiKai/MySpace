import { describe, expect, it } from 'vitest';
import {
  PANORAMA_GUIDE_SCHEMA,
  resolveGuidePresentation,
  validateGuideDirective,
} from './guide-contract.js';

const entityIds = ['portal-door', 'display-plinth'];

describe('panorama guide contract', () => {
  it('maps guide semantics to renderer presentation without exposing renderer state input', () => {
    const directive = {
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'lead',
      targetEntityId: 'portal-door',
      message: '让我带你去世界之门。',
    };

    const checked = validateGuideDirective(directive, { entityIds });

    expect(checked).toMatchObject({ ok: true, value: { intent: 'lead', targetEntityId: 'portal-door' } });
    expect(resolveGuidePresentation(checked.value.intent)).toMatchObject({ rendererState: 'searching' });
  });

  it('rejects raw renderer states and entities outside the active scene', () => {
    expect(validateGuideDirective({
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'lead',
      targetEntityId: 'not-in-this-scene',
    }, { entityIds })).toMatchObject({ ok: false, reason: 'unknown-target-entity' });

    expect(validateGuideDirective({
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'idle',
      rendererState: 'spin_wild',
    }, { entityIds })).toMatchObject({ ok: false, reason: 'unknown-field' });
  });

  it('requires a known target whenever the guide is asked to inspect, lead or explain', () => {
    expect(validateGuideDirective({
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'explain',
    }, { entityIds })).toMatchObject({ ok: false, reason: 'target-entity-required' });
  });
});
