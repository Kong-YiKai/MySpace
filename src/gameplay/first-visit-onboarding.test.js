import { describe, expect, it } from 'vitest';
import { consumeFirstVisit } from './first-visit-onboarding.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

describe('first visit onboarding', () => {
  it('shows once for each scene and remembers the acknowledgement separately', () => {
    const storage = createStorage();

    expect(consumeFirstVisit(storage, 'grave-gate-001')).toBe(true);
    expect(consumeFirstVisit(storage, 'grave-gate-001')).toBe(false);
    expect(consumeFirstVisit(storage, 'backyard-garden-001')).toBe(true);
  });

  it('keeps the scene usable when browser storage is unavailable', () => {
    const unavailableStorage = {
      getItem() { throw new Error('storage blocked'); },
      setItem() { throw new Error('storage blocked'); },
    };

    expect(consumeFirstVisit(unavailableStorage, 'tide-defense-001')).toBe(true);
  });
});
