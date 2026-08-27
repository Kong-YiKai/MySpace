export class PersistenceAdapter {
  async saveManifest() { throw new Error('PersistenceAdapter.saveManifest() is not implemented'); }
  async loadManifest() { throw new Error('PersistenceAdapter.loadManifest() is not implemented'); }
  async appendEvent() { throw new Error('PersistenceAdapter.appendEvent() is not implemented'); }
}

