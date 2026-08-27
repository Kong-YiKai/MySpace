import {
  PANORAMA_GUIDE_SCHEMA,
  resolveGuidePresentation,
  validateGuideDirective,
} from './guide-contract.js';

const RENDERER_SCRIPTS = [
  '/guide/grokbot/geometry-data.js',
  '/guide/grokbot/src/math.js',
  '/guide/grokbot/src/tables.js',
  '/guide/grokbot/src/pose.js',
  '/guide/grokbot/src/tricks.js',
  '/guide/grokbot/src/fx.js',
  '/guide/grokbot/src/eyes.js',
  '/guide/grokbot/src/character.js',
];

const DROWSY_AFTER_MS = 75_000;
const SLEEP_AFTER_MS = 105_000;
const FALLBACK_COPY = '我还在这里。要我带你看看这个场景吗？';

let rendererLoadPromise;

function loadScript(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`无法加载 Grokbot renderer 资源：${source}`));
    document.head.append(script);
  });
}

async function loadGrokRenderer() {
  if (window.GrokCharacter) return window.GrokCharacter;
  if (!rendererLoadPromise) {
    rendererLoadPromise = RENDERER_SCRIPTS.reduce(
      (chain, source) => chain.then(() => loadScript(source)),
      Promise.resolve(),
    ).then(() => {
      if (!window.GrokCharacter) throw new Error('Grokbot renderer 未初始化');
      return window.GrokCharacter;
    });
  }
  return rendererLoadPromise;
}

function getSceneGuide(scene) {
  return scene.metadata.guide ?? {
    name: 'Grokbot',
    greeting: FALLBACK_COPY,
    hints: [],
  };
}

function getEntityIds(scene) {
  return scene.entities.map((entity) => entity.id);
}

export class PanoramaGrokGuide {
  static async create(options) {
    const GrokCharacter = await loadGrokRenderer();
    return new PanoramaGrokGuide({ ...options, GrokCharacter });
  }

  constructor({ root, scene, onNavigate, GrokCharacter }) {
    this.root = root;
    this.onNavigate = onNavigate;
    this.avatarTrigger = root.querySelector('#guide-trigger');
    this.avatar = root.querySelector('#guide-avatar');
    this.name = root.querySelector('#guide-name');
    this.message = root.querySelector('#guide-message');
    this.suggestions = root.querySelector('#guide-suggestions');
    this.scene = scene;
    this.sceneGuide = getSceneGuide(scene);
    this.settleTimer = null;
    this.drowsyTimer = null;
    this.sleepTimer = null;
    this.isSleeping = false;

    this.renderer = new GrokCharacter(this.avatar, {
      mode: 'hold',
      state: 'idle',
      shape: 'blob',
      color: 'black',
      scheme: 'light',
      loginWrap: true,
      followPointer: false,
      onChange: ({ state }) => { this.root.dataset.state = state; },
    });

    this.avatarTrigger.addEventListener('click', () => this.handleAvatarClick());
    this.suggestions.addEventListener('click', (event) => this.handleSuggestionClick(event));
    this.setScene(scene, { announce: false });
    this.setOpen(false);
    this.scheduleDormancy();
  }

  setScene(scene, { announce = true } = {}) {
    this.scene = scene;
    this.sceneGuide = getSceneGuide(scene);
    this.name.textContent = this.sceneGuide.name ?? 'Grokbot';
    this.renderSuggestions();

    if (announce) {
      this.applyDirective({
        schemaVersion: PANORAMA_GUIDE_SCHEMA,
        intent: 'greet',
        message: this.sceneGuide.greeting ?? FALLBACK_COPY,
      });
      this.setOpen(true);
    }
  }

  announceInitialScene() {
    this.applyDirective({
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'greet',
      message: this.sceneGuide.greeting ?? FALLBACK_COPY,
    });
  }

  handleAvatarClick() {
    const wasSleeping = this.isSleeping;
    this.noteActivity();
    this.setOpen(this.root.dataset.open !== 'true');
    if (wasSleeping) {
      this.applyDirective({
        schemaVersion: PANORAMA_GUIDE_SCHEMA,
        intent: 'wake',
        message: '……世界仍在展开。要我为你引路吗？',
      });
      this.setOpen(true);
    } else if (this.root.dataset.open === 'true') {
      this.applyDirective({
        schemaVersion: PANORAMA_GUIDE_SCHEMA,
        intent: 'listen',
        message: '我在。先看看哪里？',
      });
    }
  }

