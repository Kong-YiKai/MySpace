import { z } from 'zod';
import {
  commandEnvelopeSchema,
  generationRequestSchema,
  sceneManifestSchema,
} from '@spatial-intelligence/core';

export {
  commandEnvelopeSchema,
  generationRequestSchema,
  sceneManifestSchema,
} from '@spatial-intelligence/core';

export const generationJobStatusSchema = z.enum([
  'accepted',
  'generating',
  'normalizing',
  'complete',
  'failed',
  'cancelled',
]);

export const housingLayoutSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), preset: z.enum(['studio', 'one-bedroom']) }),
  z.object({ kind: z.literal('uploaded-plan'), assetId: z.string().min(1) }),
]);

export const housingExperienceStageSchema = z.enum([
  'layout-selection',
  'validating-plan',
  'shell-generating',
  'shell-ready',
  'brief-analyzing',
  'decor-generating',
  'decorated',
  'immersive',
]);

export const wallpaperPresetSchema = z.enum([
  'cream-white',
  'oat-beige',
  'sage-mist',
]);

export const editableRoomObjectSchema = z.enum([
  'sofa',
  'coffee-table',
  'rug',
  'vase',
  'plant',
  'floor-lamp',
]);

export const floorPlanValidationResultSchema = z.object({
  valid: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).optional(),
  normalizedAssetId: z.string().min(1).optional(),
});

export const decorationRequestSchema = z.object({
  sessionId: z.string().min(1),
  brief: z.string().trim().min(3).max(2_000),
  wallpaper: wallpaperPresetSchema,
  referenceAssetIds: z.array(z.string().min(1)).max(8).default([]),
});

export const generationJobSchema = z.object({
  jobId: z.string().uuid(),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: generationJobStatusSchema,
  progress: z.number().min(0).max(1),
  sceneId: z.string().min(1).optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const eventMetadataSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.enum([
    'generation.requested',
    'generation.progressed',
    'generation.completed',
    'generation.failed',
    'scene.revision-created',
  ]),
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  traceId: z.string().uuid(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable().default(null),
});

export const generationRequestedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('generation.requested'),
  payload: z.object({
    jobId: z.string().uuid(),
    idempotencyKey: z.string().min(1),
    request: generationRequestSchema,
  }),
});

export const generationProgressedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('generation.progressed'),
  payload: z.object({
    jobId: z.string().uuid(),
    status: z.enum(['accepted', 'generating', 'normalizing']),
    progress: z.number().min(0).max(1),
    providerId: z.string().min(1).optional(),
  }),
});

export const generationCompletedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('generation.completed'),
  payload: z.object({
    jobId: z.string().uuid(),
    manifest: sceneManifestSchema,
  }),
});

export const generationFailedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('generation.failed'),
  payload: z.object({
    jobId: z.string().uuid(),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
    retryable: z.boolean(),
  }),
});

export const sceneRevisionCreatedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('scene.revision-created'),
  payload: z.object({
    sceneId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    commandId: z.string().min(1),
    changes: z.array(z.unknown()),
  }),
});

export const platformEventSchema = z.discriminatedUnion('eventType', [
  generationRequestedEventSchema,
  generationProgressedEventSchema,
  generationCompletedEventSchema,
  generationFailedEventSchema,
  sceneRevisionCreatedEventSchema,
]);

export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type GenerationRequestedEvent = z.infer<typeof generationRequestedEventSchema>;
export type PlatformEvent = z.infer<typeof platformEventSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type HousingLayoutSource = z.infer<typeof housingLayoutSourceSchema>;
export type HousingExperienceStage = z.infer<typeof housingExperienceStageSchema>;
export type WallpaperPreset = z.infer<typeof wallpaperPresetSchema>;
export type EditableRoomObject = z.infer<typeof editableRoomObjectSchema>;
export type DecorationRequest = z.infer<typeof decorationRequestSchema>;

export const eventSubject = (event: PlatformEvent): string => (
  `${event.eventType}.v${event.version}`
);
