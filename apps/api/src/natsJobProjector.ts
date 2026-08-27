import {
  connect,
  type NatsConnection,
  type Subscription,
} from '@nats-io/transport-node';
import { platformEventSchema } from '@spatial-intelligence/contracts';
import type { GenerationJobRepository } from './ports.js';

export class NatsJobProjector {
  readonly #connection: NatsConnection;
  readonly #jobs: GenerationJobRepository;
  #subscription: Subscription | null = null;
  #consumePromise: Promise<void> | null = null;

  private constructor(connection: NatsConnection, jobs: GenerationJobRepository) {
    this.#connection = connection;
    this.#jobs = jobs;
  }

  static async connect(servers: string, jobs: GenerationJobRepository): Promise<NatsJobProjector> {
    return new NatsJobProjector(
      await connect({ servers, name: 'spatial-api-job-projector' }),
      jobs,
    );
  }

  start(): void {
    if (this.#subscription) return;
    this.#subscription = this.#connection.subscribe('generation.*.v1', {
      queue: 'api-job-projectors',
    });
    this.#consumePromise = this.#consume(this.#subscription);
  }

  async close(): Promise<void> {
    this.#subscription?.unsubscribe();
    await this.#connection.drain();
    await this.#consumePromise;
  }

  async #consume(subscription: Subscription): Promise<void> {
    for await (const message of subscription) {
      const parsed = platformEventSchema.safeParse(message.json());
      if (!parsed.success) continue;
      await this.#jobs.apply(parsed.data);
    }
  }
}
