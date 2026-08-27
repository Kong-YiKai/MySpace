export const PANORAMA_GUIDE_SCHEMA = 'panorama-guide.v1';

export const GUIDE_INTENTS = Object.freeze([
  'greet',
  'listen',
  'observe',
  'lead',
  'explain',
  'think',
  'notify',
  'caution',
  'rest',
  'wake',
  'idle',
]);

const TARGETED_INTENTS = new Set(['observe', 'lead', 'explain']);
const ALLOWED_KEYS = new Set(['schemaVersion', 'intent', 'targetEntityId', 'message']);

const PRESENTATION_BY_INTENT = Object.freeze({
  greet: { rendererState: 'waking', settleAfterMs: 1100 },
  listen: { rendererState: 'listening', settleAfterMs: null },
  observe: { rendererState: 'curious', settleAfterMs: 2600 },
  lead: { rendererState: 'searching', settleAfterMs: null },
  explain: { rendererState: 'dictating', settleAfterMs: 4200 },
  think: { rendererState: 'thinking', settleAfterMs: null },
  notify: { rendererState: 'notifying', settleAfterMs: 3000 },
  caution: { rendererState: 'alerting', settleAfterMs: 3200 },
  rest: { rendererState: 'sleeping', settleAfterMs: null },
  wake: { rendererState: 'waking', settleAfterMs: 1000 },
  idle: { rendererState: 'idle', settleAfterMs: null },
});

function rejected(reason) {
  return {
    ok: false,
    reason,
    value: {
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'idle',
      targetEntityId: null,
      message: null,
    },
  };
}

/**
 * Validates a model or scripted guide directive. Renderer state names, motion
 * primitives and arbitrary UI properties are intentionally not part of this
 * contract: the presentation layer owns those decisions.
 */
export function validateGuideDirective(input, { entityIds = [] } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return rejected('directive-not-an-object');
  }

  const keys = Object.keys(input);
  if (keys.some((key) => !ALLOWED_KEYS.has(key))) return rejected('unknown-field');
  if (input.schemaVersion !== PANORAMA_GUIDE_SCHEMA) return rejected('schema-version-mismatch');
  if (!GUIDE_INTENTS.includes(input.intent)) return rejected('unknown-intent');

  const hasTarget = input.targetEntityId !== undefined;
  if (hasTarget && (typeof input.targetEntityId !== 'string' || !entityIds.includes(input.targetEntityId))) {
    return rejected('unknown-target-entity');
  }
  if (!hasTarget && TARGETED_INTENTS.has(input.intent)) {
    return rejected('target-entity-required');
  }
  if (hasTarget && !TARGETED_INTENTS.has(input.intent)) {
    return rejected('target-entity-not-allowed');
  }

  if (input.message !== undefined && (typeof input.message !== 'string' || input.message.trim().length > 180)) {
    return rejected('invalid-message');
  }

  return {
    ok: true,
    reason: 'accepted',
    value: {
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: input.intent,
      targetEntityId: input.targetEntityId ?? null,
      message: input.message?.trim() || null,
    },
  };
}

export function resolveGuidePresentation(intent) {
  return PRESENTATION_BY_INTENT[intent] ?? PRESENTATION_BY_INTENT.idle;
}
