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
  z.object({
    kind: z.literal('captured-space'),
    assetIds: z.array(z.string().min(1)).min(1).max(200),
    captureType: z.enum(['images', 'video', 'insv']),
  }),
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

export const basicFurnitureKindSchema = z.enum(['sofa', 'coffee-table', 'bed', 'wardrobe', 'desk', 'chair', 'dining-table']);

export const structuredFloorPlanSchema = z.object({
  schemaVersion: z.literal('1.0'),
  width: z.number().positive(),
  depth: z.number().positive(),
  scaleMetersPerPixel: z.number().positive().nullable(),
  scaleEstimated: z.boolean(),
  walls: z.array(floorPlanWallSchema).min(2),
  openings: z.array(floorPlanOpeningSchema).default([]),
  rooms: z.array(floorPlanRoomSchema).min(1),
  furnitureHints: z.array(z.object({
    kind: basicFurnitureKindSchema,
    position: point2Schema,
    direction: point2Schema,
    confidence: z.number().min(0).max(1),
  })).max(48).optional(),
  entrance: z.object({
    position: point2Schema,
    direction: point2Schema,
    kind: z.enum(['door', 'stair-landing']).optional(),
  }),
  confidence: z.number().min(0).max(1),
  diagnostics: z.record(z.string(), z.unknown()).default({}),
});

export const point3Schema = z.tuple([z.number(), z.number(), z.number()]);

export const spatialAnchorSetSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sceneId: z.string().min(1),
  shellRevision: z.number().int().nonnegative(),
  coordinateSystem: z.object({
    upAxis: z.enum(['X', 'Y', 'Z']),
    unit: z.literal('meter'),
    handedness: z.enum(['left', 'right']),
  }),
  bounds: z.object({ min: point3Schema, max: point3Schema }),
  entrance: z.object({
    position: point3Schema,
    direction: point3Schema,
    cameraHeight: z.number().positive().default(1.65),
  }),
  surfaces: z.array(z.object({
    anchorId: z.string().min(1),
    kind: z.enum(['floor', 'wall', 'ceiling', 'door', 'window', 'boundary']),
    entityId: z.string().min(1).optional(),
    bounds: z.object({ min: point3Schema, max: point3Schema }),
  })).default([]),
  walkableBounds: z.object({ min: point3Schema, max: point3Schema }),
  colliderAssetId: z.string().min(1).optional(),
  provider: z.object({
    providerId: z.string().min(1),
    externalProjectId: z.string().min(1).optional(),
    sourceAssetIds: z.array(z.string().min(1)).default([]),
  }),
  lockHash: z.string().regex(/^[a-f0-9]{64}$/),
  diagnostics: z.record(z.string(), z.unknown()).default({}),
});

export const providerEvidenceSchema = z.object({
  providerId: z.string().min(1),
  operation: z.string().min(1),
  externalTaskId: z.string().min(1).optional(),
  externalProjectId: z.string().min(1).optional(),
  status: z.enum(['accepted', 'running', 'succeeded', 'failed']),
  attempts: z.number().int().positive().default(1),
  inputAssetIds: z.array(z.string().min(1)).default([]),
  outputAssetIds: z.array(z.string().min(1)).default([]),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  errorCode: z.string().min(1).optional(),
  diagnostics: z.record(z.string(), z.unknown()).default({}),
});

export const uploadIntentRequestSchema = z.object({
  kind: z.enum([
    'floor-plan',
    'room-capture-image',
    'room-capture-video',
    'room-capture-insv',
    'decoration-reference-image',
    'reference-image',
    'reference-video',
  ]),
  fileName: z.string().trim().min(1).max(255),
  mediaType: z.enum([
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/octet-stream',
  ]),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
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
  shellRevision: z.number().int().nonnegative().optional(),
  shellLocked: z.boolean().default(false),
  spatialAnchors: spatialAnchorSetSchema.optional(),
  lockedAt: z.string().datetime().optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const shellLockRequestSchema = z.object({
  sceneId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  confirmed: z.literal(true),
});

export const decorationObjectCandidateSchema = z.object({
  objectId: z.string().min(1),
  label: z.string().min(1),
  category: z.enum([
    'seating', 'table', 'storage', 'bed', 'lighting', 'appliance',
    'textile', 'plant', 'art', 'decoration', 'other',
  ]),
  importance: z.enum(['critical', 'supporting', 'background']),
  confidence: z.number().min(0).max(1),
  boundingBox: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  }),
  description: z.string().min(1),
  materialHints: z.array(z.string().min(1)).max(12).default([]),
  colorHints: z.array(z.string().min(1)).max(8).default([]),
  estimatedSizeMeters: z.object({
    width: z.number().positive().nullable(),
    height: z.number().positive().nullable(),
    depth: z.number().positive().nullable(),
  }),
  placement: z.object({
    support: z.enum(['floor', 'wall', 'ceiling', 'surface', 'unknown']),
    roomZone: z.string().min(1),
    notes: z.string().default(''),
  }),
  requiresLux3d: z.boolean(),
  photorealisticRequired: z.literal(true),
});

