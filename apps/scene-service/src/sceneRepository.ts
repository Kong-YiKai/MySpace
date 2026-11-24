import { Pool, type PoolClient } from 'pg';
import {
  commandEnvelopeSchema,
  sceneManifestSchema,
  sceneMutationResultSchema,
  spatialAnchorSetSchema,
  type CommandEnvelope,
  type SceneManifest,
  type SceneMutationResult,
  type SpatialAnchorSet,
} from '@spatial-intelligence/contracts';
import { SpatialRuntime } from '@spatial-intelligence/core';
import { validateSceneMutation } from './spatialConstraints.js';

export class SceneRepository {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({ connectionString, max: 8 });
  }

  async initialize(manifestInput: SceneManifest, occurredAt: string): Promise<void> {
    const manifest = sceneManifestSchema.parse(manifestInput);
    await this.#transaction(async (client) => {
      const existing = await client.query(
        'SELECT current_revision FROM scene_service.scenes WHERE scene_id=$1 FOR UPDATE',
        [manifest.sceneId],
      );
      if (existing.rowCount && Number(existing.rows[0].current_revision) > manifest.revision) return;
      await client.query(
        `INSERT INTO scene_service.scenes (scene_id, current_revision, manifest, created_at, updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$4)
         ON CONFLICT (scene_id) DO UPDATE SET
           current_revision=EXCLUDED.current_revision, manifest=EXCLUDED.manifest, updated_at=EXCLUDED.updated_at`,
        [manifest.sceneId, manifest.revision, JSON.stringify(manifest), occurredAt],
      );
      await client.query(
        `INSERT INTO scene_service.revisions (scene_id, revision, operation, manifest, created_at)
         VALUES ($1,$2,'initialize',$3::jsonb,$4)
         ON CONFLICT (scene_id, revision) DO NOTHING`,
        [manifest.sceneId, manifest.revision, JSON.stringify(manifest), occurredAt],
      );
    });
  }

  async mergeVisualLayer(manifestInput: SceneManifest, occurredAt: string): Promise<void> {
    const incoming = sceneManifestSchema.parse(manifestInput);
    await this.#transaction(async (client) => {
      const existing = await client.query(
        'SELECT manifest FROM scene_service.scenes WHERE scene_id=$1 FOR UPDATE',
        [incoming.sceneId],
      );
      if (!existing.rowCount) {
        await client.query(
          `INSERT INTO scene_service.scenes (scene_id, current_revision, manifest, created_at, updated_at)
           VALUES ($1,$2,$3::jsonb,$4,$4)`,
          [incoming.sceneId, incoming.revision, JSON.stringify(incoming), occurredAt],
        );
        await client.query(
          `INSERT INTO scene_service.revisions (scene_id, revision, operation, manifest, created_at)
           VALUES ($1,$2,'initialize',$3::jsonb,$4)
           ON CONFLICT (scene_id, revision) DO NOTHING`,
          [incoming.sceneId, incoming.revision, JSON.stringify(incoming), occurredAt],
        );
        return;
      }

      const current = sceneManifestSchema.parse(existing.rows[0].manifest);
      const merged = mergeVisualLayerManifest(current, incoming);
      await this.#saveRevision(client, incoming.sceneId, merged, 'visual-layer-merge', null, {
        providerId: asRecord(incoming.metadata.providerEvidence)?.providerId,
        preservedEntityCount: current.entities.filter((entity) => !isVisualEntity(entity)).length,
      }, occurredAt);
    });
  }

  async lockConstraints(anchorsInput: SpatialAnchorSet, occurredAt: string): Promise<void> {
    const anchors = spatialAnchorSetSchema.parse(anchorsInput);
    await this.#pool.query(
      `UPDATE scene_service.scenes SET shell_revision=$2, spatial_constraints=$3::jsonb, updated_at=$4
       WHERE scene_id=$1`,
      [anchors.sceneId, anchors.shellRevision, JSON.stringify(anchors), occurredAt],
    );
  }

  async get(sceneId: string): Promise<{ manifest: SceneManifest; anchors: SpatialAnchorSet | null } | null> {
    const result = await this.#pool.query(
      'SELECT manifest, spatial_constraints FROM scene_service.scenes WHERE scene_id=$1',
      [sceneId],
    );
    if (!result.rowCount) return null;
    return {
      manifest: sceneManifestSchema.parse(result.rows[0].manifest),
      anchors: result.rows[0].spatial_constraints
        ? spatialAnchorSetSchema.parse(result.rows[0].spatial_constraints) : null,
    };
  }

  async applyCommand(
    sceneId: string,
    envelopeInput: CommandEnvelope,
    confirmed: boolean,
    occurredAt: string,
  ): Promise<SceneMutationResult> {
    const envelope = commandEnvelopeSchema.parse(envelopeInput);
    return this.#transaction(async (client) => {
      const duplicate = await client.query(
        'SELECT scene_id, after_manifest FROM scene_service.commands WHERE command_id=$1',
        [envelope.commandId],
      );
      if (duplicate.rowCount) {
        if (duplicate.rows[0].scene_id !== sceneId) throw sceneError('command_id_conflict', 'commandId 已被另一场景使用', 409);
        const manifest = sceneManifestSchema.parse(duplicate.rows[0].after_manifest);
        return result(sceneId, manifest, 'apply', envelope.commandId, { idempotentReplay: true });
      }
      const row = await this.#lockScene(client, sceneId);
      this.#assertRevision(envelope.baseRevision, row.manifest.revision);
      if (!row.anchors) throw sceneError('spatial_constraints_missing', '场景尚未锁定空间约束', 409);
      const runtime = new SpatialRuntime({ manifest: row.manifest });
      const executed = await runtime.execute(envelope, { confirmed });
      const next = sceneManifestSchema.parse(executed.manifest);
      const diagnostics = validateSceneMutation(row.manifest, next, envelope, row.anchors);
      await client.query(
        `UPDATE scene_service.commands SET status='superseded', updated_at=$2
         WHERE scene_id=$1 AND status='undone'`,
        [sceneId, occurredAt],
      );
      await client.query(
        `INSERT INTO scene_service.commands (
          command_id, scene_id, applied_revision, envelope, before_manifest, after_manifest, status,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,'applied',$7,$7)`,
        [envelope.commandId, sceneId, next.revision, JSON.stringify(envelope),
          JSON.stringify(row.manifest), JSON.stringify(next), occurredAt],
      );
      await this.#saveRevision(client, sceneId, next, 'apply', envelope.commandId, { ...diagnostics }, occurredAt);
      return result(sceneId, next, 'apply', envelope.commandId, { ...diagnostics });
    });
  }

  async undo(sceneId: string, baseRevision: number, occurredAt: string): Promise<SceneMutationResult> {
    return this.#transaction(async (client) => {
      const row = await this.#lockScene(client, sceneId);
      this.#assertRevision(baseRevision, row.manifest.revision);
      const command = await client.query(
        `SELECT * FROM scene_service.commands
         WHERE scene_id=$1 AND status='applied' ORDER BY applied_revision DESC LIMIT 1 FOR UPDATE`,
        [sceneId],
      );
      if (!command.rowCount) throw sceneError('undo_empty', '没有可撤销的场景命令', 409);
      const targetId = String(command.rows[0].command_id);
      const next = sceneManifestSchema.parse({
        ...command.rows[0].before_manifest,
        revision: row.manifest.revision + 1,
      });
      await client.query(
        `UPDATE scene_service.commands SET status='undone', updated_at=$2 WHERE command_id=$1`,
        [targetId, occurredAt],
      );
      const commandId = `undo:${targetId}:${next.revision}`;
      const diagnostics = { targetCommandId: targetId };
      await this.#saveRevision(client, sceneId, next, 'undo', commandId, diagnostics, occurredAt);
      return result(sceneId, next, 'undo', commandId, diagnostics);
    });
  }

  async redo(sceneId: string, baseRevision: number, occurredAt: string): Promise<SceneMutationResult> {
    return this.#transaction(async (client) => {
      const row = await this.#lockScene(client, sceneId);
      this.#assertRevision(baseRevision, row.manifest.revision);
      const command = await client.query(
        `SELECT * FROM scene_service.commands
         WHERE scene_id=$1 AND status='undone' ORDER BY applied_revision ASC LIMIT 1 FOR UPDATE`,
        [sceneId],
      );
      if (!command.rowCount) throw sceneError('redo_empty', '没有可重做的场景命令', 409);
      const targetId = String(command.rows[0].command_id);
      const next = sceneManifestSchema.parse({
        ...command.rows[0].after_manifest,
        revision: row.manifest.revision + 1,
      });
      await client.query(
        `UPDATE scene_service.commands SET status='applied', updated_at=$2 WHERE command_id=$1`,
        [targetId, occurredAt],
      );
      const commandId = `redo:${targetId}:${next.revision}`;
      const diagnostics = { targetCommandId: targetId };
      await this.#saveRevision(client, sceneId, next, 'redo', commandId, diagnostics, occurredAt);
      return result(sceneId, next, 'redo', commandId, diagnostics);
    });
  }

  async close(): Promise<void> { await this.#pool.end(); }

  async #lockScene(client: PoolClient, sceneId: string): Promise<{ manifest: SceneManifest; anchors: SpatialAnchorSet | null }> {
    const query = await client.query(
      'SELECT manifest, spatial_constraints FROM scene_service.scenes WHERE scene_id=$1 FOR UPDATE',
      [sceneId],
    );
    if (!query.rowCount) throw sceneError('scene_not_found', '场景不存在', 404);
    return {
      manifest: sceneManifestSchema.parse(query.rows[0].manifest),
      anchors: query.rows[0].spatial_constraints
        ? spatialAnchorSetSchema.parse(query.rows[0].spatial_constraints) : null,
    };
  }

  #assertRevision(baseRevision: number | undefined, currentRevision: number): void {
    if (baseRevision === undefined || baseRevision !== currentRevision) {
      throw sceneError(
        'revision_conflict',
        `场景版本冲突：请求 ${baseRevision ?? 'missing'}，当前 ${currentRevision}`,
        409,
        { currentRevision },
      );
    }
  }

  async #saveRevision(
    client: PoolClient,
    sceneId: string,
    manifest: SceneManifest,
    operation: 'apply' | 'undo' | 'redo' | 'visual-layer-merge',
    commandId: string | null,
    diagnostics: Record<string, unknown>,
    occurredAt: string,
  ): Promise<void> {
    await client.query(
      `UPDATE scene_service.scenes SET current_revision=$2, manifest=$3::jsonb, updated_at=$4 WHERE scene_id=$1`,
      [sceneId, manifest.revision, JSON.stringify(manifest), occurredAt],
    );
    await client.query(
      `INSERT INTO scene_service.revisions (
        scene_id, revision, operation, command_id, manifest, diagnostics, created_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [sceneId, manifest.revision, operation, commandId,
        JSON.stringify(manifest), JSON.stringify(diagnostics), occurredAt],
    );
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export function mergeVisualLayerManifest(current: SceneManifest, incoming: SceneManifest): SceneManifest {
  if (current.sceneId !== incoming.sceneId) {
    throw new Error('visual_layer_scene_mismatch');
  }

  const assets = new Map(
    current.assets
      .filter((asset) => !isVisualAsset(asset))
      .map((asset) => [asset.id, asset]),
  );
  for (const asset of incoming.assets.filter(isVisualAsset)) assets.set(asset.id, asset);

  const entities = new Map(
    current.entities
      .filter((entity) => !isVisualEntity(entity))
      .map((entity) => [entity.id, entity]),
  );
  for (const entity of incoming.entities.filter(isVisualEntity)) entities.set(entity.id, entity);

  return sceneManifestSchema.parse({
    ...current,
    revision: current.revision + 1,
    sourceRefs: [...new Set([...current.sourceRefs, ...incoming.sourceRefs])],
    assets: [...assets.values()],
    entities: [...entities.values()],
    metadata: {
      ...current.metadata,
      ...incoming.metadata,
    },
  });
}

function isVisualAsset(asset: SceneManifest['assets'][number]): boolean {
  return asset.kind === 'splat'
    || asset.metadata.role === 'shell-splat'
    || asset.metadata.role === 'generated-panorama'
    || asset.metadata.visualLayer === 'aholo-3dgs';
}

function isVisualEntity(entity: SceneManifest['entities'][number]): boolean {
  return entity.kind === 'splat-shell' || entity.tags.includes('aholo-visual-layer');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function result(
  sceneId: string,
  manifest: SceneManifest,
  operation: 'apply' | 'undo' | 'redo',
  commandId: string,
  diagnostics: Record<string, unknown>,
): SceneMutationResult {
  return sceneMutationResultSchema.parse({
    sceneId, revision: manifest.revision, operation, commandId, manifest, diagnostics,
  });
}

export function sceneError(
  code: string,
  message: string,
  statusCode = 422,
  details?: Record<string, unknown>,
): Error {
  return Object.assign(new Error(message), { code, statusCode, details });
}
