import { z } from 'zod';
import { behaviorSchema, entitySchema, transformSchema } from './sceneManifest.schema.js';

const addEntityCommand = z.object({ type: z.literal('ADD_ENTITY'), entity: entitySchema });
const removeEntityCommand = z.object({
  type: z.literal('REMOVE_ENTITY'),
  entityId: z.string().min(1),
  cascade: z.boolean().default(false),
});
const setTransformCommand = z.object({
  type: z.literal('SET_TRANSFORM'),
  entityId: z.string().min(1),
  transform: transformSchema,
});
const setComponentCommand = z.object({
  type: z.literal('SET_COMPONENT'),
  entityId: z.string().min(1),
  component: z.string().min(1),
  value: z.unknown(),
});
const removeComponentCommand = z.object({
  type: z.literal('REMOVE_COMPONENT'),
  entityId: z.string().min(1),
  component: z.string().min(1),
});
const attachAssetCommand = z.object({
  type: z.literal('ATTACH_ASSET'),
  entityId: z.string().min(1),
  assetRef: z.string().min(1),
});
const detachAssetCommand = z.object({
  type: z.literal('DETACH_ASSET'),
  entityId: z.string().min(1),
  assetRef: z.string().min(1),
});
const addBehaviorCommand = z.object({ type: z.literal('ADD_BEHAVIOR'), behavior: behaviorSchema });
const removeBehaviorCommand = z.object({ type: z.literal('REMOVE_BEHAVIOR'), behaviorId: z.string().min(1) });
const triggerBehaviorCommand = z.object({
  type: z.literal('TRIGGER_BEHAVIOR'),
  behaviorId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const setEnvironmentCommand = z.object({
  type: z.literal('SET_ENVIRONMENT_PROPERTY'),
  key: z.string().min(1),
  value: z.unknown(),
});

export const sceneCommandSchema = z.discriminatedUnion('type', [
  addEntityCommand,
  removeEntityCommand,
  setTransformCommand,
  setComponentCommand,
  removeComponentCommand,
  attachAssetCommand,
  detachAssetCommand,
  addBehaviorCommand,
  removeBehaviorCommand,
  triggerBehaviorCommand,
  setEnvironmentCommand,
]);

export const commandEnvelopeSchema = z.object({
  commandId: z.string().min(1),
  baseRevision: z.number().int().nonnegative().optional(),
  commands: z.array(sceneCommandSchema).min(1).max(100),
  explanation: z.string().default(''),
  requiresConfirmation: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
