import { connect } from '@nats-io/transport-node';
import { AckPolicy, DeliverPolicy, jetstream, jetstreamManager } from '@nats-io/jetstream';
import { assetGenerationRequestedEventSchema, eventSubject, type PlatformEvent } from '@spatial-intelligence/contracts';
import { AssetGenerationProcessor } from './processor.js';
import { createS3AssetStorage } from './storage.js';

const STREAM = 'MYSPACE_EVENTS';
const CONSUMER = 'asset-generation-workers';
const SUBJECTS = [
  'generation.*.v1', 'floor-plan.*.v1', 'decoration-analysis.*.v1',
  'asset-generation.*.v1', 'scene.*.v1',
];
const connection = await connect({
  servers: process.env.NATS_URL ?? 'nats://127.0.0.1:4222',
  name: 'asset-generation-service',
});
const manager = await jetstreamManager(connection);
try {
  const info = await manager.streams.info(STREAM);
  if (!SUBJECTS.every((subject) => info.config.subjects?.includes(subject))) {
    await manager.streams.update(STREAM, { ...info.config, subjects: [...new Set([...(info.config.subjects ?? []), ...SUBJECTS])] });
  }
} catch {
  await manager.streams.add({ name: STREAM, subjects: SUBJECTS });
}
try {
  await manager.consumers.info(STREAM, CONSUMER);
} catch {
  await manager.consumers.add(STREAM, {
    durable_name: CONSUMER,
    filter_subject: 'asset-generation.requested.v1',
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    ack_wait: 20 * 60 * 1_000_000_000,
    max_ack_pending: 4,
  });
}
const js = jetstream(connection);
const processor = new AssetGenerationProcessor({
  storage: createS3AssetStorage(),
  publisher: {
    publish: async (event: PlatformEvent) => {
      await js.publish(eventSubject(event), new TextEncoder().encode(JSON.stringify(event)), { msgID: event.eventId });
    },
  },
});
const messages = await (await js.consumers.get(STREAM, CONSUMER)).consume({ max_messages: 4 });
const shutdown = async () => { await messages.close(); await connection.drain(); };
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

for await (const message of messages) {
  const parsed = assetGenerationRequestedEventSchema.safeParse(message.json());
  if (!parsed.success) { message.term('invalid asset generation request'); continue; }
  try {
    await processor.process(parsed.data);
    message.ack();
  } catch {
    message.nak(1_000);
  }
}
