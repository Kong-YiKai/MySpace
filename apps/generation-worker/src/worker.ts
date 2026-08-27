import { connect } from '@nats-io/transport-node';
import {
  eventSubject,
  generationRequestedEventSchema,
  platformEventSchema,
  type PlatformEvent,
} from '@spatial-intelligence/contracts';
import { GenerationPipeline, ProviderRegistry } from '@spatial-intelligence/core';
import { GenerationProcessor } from './processor.js';

const natsUrl = process.env.NATS_URL ?? 'nats://127.0.0.1:4222';
const connection = await connect({ servers: natsUrl, name: 'generation-worker' });
const providers = new ProviderRegistry();

if (process.env.ENABLE_FAKE_PROVIDER === 'true') {
  providers.register({
    id: 'fake-provider',
    generate: async (request: { sources: Array<{ id: string }> }) => ({
      schemaVersion: '1.0',
      sceneId: `fake-${Date.now()}`,
      sourceRefs: request.sources.map((source) => source.id),
    }),
  });
}

const publisher = {
  publish: async (event: PlatformEvent) => {
    connection.publish(eventSubject(event), JSON.stringify(event));
    await connection.flush();
  },
};
const processor = new GenerationProcessor({
  pipeline: new GenerationPipeline({ providers }),
  publisher,
});
const subscription = connection.subscribe('generation.requested.v1', {
  queue: 'generation-workers',
});

const shutdown = async () => {
  subscription.unsubscribe();
  await connection.drain();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

for await (const message of subscription) {
  const decoded = message.json();
  const parsed = generationRequestedEventSchema.safeParse(decoded);
  if (!parsed.success) continue;
  await processor.process(parsed.data);
}

void platformEventSchema;
