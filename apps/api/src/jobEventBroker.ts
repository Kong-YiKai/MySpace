import type { PlatformEvent } from '@spatial-intelligence/contracts';
import type { JobEventListener } from './ports.js';

export class JobEventBroker implements JobEventListener {
  readonly #listeners = new Map<string, Set<(event: PlatformEvent) => void>>();

  publish(event: PlatformEvent): void {
    const jobId = jobIdOf(event);
    if (!jobId) return;
    for (const listener of this.#listeners.get(jobId) ?? []) listener(event);
  }

  subscribe(jobId: string, listener: (event: PlatformEvent) => void): () => void {
    const listeners = this.#listeners.get(jobId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(jobId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(jobId);
    };
  }
}

export function jobIdOf(event: PlatformEvent): string | null {
  return 'jobId' in event.payload && typeof event.payload.jobId === 'string'
    ? event.payload.jobId
    : null;
}
