import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply } from 'fastify';
import { connect } from '@nats-io/transport-node';
import { AckPolicy, DeliverPolicy, jetstream, jetstreamManager } from '@nats-io/jetstream';
import {
  commandEnvelopeSchema,
  eventSubject,
  platformEventSchema,
  sceneMutationRequestSchema,
  sceneRevisionCreatedEventSchema,
  type PlatformEvent,
  type SceneMutationResult,
} from '@spatial-intelligence/contracts';
import { SceneRepository } from './sceneRepository.js';

const STREAM = 'MYSPACE_EVENTS';
const CONSUMER = 'scene-service-projector';
const SUBJECTS = [
  'generation.*.v1', 'floor-plan.*.v1', 'decoration-analysis.*.v1',
  'asset-generation.*.v1', 'scene.*.v1',
];
const now = () => new Date().toISOString();
const repository = new SceneRepository(
  process.env.DATABASE_URL ?? 'postgresql://spatial:spatial@127.0.0.1:5432/spatial',
);
const connection = await connect({
  servers: process.env.NATS_URL ?? 'nats://127.0.0.1:4222',
  name: 'scene-service',
});
const manager = await jetstreamManager(connection);
try {
  const info = await manager.streams.info(STREAM);
  if (!SUBJECTS.every((subject) => info.config.subjects?.includes(subject))) {
    await manager.streams.update(STREAM, {
      ...info.config,
      subjects: [...new Set([...(info.config.subjects ?? []), ...SUBJECTS])],
    });
  }
} catch {
  await manager.streams.add({ name: STREAM, subjects: SUBJECTS });
}
try {
  await manager.consumers.info(STREAM, CONSUMER);
} catch {
  await manager.consumers.add(STREAM, {
    durable_name: CONSUMER,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    ack_wait: 30 * 1_000_000_000,
    max_ack_pending: 128,
  });
}
const js = jetstream(connection);
const messages = await (await js.consumers.get(STREAM, CONSUMER)).consume({ max_messages: 64 });
const projection = (async () => {
  for await (const message of messages) {
    const parsed = platformEventSchema.safeParse(message.json());
    if (!parsed.success) { message.term('invalid platform event'); continue; }
    try {
      if (parsed.data.eventType === 'generation.completed') {
        const manifest = parsed.data.payload.manifest;
        if (manifest.metadata.visualLayer) {
          await repository.mergeVisualLayer(manifest, parsed.data.occurredAt);
        } else {
          await repository.initialize(manifest, parsed.data.occurredAt);
        }
      } else if (parsed.data.eventType === 'scene.constraints-locked') {
        await repository.lockConstraints(parsed.data.payload.spatialAnchors, parsed.data.occurredAt);
      }
      message.ack();
    } catch {
      message.nak(1_000);
    }
  }
})();

const app = Fastify({ logger: true });
app.get('/health', async () => ({ status: 'ok', service: 'scene-service' }));
app.get<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId', async (request, reply) => {
  const scene = await repository.get(request.params.sceneId);
  return scene ?? reply.code(404).send({ error: 'scene_not_found' });
});
app.post<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId/commands', async (request, reply) => {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const parsed = commandEnvelopeSchema.safeParse(body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_scene_command', issues: parsed.error.issues });
  try {
    const result = await repository.applyCommand(
      request.params.sceneId, parsed.data, body.confirmed === true, now(),
    );
    await publishRevision(result);
    return reply.code(201).send(result);
  } catch (error) {
    return sendError(reply, error);
  }
});
app.post<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId/undo', async (request, reply) => {
  const parsed = sceneMutationRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_scene_mutation', issues: parsed.error.issues });
  try {
    const result = await repository.undo(request.params.sceneId, parsed.data.baseRevision, now());
    await publishRevision(result);
    return reply.code(201).send(result);
  } catch (error) {
    return sendError(reply, error);
  }
});
app.post<{ Params: { sceneId: string } }>('/v1/scenes/:sceneId/redo', async (request, reply) => {
  const parsed = sceneMutationRequestSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_scene_mutation', issues: parsed.error.issues });
  try {
    const result = await repository.redo(request.params.sceneId, parsed.data.baseRevision, now());
    await publishRevision(result);
    return reply.code(201).send(result);
  } catch (error) {
    return sendError(reply, error);
  }
});

async function publishRevision(result: SceneMutationResult): Promise<void> {
  const event = sceneRevisionCreatedEventSchema.parse({
    eventId: randomUUID(), eventType: 'scene.revision-created', version: 1,
    occurredAt: now(), traceId: randomUUID(), correlationId: randomUUID(), causationId: null,
    payload: {
      sceneId: result.sceneId,
      revision: result.revision,
      commandId: result.commandId,
      changes: [],
      operation: result.operation,
      manifest: result.manifest,
    },
  });
  await js.publish(eventSubject(event), new TextEncoder().encode(JSON.stringify(event)), { msgID: event.eventId });
}

function sendError(reply: FastifyReply, error: unknown) {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  return reply.code(typeof record.statusCode === 'number' ? record.statusCode : 422).send({
    error: typeof record.code === 'string' ? record.code : 'scene_mutation_failed',
    message: error instanceof Error ? error.message : '场景修改失败',
    ...(record.details && typeof record.details === 'object' ? record.details : {}),
  });
}

await app.listen({
  host: process.env.SCENE_SERVICE_HOST ?? '127.0.0.1',
  port: Number(process.env.SCENE_SERVICE_PORT ?? 3100),
});

const shutdown = async () => {
  await app.close();
  await messages.close();
  await projection;
  await connection.drain();
  await repository.close();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
