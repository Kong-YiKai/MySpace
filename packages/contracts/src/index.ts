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

export const point2Schema = z.tuple([z.number(), z.number()]);

export const floorPlanWallSchema = z.object({
  id: z.string().min(1),
  start: point2Schema,
  end: point2Schema,
  thickness: z.number().positive().default(0.16),
  height: z.number().positive().default(2.8),
});

export const floorPlanOpeningSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['door', 'window']),
  wallId: z.string().min(1),
  offset: z.number().min(0).max(1),
  width: z.number().positive(),
  height: z.number().positive(),
  sillHeight: z.number().nonnegative().default(0),
});

export const floorPlanRoomSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().default(''),
  polygon: z.array(point2Schema).min(3),
  confidence: z.number().min(0).max(1),
});

export const structuredFloorPlanSchema = z.object({
  schemaVersion: z.literal('1.0'),
  width: z.number().positive(),
  depth: z.number().positive(),
  scaleMetersPerPixel: z.number().positive().nullable(),
  scaleEstimated: z.boolean(),
  walls: z.array(floorPlanWallSchema).min(2),
  openings: z.array(floorPlanOpeningSchema).default([]),
  rooms: z.array(floorPlanRoomSchema).min(1),
  entrance: z.object({
    position: point2Schema,
    direction: point2Schema,
  }),
  confidence: z.number().min(0).max(1),
  diagnostics: z.record(z.string(), z.unknown()).default({}),
});

export const uploadIntentRequestSchema = z.object({
  kind: z.enum(['floor-plan', 'reference-image', 'reference-video']),
  fileName: z.string().trim().min(1).max(255),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
});

export const uploadIntentSchema = z.object({
  assetId: z.string().min(1),
  method: z.literal('PUT'),
  uploadUrl: z.string().url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
});

export const floorPlanValidationRequestSchema = z.object({
  assetId: z.string().min(1),
});

export const floorPlanJobStatusSchema = z.enum([
  'accepted',
  'validating-file',
  'recognizing',
  'normalizing',
  'complete',
  'failed',
]);

export const floorPlanJobSchema = z.object({
  jobId: z.string().uuid(),
  assetId: z.string().min(1),
  status: floorPlanJobStatusSchema,
  progress: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
  plan: structuredFloorPlanSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createHousingSessionSchema = z.object({
  source: housingLayoutSourceSchema,
});

export const housingSessionStatusSchema = z.enum(['shell-generating', 'shell-ready', 'failed']);

export const housingSessionSchema = z.object({
  sessionId: z.string().uuid(),
  source: housingLayoutSourceSchema,
  status: housingSessionStatusSchema,
  shellJobId: z.string().uuid(),
  sceneId: z.string().min(1).optional(),
  manifest: sceneManifestSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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
    'floor-plan.validation-requested',
    'floor-plan.progressed',
    'floor-plan.validated',
    'floor-plan.rejected',
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
    message: z.string().min(1).optional(),
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

export const floorPlanValidationRequestedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('floor-plan.validation-requested'),
  payload: z.object({
    jobId: z.string().uuid(),
    assetId: z.string().min(1),
    storageKey: z.string().min(1),
    expectedMediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    expectedSizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  }),
});

export const floorPlanProgressedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('floor-plan.progressed'),
  payload: z.object({
    jobId: z.string().uuid(),
    status: z.enum(['validating-file', 'recognizing', 'normalizing']),
    progress: z.number().min(0).max(1),
    message: z.string().min(1),
  }),
});

export const floorPlanValidatedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('floor-plan.validated'),
  payload: z.object({
    jobId: z.string().uuid(),
    assetId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    plan: structuredFloorPlanSchema,
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    detectedMediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    widthPixels: z.number().int().positive(),
    heightPixels: z.number().int().positive(),
  }),
});

export const floorPlanRejectedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('floor-plan.rejected'),
  payload: z.object({
    jobId: z.string().uuid(),
    assetId: z.string().min(1),
    errorCode: z.enum([
      'unsupported_file',
      'file_too_large',
      'image_decode_failed',
        'floor_plan_not_detected',
        'low_plan_confidence',
        'low_geometry_confidence',
        'floor_plan_ai_unavailable',
        'floor_plan_ai_failed',
        'floor_plan_recognition_failed',
    ]),
    errorMessage: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    retryable: z.boolean(),
  }),
});

export const platformEventSchema = z.discriminatedUnion('eventType', [
  generationRequestedEventSchema,
  generationProgressedEventSchema,
  generationCompletedEventSchema,
  generationFailedEventSchema,
  sceneRevisionCreatedEventSchema,
  floorPlanValidationRequestedEventSchema,
  floorPlanProgressedEventSchema,
  floorPlanValidatedEventSchema,
  floorPlanRejectedEventSchema,
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
export type StructuredFloorPlan = z.infer<typeof structuredFloorPlanSchema>;
export type UploadIntentRequest = z.infer<typeof uploadIntentRequestSchema>;
export type UploadIntent = z.infer<typeof uploadIntentSchema>;
export type FloorPlanJob = z.infer<typeof floorPlanJobSchema>;
export type HousingSession = z.infer<typeof housingSessionSchema>;
export type SceneManifest = z.infer<typeof sceneManifestSchema>;

export const eventSubject = (event: PlatformEvent): string => (
  `${event.eventType}.v${event.version}`
);
