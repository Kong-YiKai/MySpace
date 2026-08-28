import type { EventPublisher, PlatformRepository } from './ports.js';

export class OutboxDispatcher {
  readonly #repository: PlatformRepository;
  readonly #publisher: EventPublisher;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(repository: PlatformRepository, publisher: EventPublisher, intervalMs = 250) {
    this.#repository = repository;
    this.#publisher = publisher;
    this.#intervalMs = intervalMs;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.flush(), this.#intervalMs);
    this.#timer.unref();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (const item of await this.#repository.takeOutboxBatch(25)) {
        try {
          await this.#publisher.publish(item.event);
          await this.#repository.markOutboxPublished(item.eventId, new Date().toISOString());
        } catch (error) {
          await this.#repository.markOutboxFailed(
            item.eventId,
            error instanceof Error ? error.message : 'Unknown publish failure',
          );
          break;
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.flush();
  }
}
