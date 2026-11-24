import { connect } from '@nats-io/transport-node';
import {
  AckPolicy,
  DeliverPolicy,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import {
  eventSubject,
  generationRequestedEventSchema,
  type PlatformEvent,
} from '@spatial-intelligence/contracts';
import { GenerationPipeline, ProviderRegistry } from '@spatial-intelligence/core';
import { createAholoWorldProvider } from './aholoWorldProvider.js';
import { GenerationProcessor } from './processor.js';
import { shellProvider } from './shellProvider.js';

const STREAM = 'MYSPACE_EVENTS';
const CONSUMER = 'generation-workers';
const natsUrl = process.env.NATS_URL ?? 'nats://127.0.0.1:4222';
const connection = await connect({
  servers: natsUrl,
  name: 'generation-worker',
  maxReconnectAttempts: -1,
  reconnectTimeWait: 1_000,
});
const manager = await jetstreamManager(connection);
try {
  const info = await manager.streams.info(STREAM);
  const subjects = ['generation.*.v1', 'floor-plan.*.v1', 'decoration-analysis.*.v1', 'asset-generation.*.v1', 'scene.*.v1'];
  if (!subjects.every((subject) => info.config.subjects?.includes(subject))) {
    await manager.streams.update(STREAM, {
      ...info.config,
      subjects: [...new Set([...(info.config.subjects ?? []), ...subjects])],
    });
  }
} catch {
  await manager.streams.add({
    name: STREAM,
    subjects: ['generation.*.v1', 'floor-plan.*.v1', 'decoration-analysis.*.v1', 'asset-generation.*.v1', 'scene.*.v1'],
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
    duplicate_window: 2 * 60 * 1_000_000_000,
  });
}
try {
  await manager.consumers.info(STREAM, CONSUMER);
} catch {
  await manager.consumers.add(STREAM, {
    durable_name: CONSUMER,
    filter_subject: 'generation.requested.v1',
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    ack_wait: 60 * 1_000_000_000,
    max_ack_pending: 16,
  });
}

const providers = new ProviderRegistry();
providers.register(shellProvider);
providers.register(createAholoWorldProvider());

const js = jetstream(connection);
const publisher = {
  publish: async (event: PlatformEvent) => {
    await js.publish(
      eventSubject(event),
      new TextEncoder().encode(JSON.stringify(event)),
      { msgID: event.eventId },
    );
  },
};
const processor = new GenerationProcessor({
  pipeline: new GenerationPipeline({ providers }),
  publisher,
});
const consumer = await js.consumers.get(STREAM, CONSUMER);
const messages = await consumer.consume({ max_messages: 8 });

const inFlight = new Set<Promise<void>>();
const controllers = new Map<string, AbortController>();
const resets = connection.subscribe('myspace.ephemeral.reset.v1');
const resetLoop = (async () => {
  for await (const _message of resets) {
    for (const controller of controllers.values()) controller.abort();
  }
})();
const shutdown = async () => {
  for (const controller of controllers.values()) controller.abort();
  resets.unsubscribe();
  await messages.close();
  await Promise.allSettled(inFlight);
  await resetLoop;
  await connection.drain();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

for await (const message of messages) {
  const parsed = generationRequestedEventSchema.safeParse(message.json());
  if (!parsed.success) {
    message.term('invalid generation request');
    continue;
  }
  const controller = new AbortController();
  controllers.set(parsed.data.payload.jobId, controller);
  const task = processor.process(parsed.data, controller.signal)
    .then(() => message.ack())
    .catch(() => message.nak(1000))
    .finally(() => {
      controllers.delete(parsed.data.payload.jobId);
      inFlight.delete(task);
    });
  inFlight.add(task);
  if (inFlight.size >= 8) await Promise.race(inFlight);
}
await Promise.allSettled(inFlight);