export const decorationAnalysisSchema = z.object({
  schemaVersion: z.literal('1.0'),
  analysisId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sourceKind: z.enum(['image', 'text']),
  sourceAssetId: z.string().min(1).optional(),
  sourceBrief: z.string().max(2_000),
  style: z.object({
    name: z.string().min(1),
    summary: z.string().min(1),
    realism: z.enum(['photorealistic', 'not-photorealistic', 'uncertain']),
    palette: z.array(z.string().min(1)).max(12),
    materials: z.array(z.string().min(1)).max(16),
    lighting: z.string().min(1),
    negativePrompts: z.array(z.string().min(1)).min(1).max(16),
  }),
  layoutSummary: z.string().min(1),
  objectCandidates: z.array(decorationObjectCandidateSchema).max(40),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().min(1)).max(20).default([]),
  diagnostics: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, context) => {
  if (value.sourceKind === 'image' && !value.sourceAssetId) {
    context.addIssue({ code: 'custom', path: ['sourceAssetId'], message: 'image analysis requires sourceAssetId' });
  }
});

export const decorationAnalysisRequestSchema = z.object({
  sessionId: z.string().uuid(),
  assetId: z.string().min(1).optional(),
  brief: z.string().trim().max(2_000).default(''),
}).refine((value) => Boolean(value.assetId) || value.brief.length >= 3, {
  message: 'provide a reference image or a brief of at least 3 characters',
  path: ['brief'],
});

export const decorationAnalysisJobStatusSchema = z.enum([
  'accepted', 'validating-file', 'recognizing', 'complete', 'failed',
]);

