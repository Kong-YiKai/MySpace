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
import { GenerationProcessor } from './processor.js';
import { shellProvider } from './shellProvider.js';

const STREAM = 'MYSPACE_EVENTS';
const CONSUMER = 'generation-workers';
const natsUrl = process.env.NATS_URL ?? 'nats://127.0.0.1:4222';
const connection = await connect({ servers: natsUrl, name: 'generation-worker' });
const manager = await jetstreamManager(connection);
try {
  await manager.streams.info(STREAM);
} catch {
  await manager.streams.add({
    name: STREAM,
    subjects: ['generation.*.v1', 'floor-plan.*.v1', 'scene.*.v1'],
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
if (process.env.ENABLE_FAKE_PROVIDER === 'true') {
  providers.register({
    id: 'fake-provider',
    generate: async (
      request: { requestId: string; sources: Array<{ id: string }> },
      context: { onProgress: (event: Record<string, unknown>) => void },
    ) => {
      context.onProgress({ stage: 'generating', progress: 0.38, message: '已理解需求，正在规划家具动线…' });
      context.onProgress({ stage: 'generating', progress: 0.72, message: '正在生成家具与软装材质…' });
      return {
        schemaVersion: '1.0',
        sceneId: `decor-${request.requestId}`,
        sourceRefs: request.sources.map((source) => source.id),
      };
    },
  });
}

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

const shutdown = async () => {
  await messages.close();
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
  try {
    await processor.process(parsed.data);
    message.ack();
  } catch {
    message.nak(1000);
  }
}
