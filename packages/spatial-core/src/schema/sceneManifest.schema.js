import { z } from 'zod';
import { FrameworkError } from '../errors/FrameworkError.js';

export const transformSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([0, 0, 0, 1]),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
});

const identityTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['splat', 'mesh', 'texture', 'material', 'audio', 'video', 'data', 'other']),
  uri: z.string().min(1),
  format: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const entitySchema = z.object({
  id: z.string().min(1),
  label: z.string().default(''),
  kind: z.string().min(1),
  parentId: z.string().min(1).nullable().default(null),
  transform: transformSchema.default(identityTransform),
  assetRefs: z.array(z.string().min(1)).default([]),
  components: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  interactive: z.boolean().default(false),
});

export const behaviorSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  handler: z.string().min(1),
  enabled: z.boolean().default(true),
  targetEntityIds: z.array(z.string().min(1)).default([]),
  trigger: z.object({
    eventType: z.string().min(1),
    source: z.string().default('user'),
  }),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const interactionBindingSchema = z.object({
  id: z.string().min(1),
  inputType: z.string().min(1),
  eventType: z.string().min(1),
  behaviorId: z.string().min(1),
  filter: z.record(z.string(), z.unknown()).default({}),
});

export const sceneManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sceneId: z.string().min(1),
  revision: z.number().int().nonnegative().default(0),
  coordinateSystem: z.object({
    upAxis: z.enum(['X', 'Y', 'Z']).default('Y'),
    unit: z.enum(['meter', 'centimeter', 'millimeter']).default('meter'),
    handedness: z.enum(['left', 'right']).default('right'),
  }).default({ upAxis: 'Y', unit: 'meter', handedness: 'right' }),
  sourceRefs: z.array(z.string()).default([]),
  assets: z.array(assetSchema).default([]),
  entities: z.array(entitySchema).default([]),
  behaviors: z.array(behaviorSchema).default([]),
  interactions: z.array(interactionBindingSchema).default([]),
  environment: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const assertUnique = (items, label) => {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new FrameworkError('duplicate_id', `Duplicate ${label} id: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
};

export function parseSceneManifest(input) {
  const manifest = sceneManifestSchema.parse(input);
  const assetIds = assertUnique(manifest.assets, 'asset');
  const entityIds = assertUnique(manifest.entities, 'entity');
  const behaviorIds = assertUnique(manifest.behaviors, 'behavior');
  assertUnique(manifest.interactions, 'interaction');

  for (const entity of manifest.entities) {
    if (entity.parentId && !entityIds.has(entity.parentId)) {
      throw new FrameworkError('missing_parent', `Entity ${entity.id} references missing parent ${entity.parentId}`);
    }
    for (const assetRef of entity.assetRefs) {
      if (!assetIds.has(assetRef)) {
        throw new FrameworkError('missing_asset', `Entity ${entity.id} references missing asset ${assetRef}`);
      }
    }
  }

  for (const behavior of manifest.behaviors) {
    for (const entityId of behavior.targetEntityIds) {
      if (!entityIds.has(entityId)) {
        throw new FrameworkError('missing_target', `Behavior ${behavior.id} references missing entity ${entityId}`);
      }
    }
  }

  for (const interaction of manifest.interactions) {
    if (!behaviorIds.has(interaction.behaviorId)) {
      throw new FrameworkError('missing_behavior', `Interaction ${interaction.id} references missing behavior ${interaction.behaviorId}`);
    }
  }

  return manifest;
}