export const decorationAnalysisJobSchema = z.object({
  jobId: z.string().uuid(),
  sessionId: z.string().uuid(),
  assetId: z.string().min(1).optional(),
  status: decorationAnalysisJobStatusSchema,
  progress: z.number().min(0).max(1),
  analysis: decorationAnalysisSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const decorationRequestSchema = z.object({
  sessionId: z.string().min(1),
  brief: z.string().trim().max(2_000).default(''),
  wallpaper: wallpaperPresetSchema.default('cream-white'),
  referenceAssetIds: z.array(z.string().min(1)).max(1).default([]),
}).refine((value) => value.referenceAssetIds.length > 0 || value.brief.length >= 3, {
  message: 'provide a reference image or a brief of at least 3 characters',
  path: ['brief'],
});

export const assetGenerationModeSchema = z.enum(['image-guided-3d', 'text-to-3d']);

export const normalizedAssetTransformSchema = z.object({
  coordinateSystem: z.object({
    upAxis: z.literal('Y'),
    unit: z.literal('meter'),
    handedness: z.literal('right'),
  }),
  sourceBoundsMeters: z.object({ min: point3Schema, max: point3Schema }),
  normalizedBoundsMeters: z.object({ min: point3Schema, max: point3Schema }),
  scale: point3Schema,
  rotationQuaternion: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  translationMeters: point3Schema,
  pivot: z.literal('floor-center'),
});

export const assetGenerationRequestSchema = z.object({
  sessionId: z.string().uuid(),
  analysisId: z.string().uuid(),
  objectId: z.string().min(1),
  mode: assetGenerationModeSchema,
  prompt: z.string().trim().min(3).max(2_000),
  referenceAssetId: z.string().min(1).optional(),
  referenceImageUrl: z.string().url().optional(),
  referenceBoundingBox: decorationObjectCandidateSchema.shape.boundingBox.optional(),
  targetSizeMeters: z.object({
    width: z.number().positive().nullable(),
    height: z.number().positive().nullable(),
    depth: z.number().positive().nullable(),
  }),
  placement: decorationObjectCandidateSchema.shape.placement,
  quality: z.enum(['preview', 'production']).default('production'),
  photorealistic: z.literal(true),
}).superRefine((value, context) => {
  if (value.mode === 'image-guided-3d') {
    if (!value.referenceImageUrl) {
      context.addIssue({ code: 'custom', path: ['referenceImageUrl'], message: 'image-guided-3d requires referenceImageUrl' });
    }
    if (!value.referenceBoundingBox) {
      context.addIssue({ code: 'custom', path: ['referenceBoundingBox'], message: 'image-guided-3d requires referenceBoundingBox' });
    }
  }
});

export const assetGenerationJobStatusSchema = z.enum([
  'accepted', 'submitting', 'generating', 'downloading', 'normalizing', 'complete', 'failed',
]);

export const assetGenerationJobSchema = z.object({
  jobId: z.string().uuid(),
  retryOfJobId: z.string().uuid().optional(),
  request: assetGenerationRequestSchema,
  status: assetGenerationJobStatusSchema,
  progress: z.number().min(0).max(1),
  attempts: z.number().int().positive(),
  externalTaskId: z.string().min(1).optional(),
  sourceGlbAssetId: z.string().min(1).optional(),
  normalizedGlbAssetId: z.string().min(1).optional(),
  transform: normalizedAssetTransformSchema.optional(),
  providerEvidence: providerEvidenceSchema.optional(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const generationJobSchema = z.object({
  jobId: z.string().uuid(),
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  status: generationJobStatusSchema,
  progress: z.number().min(0).max(1),
  sceneId: z.string().min(1).optional(),
  providerEvidence: providerEvidenceSchema.optional(),
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
    'scene.constraints-locked',
    'floor-plan.validation-requested',
    'floor-plan.progressed',
    'floor-plan.validated',
    'floor-plan.rejected',
    'decoration-analysis.requested',
    'decoration-analysis.progressed',
    'decoration-analysis.completed',
    'decoration-analysis.failed',
    'asset-generation.requested',
    'asset-generation.progressed',
    'asset-generation.completed',
    'asset-generation.failed',
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
    providerEvidence: providerEvidenceSchema.optional(),
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
    providerEvidence: providerEvidenceSchema.optional(),
  }),
});

export const sceneRevisionCreatedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('scene.revision-created'),
  payload: z.object({
    sceneId: z.string().min(1),
    revision: z.number().int().nonnegative(),
    commandId: z.string().min(1),
    changes: z.array(z.unknown()),
    operation: z.enum(['apply', 'undo', 'redo']).default('apply'),
    manifest: sceneManifestSchema.optional(),
  }),
});

export const sceneConstraintsLockedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('scene.constraints-locked'),
  payload: z.object({
    sessionId: z.string().uuid(),
    sceneId: z.string().min(1),
    shellRevision: z.number().int().nonnegative(),
    spatialAnchors: spatialAnchorSetSchema,
  }),
});

export const sceneMutationRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
});

export const sceneMutationResultSchema = z.object({
  sceneId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  operation: z.enum(['apply', 'undo', 'redo']),
  commandId: z.string().min(1),
  manifest: sceneManifestSchema,
  diagnostics: z.record(z.string(), z.unknown()).default({}),
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
    errorCode: z.string().regex(/^[a-z][a-z0-9_]*$/),
    errorMessage: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    retryable: z.boolean(),
  }),
});

export const decorationAnalysisRequestedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('decoration-analysis.requested'),
  payload: z.object({
    jobId: z.string().uuid(),
    analysisId: z.string().uuid(),
    sessionId: z.string().uuid(),
    sourceKind: z.enum(['image', 'text']),
    assetId: z.string().min(1).optional(),
    storageKey: z.string().min(1).optional(),
    expectedMediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    expectedSizeBytes: z.number().int().positive().max(30 * 1024 * 1024).optional(),
    brief: z.string().max(2_000),
  }),
});

export const decorationAnalysisProgressedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('decoration-analysis.progressed'),
  payload: z.object({
    jobId: z.string().uuid(),
    status: z.enum(['validating-file', 'recognizing']),
    progress: z.number().min(0).max(1),
    message: z.string().min(1),
  }),
});

export const decorationAnalysisCompletedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('decoration-analysis.completed'),
  payload: z.object({
    jobId: z.string().uuid(),
    analysis: decorationAnalysisSchema,
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    detectedMediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    widthPixels: z.number().int().positive().optional(),
    heightPixels: z.number().int().positive().optional(),
  }),
});

export const decorationAnalysisFailedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('decoration-analysis.failed'),
  payload: z.object({
    jobId: z.string().uuid(),
    assetId: z.string().min(1).optional(),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
    retryable: z.boolean(),
  }),
});

export const assetGenerationRequestedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('asset-generation.requested'),
  payload: z.object({
    jobId: z.string().uuid(),
    request: assetGenerationRequestSchema,
    attempt: z.number().int().positive(),
  }),
});

