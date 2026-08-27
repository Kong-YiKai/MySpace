import { describe, expect, it } from 'vitest';
import {
  decorationRequestSchema,
  floorPlanValidationResultSchema,
  generationRequestedEventSchema,
  housingLayoutSourceSchema,
  platformEventSchema,
} from './index.js';

const metadata = {
  eventId: '7b1f5b4a-34ca-4b55-9e32-dc22f1139399',
  eventType: 'generation.requested' as const,
  version: 1 as const,
  occurredAt: '2026-08-27T00:00:00.000Z',
  traceId: '5817113d-af75-4204-8054-e66077641497',
  correlationId: 'a2609f84-6325-4622-9cb9-4f0bde206460',
  causationId: null,
};

describe('platform event contracts', () => {
  it('accepts a versioned generation request event', () => {
    const event = generationRequestedEventSchema.parse({
      ...metadata,
      payload: {
        jobId: 'b9614261-b9c6-405d-8072-4e91bdb83377',
        idempotencyKey: 'request-001',
        request: {
          requestId: 'request-001',
          sources: [{ id: 'prompt', type: 'text', content: 'Generate a world' }],
        },
      },
    });

    expect(platformEventSchema.parse(event).eventType).toBe('generation.requested');
  });

  it('rejects events without trace identifiers', () => {
    const { traceId: _traceId, ...withoutTraceId } = metadata;
    expect(() => generationRequestedEventSchema.parse({
      ...withoutTraceId,
      payload: {
        jobId: 'b9614261-b9c6-405d-8072-4e91bdb83377',
        idempotencyKey: 'request-001',
        request: {
          requestId: 'request-001',
          sources: [{ id: 'prompt', type: 'text', content: 'Generate a world' }],
        },
      },
    })).toThrow();
  });
});

describe('housing simulator contracts', () => {
  it('accepts preset and uploaded floor-plan sources', () => {
    expect(housingLayoutSourceSchema.parse({ kind: 'preset', preset: 'studio' })).toEqual({
      kind: 'preset',
      preset: 'studio',
    });
    expect(housingLayoutSourceSchema.parse({
      kind: 'uploaded-plan',
      assetId: 'asset_floor_plan_01',
    }).kind).toBe('uploaded-plan');
  });

  it('requires a meaningful decoration brief and bounded validation confidence', () => {
    expect(decorationRequestSchema.parse({
      sessionId: 'session-01',
      brief: '现代奶油风，温馨治愈。',
      wallpaper: 'cream-white',
    }).referenceAssetIds).toEqual([]);
    expect(() => floorPlanValidationResultSchema.parse({ valid: false, confidence: 1.2 })).toThrow();
  });
});