  handleSuggestionClick(event) {
    const button = event.target.closest('button[data-guide-entity-id]');
    if (!button) return;
    const entityId = button.dataset.guideEntityId;
    const hint = this.sceneGuide.hints?.find((item) => item.entityId === entityId);
    if (!hint) return;

    this.noteActivity();
    this.applyDirective({
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'lead',
      targetEntityId: entityId,
      message: hint.leadingCopy ?? `让我带你看向${hint.label}。`,
    });

    Promise.resolve(this.onNavigate?.(entityId))
      .then(() => this.applyDirective({
        schemaVersion: PANORAMA_GUIDE_SCHEMA,
        intent: 'explain',
        targetEntityId: entityId,
        message: hint.copy ?? FALLBACK_COPY,
      }))
      .catch(() => this.applyDirective({
        schemaVersion: PANORAMA_GUIDE_SCHEMA,
        intent: 'caution',
        message: '这条引导暂时没有抵达。我们可以换个入口再试。',
      }));
  }

  /**
   * The future model bridge calls this method. It may supply only an intent,
   * an entity id from the active manifest and optional bubble copy; it can
   * never name renderer states, particles, CSS or arbitrary browser actions.
   */
  applyDirective(directive) {
    const checked = validateGuideDirective(directive, { entityIds: getEntityIds(this.scene) });
    const value = checked.value;
    const presentation = resolveGuidePresentation(value.intent);

    this.clearSettleTimer();
    this.renderer.setMode('hold');
    this.renderer.setEmphasis(['think', 'caution'].includes(value.intent));
    this.renderer.setState(presentation.rendererState, { resetEyes: false });
    this.isSleeping = value.intent === 'rest';
    this.root.dataset.presence = this.isSleeping ? 'sleeping' : 'active';
    this.message.textContent = value.message ?? (checked.ok ? FALLBACK_COPY : '这条引导没有通过语义校验，我先保持待机。');

    if (presentation.settleAfterMs) {
      this.settleTimer = window.setTimeout(() => {
        if (!this.isSleeping) this.renderer.setState('idle', { resetEyes: false });
      }, presentation.settleAfterMs);
    }

    return { ...checked, presentation };
  }

  observeEntity(entity) {
    this.noteActivity();
    this.applyDirective({
      schemaVersion: PANORAMA_GUIDE_SCHEMA,
      intent: 'observe',
      targetEntityId: entity.id,
      message: `这里是${entity.label}。要我带你仔细看看吗？`,
    });
  }

  noteActivity() {
    const wasSleeping = this.isSleeping;
    this.isSleeping = false;
    this.root.dataset.presence = 'active';
    this.clearDormancyTimers();
    this.scheduleDormancy();

    if (wasSleeping) {
      this.renderer.setState('waking', { resetEyes: false });
      this.clearSettleTimer();
      this.settleTimer = window.setTimeout(() => this.renderer.setState('idle', { resetEyes: false }), 1000);
    }
  }

  scheduleDormancy() {
    this.drowsyTimer = window.setTimeout(() => {
      if (!this.isSleeping) this.renderer.setState('drowsy', { resetEyes: false });
    }, DROWSY_AFTER_MS);
    this.sleepTimer = window.setTimeout(() => {
      this.isSleeping = true;
      this.root.dataset.presence = 'sleeping';
      this.renderer.setState('sleeping', { resetEyes: false });
      this.message.textContent = '我先在这里待机。轻触我，或打开一条引导，我就会醒来。';
      this.setOpen(false);
    }, SLEEP_AFTER_MS);
  }

  setOpen(open) {
    this.root.dataset.open = String(open);
    this.avatarTrigger.setAttribute('aria-expanded', String(open));
  }

  renderSuggestions() {
    this.suggestions.replaceChildren();
    for (const hint of this.sceneGuide.hints ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'guide-suggestion';
      button.dataset.guideEntityId = hint.entityId;
      button.textContent = hint.label;
      this.suggestions.append(button);
    }
  }

  clearSettleTimer() {
    if (this.settleTimer) window.clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  clearDormancyTimers() {
    if (this.drowsyTimer) window.clearTimeout(this.drowsyTimer);
    if (this.sleepTimer) window.clearTimeout(this.sleepTimer);
    this.drowsyTimer = null;
    this.sleepTimer = null;
  }

  destroy() {
    this.clearSettleTimer();
    this.clearDormancyTimers();
    this.renderer.destroy();
  }
}