export const assetGenerationProgressedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('asset-generation.progressed'),
  payload: z.object({
    jobId: z.string().uuid(),
    status: z.enum(['submitting', 'generating', 'downloading', 'normalizing']),
    progress: z.number().min(0).max(1),
    externalTaskId: z.string().min(1).optional(),
    message: z.string().min(1),
    providerEvidence: providerEvidenceSchema.optional(),
  }),
});

export const assetGenerationCompletedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('asset-generation.completed'),
  payload: z.object({
    jobId: z.string().uuid(),
    externalTaskId: z.string().min(1),
    sourceGlbAssetId: z.string().min(1),
    normalizedGlbAssetId: z.string().min(1),
    transform: normalizedAssetTransformSchema,
    providerEvidence: providerEvidenceSchema,
  }),
});

export const assetGenerationFailedEventSchema = eventMetadataSchema.extend({
  eventType: z.literal('asset-generation.failed'),
  payload: z.object({
    jobId: z.string().uuid(),
    externalTaskId: z.string().min(1).optional(),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
    retryable: z.boolean(),
    providerEvidence: providerEvidenceSchema,
  }),
});

export const platformEventSchema = z.discriminatedUnion('eventType', [
  generationRequestedEventSchema,
  generationProgressedEventSchema,
  generationCompletedEventSchema,
  generationFailedEventSchema,
  sceneRevisionCreatedEventSchema,
  sceneConstraintsLockedEventSchema,
  floorPlanValidationRequestedEventSchema,
  floorPlanProgressedEventSchema,
  floorPlanValidatedEventSchema,
  floorPlanRejectedEventSchema,
  decorationAnalysisRequestedEventSchema,
  decorationAnalysisProgressedEventSchema,
  decorationAnalysisCompletedEventSchema,
  decorationAnalysisFailedEventSchema,
  assetGenerationRequestedEventSchema,
  assetGenerationProgressedEventSchema,
  assetGenerationCompletedEventSchema,
  assetGenerationFailedEventSchema,
]);

export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export function canRetrySourceVisual(job: Pick<GenerationJob, 'errorCode' | 'errorMessage' | 'providerEvidence'>): boolean {
  return !job.providerEvidence?.externalTaskId && (
    job.errorCode === 'provider_insufficient_credits'
    || (job.errorCode === 'provider_request_failed' && /credit not enough|insufficient credits?/i.test(job.errorMessage ?? ''))
  );
}
export type GenerationRequestedEvent = z.infer<typeof generationRequestedEventSchema>;
export type PlatformEvent = z.infer<typeof platformEventSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type HousingLayoutSource = z.infer<typeof housingLayoutSourceSchema>;
export type HousingExperienceStage = z.infer<typeof housingExperienceStageSchema>;
export type WallpaperPreset = z.infer<typeof wallpaperPresetSchema>;
export type DecorationRequest = z.infer<typeof decorationRequestSchema>;
export type StructuredFloorPlan = z.infer<typeof structuredFloorPlanSchema>;
export type BasicFurnitureKind = z.infer<typeof basicFurnitureKindSchema>;
export { pointInPlanPolygon, floorPlacementIssue, isStairRoom, type PlanFootprint } from './floorPlacement.js';
export type UploadIntentRequest = z.infer<typeof uploadIntentRequestSchema>;
export type UploadIntent = z.infer<typeof uploadIntentSchema>;
export type FloorPlanJob = z.infer<typeof floorPlanJobSchema>;
export type HousingSession = z.infer<typeof housingSessionSchema>;
export type SceneManifest = z.infer<typeof sceneManifestSchema>;
export type SpatialAnchorSet = z.infer<typeof spatialAnchorSetSchema>;
export type ProviderEvidence = z.infer<typeof providerEvidenceSchema>;
export type DecorationAnalysis = z.infer<typeof decorationAnalysisSchema>;
export type DecorationObjectCandidate = z.infer<typeof decorationObjectCandidateSchema>;
export type DecorationAnalysisJob = z.infer<typeof decorationAnalysisJobSchema>;
export type AssetGenerationRequest = z.infer<typeof assetGenerationRequestSchema>;
export type AssetGenerationJob = z.infer<typeof assetGenerationJobSchema>;
export type NormalizedAssetTransform = z.infer<typeof normalizedAssetTransformSchema>;
export type SceneMutationResult = z.infer<typeof sceneMutationResultSchema>;

export const eventSubject = (event: PlatformEvent): string => (
  `${event.eventType}.v${event.version}`
);
