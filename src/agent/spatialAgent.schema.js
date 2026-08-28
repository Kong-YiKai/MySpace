import { z } from 'zod';

export const SPATIAL_AGENT_SCHEMA = 'spatial-agent.v1';

const finiteNumber = z.number().finite();
const vector3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);

export const spatialEntitySnapshotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().min(1),
  position: vector3Schema,
  semantic: z.object({
    category: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    abilities: z.array(z.string().min(1)).max(16).default([]),
  }).default({}),
  affordances: z.array(z.string().min(1)).max(16).default([]),
});

export const spatialPlotSnapshotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  position: vector3Schema,
  occupiedBy: z.string().min(1).nullable().default(null),
  capacity: z.number().int().min(1).max(8).default(1),
});

export const spatialAgentSceneSchema = z.object({
  sceneId: z.string().min(1),
  revision: z.number().int().nonnegative().default(0),
  coordinateSystem: z.object({
    upAxis: z.enum(['X', 'Y', 'Z']).default('Y'),
    unit: z.enum(['meter', 'centimeter', 'millimeter']).default('meter'),
    handedness: z.enum(['left', 'right']).default('right'),
  }).default({}),
  entities: z.array(spatialEntitySnapshotSchema).max(128).default([]),
  plots: z.array(spatialPlotSnapshotSchema).max(32).default([]),
});

const imageSnapshotSchema = z.object({
  dataUrl: z.string()
    .min(32)
    .max(5_800_000)
    .regex(/^data:image\/(?:png|jpeg|webp);base64,/i, '截图必须是 PNG、JPEG 或 WebP data URL'),
  detail: z.enum(['low', 'high', 'auto']).default('low'),
});

const visualReferenceSchema = imageSnapshotSchema.extend({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(180),
  // 九张 192px JPEG 三机位图总量受服务端 8.2MB 请求上限约束。
  dataUrl: z.string()
    .min(32)
    .max(180_000)
    .regex(/^data:image\/(?:png|jpeg|webp);base64,/i, '视觉参考图必须是 PNG、JPEG 或 WebP data URL'),
});

export const spatialAgentRequestSchema = z.object({
  requestId: z.string().min(1).max(80).optional(),
  question: z.string().min(1).max(1_200),
  scene: spatialAgentSceneSchema,
  screenshot: imageSnapshotSchema.nullable().optional(),
  referenceImages: z.array(visualReferenceSchema).max(9).default([]),
  targetImages: z.array(visualReferenceSchema).max(3).default([]),
});

const focusEntityActionSchema = z.object({
  type: z.literal('focus_entity'),
  entityId: z.string().min(1),
  reason: z.string().min(1).max(280).optional(),
});

const recommendPlotActionSchema = z.object({
  type: z.literal('recommend_plot'),
  plotId: z.string().min(1),
  targetEntityId: z.string().min(1).optional(),
  reason: z.string().min(1).max(280),
});

const proposeDeploymentActionSchema = z.object({
  type: z.literal('propose_deployment'),
  entityId: z.string().min(1),
  plotId: z.string().min(1),
  reason: z.string().min(1).max(280),
});

export const spatialAgentActionSchema = z.discriminatedUnion('type', [
  focusEntityActionSchema,
  recommendPlotActionSchema,
  proposeDeploymentActionSchema,
]);

export const spatialAgentDirectiveSchema = z.object({
  schemaVersion: z.literal(SPATIAL_AGENT_SCHEMA),
  answer: z.string().min(1).max(1_400),
  confidence: z.number().min(0).max(1).default(0.5),
  observations: z.array(z.object({
    entityId: z.string().min(1).optional(),
    statement: z.string().min(1).max(320),
  })).max(8).default([]),
  actions: z.array(spatialAgentActionSchema).max(3).default([]),
  // 神秘种子巡检只输出受限的视觉判断；真正修改花园仍由本地状态机执行。
  visualAssessment: z.object({
    entityId: z.string().min(1),
    speciesId: z.enum(['peaShooter', 'cornPult', 'watermelonPult']),
    confidence: z.number().min(0).max(1),
    recommendation: z.enum(['keep', 'uproot']),
    reason: z.string().min(1).max(280),
  }).nullable().default(null),
});

export const openAICompatibleVisionConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  jsonMode: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(45_000),
});
