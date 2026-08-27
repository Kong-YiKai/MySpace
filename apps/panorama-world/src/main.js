import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { parseSceneManifest } from 'spatial-intelligence-core';
import { PanoramaGrokGuide } from './guide/grok-guide.js';
import { brightApartmentScene } from './scenes/bright-apartment.scene.js';
import { workshopScene } from './scenes/workshop.scene.js';
import './styles.css';

const scenes = [workshopScene, brightApartmentScene].map(parseSceneManifest);
const scenesById = new Map(scenes.map((scene) => [scene.sceneId, scene]));
let activeScene = scenesById.get('world-gate-workshop-001');
let guide = null;
let panoramaReady = false;
const storyState = {
  portalUnlocked: false,
  caretakerMet: false,
};

const loadingLayer = document.querySelector('#loading-layer');
const progressValue = document.querySelector('#progress-value');
const progressLabel = document.querySelector('#progress-label');
const recenterButton = document.querySelector('#recenter-button');
const panel = document.querySelector('#scene-panel');
const panelClose = document.querySelector('#panel-close');
const panelKicker = document.querySelector('#panel-kicker');
const panelTitle = document.querySelector('#panel-title');
const panelCopy = document.querySelector('#panel-copy');
const panelAction = document.querySelector('#panel-action');
const dialoguePanel = document.querySelector('#dialogue-panel');
const dialogueClose = document.querySelector('#dialogue-close');
const dialogueSpeaker = document.querySelector('#dialogue-speaker');
const dialogueLine = document.querySelector('#dialogue-line');
const dialogueChoices = document.querySelector('#dialogue-choices');

document.querySelector('#scene-title').textContent = activeScene.metadata.title;

function getMarkerClass(tone) {
  return `world-marker world-marker--${tone}`;
}

function createMarker(entity) {
  const marker = entity.components.panoramaMarker;
  if (entity.kind === 'character') {
    const character = entity.components.character;
    const initialSprite = character.sprites?.[character.initialState];
    return {
      id: entity.id,
      position: { yaw: `${marker.yaw}deg`, pitch: `${marker.pitch}deg` },
      html: `<button class="scene-character" type="button" data-character-id="${entity.id}" data-state="${character.initialState}" aria-label="与${entity.label}交谈"><img class="scene-character__sprite" src="${initialSprite}" alt="" draggable="false"><span class="scene-character__name">${entity.label}</span></button>`,
      anchor: 'bottom center',
      data: { entityId: entity.id },
    };
  }
  return {
    id: entity.id,
    position: { yaw: `${marker.yaw}deg`, pitch: `${marker.pitch}deg` },
    html: `<button class="${getMarkerClass(marker.tone)}" type="button" aria-label="${entity.label}"><span></span></button>`,
    anchor: 'bottom center',
    data: { entityId: entity.id },
  };
}

function getMarkers(scene) {
  return scene.entities
  .filter((entity) => entity.interactive && entity.components.panoramaMarker)
  .map(createMarker);
}

function getPanoramaAsset(scene) {
  return scene.assets.find((asset) => asset.metadata.projection === 'equirectangular');
}

function getEntity(scene, entityId) {
  return scene.entities.find((entity) => entity.id === entityId);
}

function updateSceneTitle(scene) {
  document.querySelector('#scene-title').textContent = scene.metadata.title;
}

function useScene(scene, { transition = true } = {}) {
  const panoramaAsset = getPanoramaAsset(scene);
  const startView = scene.metadata.startView;

  activeScene = scene;
  closePanel();
  closeDialogue();
  updateSceneTitle(scene);
  markersPlugin.setMarkers(getMarkers(scene));
  guide?.setScene(scene);

  return viewer.setPanorama(panoramaAsset.uri, {
    position: { yaw: `${startView.yaw}deg`, pitch: `${startView.pitch}deg` },
    zoom: startView.zoom,
    transition: transition ? { effect: 'fade', speed: 700 } : false,
  });
}

const viewer = new Viewer({
  container: document.querySelector('#viewer'),
  panorama: getPanoramaAsset(activeScene).uri,
  defaultYaw: `${activeScene.metadata.startView.yaw}deg`,
  defaultPitch: `${activeScene.metadata.startView.pitch}deg`,
  defaultZoomLvl: activeScene.metadata.startView.zoom,
  maxFov: 95,
  minFov: 35,
  navbar: ['zoom', 'move', 'fullscreen'],
  plugins: [MarkersPlugin.withConfig({ markers: getMarkers(activeScene) })],
});

const markersPlugin = viewer.getPlugin(MarkersPlugin);

// Register panorama lifecycle listeners before awaiting the guide renderer.
// The panorama can finish from cache while its optional character layer loads.
viewer.addEventListener('load-progress', ({ progress }) => {
  const percent = Math.round(progress * 100);
  progressValue.style.width = `${percent}%`;
  progressLabel.textContent = `加载全景底图 ${percent}%`;
});

viewer.addEventListener('ready', () => {
  panoramaReady = true;
  loadingLayer.classList.add('is-hidden');
  progressLabel.textContent = '全景已就绪';
  guide?.announceInitialScene();
});

function openPanel(entity) {
  const interaction = entity.components.interaction;
  const portalNeedsCaretaker = entity.id === 'portal-door' && !storyState.portalUnlocked;
  panelKicker.textContent = entity.kind.replaceAll('-', ' ').toUpperCase();
  panelTitle.textContent = interaction.title;
  panelCopy.textContent = interaction.copy;
  panelAction.textContent = portalNeedsCaretaker ? '向守门人询问' : interaction.actionLabel;
  panelAction.disabled = false;
  panelAction.hidden = !interaction.actionLabel;
  panel.dataset.entityId = entity.id;
  panel.setAttribute('aria-hidden', 'false');
}

function closePanel() {
  panel.setAttribute('aria-hidden', 'true');
  panel.removeAttribute('data-entity-id');
}

function setCharacterState(entityId, state) {
  const marker = document.querySelector(`.scene-character[data-character-id="${entityId}"]`);
  const character = getEntity(activeScene, entityId)?.components.character;
  const sprite = character?.sprites?.[state] ?? character?.sprites?.idle;
  if (!marker || !sprite) return;
  marker.dataset.state = state;
  const image = marker.querySelector('.scene-character__sprite');
  if (image?.getAttribute('src') !== sprite) image.setAttribute('src', sprite);
}

function renderDialogue({ speaker, line, choices }) {
  dialogueSpeaker.textContent = speaker;
  dialogueLine.textContent = line;
  dialogueChoices.replaceChildren();
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dialogue-choice';
    button.dataset.storyAction = choice.action;
    button.textContent = choice.label;
    dialogueChoices.append(button);
  }
  dialoguePanel.setAttribute('aria-hidden', 'false');
}

function closeDialogue() {
  dialoguePanel.setAttribute('aria-hidden', 'true');
  dialogueChoices.replaceChildren();
  const caretaker = getEntity(activeScene, 'workshop-caretaker');
  if (caretaker) setCharacterState(caretaker.id, 'idle');
}

function openCaretakerDialogue(entity) {
  storyState.caretakerMet = true;
  setCharacterState(entity.id, 'speaking');
  guide?.applyDirective({
    schemaVersion: 'panorama-guide.v1',
    intent: 'observe',
    targetEntityId: entity.id,
    message: '我找到守门人了。他似乎一直在等人提起那扇门。',
  });
  renderDialogue({
    speaker: entity.components.character.displayName,
    line: entity.components.character.openingLine,
    choices: [
      { label: '询问世界之门', action: 'ask-door' },
      { label: '问问发光展台', action: 'ask-plinth' },
      { label: '暂时离开', action: 'close-dialogue' },
    ],
  });
}

function selectCharacter(entity) {
  closePanel();
  focusGuideEntity(entity.id).catch(() => {});
  openCaretakerDialogue(entity);
}

function handleDialogueAction(action) {
  const caretaker = getEntity(activeScene, 'workshop-caretaker');
  if (!caretaker) return;

  if (action === 'ask-door') {
    setCharacterState(caretaker.id, 'surprised');
    renderDialogue({
      speaker: caretaker.components.character.displayName,
      line: '你也听见门后的风声了？那不是普通出口。若你确定要去，我可以为你解开门钥。',
      choices: [
        { label: '请为我开启', action: 'unlock-door' },
        { label: '我先看看展台', action: 'ask-plinth' },
      ],
    });
    return;
  }

  if (action === 'ask-plinth') {
    setCharacterState(caretaker.id, 'listening');
    renderDialogue({
      speaker: caretaker.components.character.displayName,
      line: '展台只是一枚锚点。它提醒我们：背景负责空间，真正可检视的物件要以独立资产进入。',
      choices: [
        { label: '回到世界之门', action: 'ask-door' },
        { label: '明白了', action: 'close-dialogue' },
      ],
    });
    return;
  }

  if (action === 'unlock-door') {
    storyState.portalUnlocked = true;
    setCharacterState(caretaker.id, 'speaking');
    guide?.applyDirective({
      schemaVersion: 'panorama-guide.v1',
      intent: 'notify',
      message: '门钥已响应。世界之门现在可以通行了。',
    });
    renderDialogue({
      speaker: caretaker.components.character.displayName,
      line: '门钥已经回应你了。现在可以点击金色门扉，也可以由我直接送你穿过去。',
      choices: [
        { label: '穿过世界之门', action: 'enter-apartment' },
        { label: '先留在工坊', action: 'close-dialogue' },
      ],
    });
    return;
  }

  if (action === 'enter-apartment') {
    closeDialogue();
    useScene(scenesById.get('bright-apartment-002')).catch(() => {
      guide?.applyDirective({
        schemaVersion: 'panorama-guide.v1',
        intent: 'caution',
        message: '门已经开启，但这次场景切换没有抵达。可以再试一次。',
      });
    });
    return;
  }

  closeDialogue();
}

function focusGuideEntity(entityId) {
  const entity = getEntity(activeScene, entityId);
  const marker = entity?.components.panoramaMarker;
  if (!marker) return Promise.reject(new Error(`引导目标不存在：${entityId}`));

  const animation = viewer.animate({
    yaw: `${marker.yaw}deg`,
    pitch: `${marker.pitch}deg`,
    speed: '0.7rpm',
  });

  // Photo Sphere Viewer v5 returns a PromiseLike Animation rather than a
  // native Promise. Chain it once so callers can safely use `.catch()`.
  return typeof animation?.then === 'function'
    ? animation.then(() => undefined)
    : Promise.resolve();
}

guide = await PanoramaGrokGuide.create({
  root: document.querySelector('#guide-presence'),
  scene: activeScene,
  onNavigate: focusGuideEntity,
});

// The future model bridge receives this intentionally small semantic API.
// It cannot select any of the renderer's raw states, effects or DOM values.
window.panoramaGuide = Object.freeze({
  applyDirective: (directive) => guide.applyDirective(directive),
  get activeSceneId() { return activeScene.sceneId; },
});

if (panoramaReady) guide.announceInitialScene();

markersPlugin.addEventListener('select-marker', ({ marker }) => {
  const entity = getEntity(activeScene, marker.data.entityId);
  if (!entity) return;
  if (entity.kind === 'character') {
    selectCharacter(entity);
    return;
  }
  openPanel(entity);
  guide?.observeEntity(entity);
});

// HTML character markers keep their own button semantics, so capture their
// click before Photo Sphere Viewer's generic panorama handler consumes it.
document.querySelector('#viewer').addEventListener('click', (event) => {
  const characterButton = event.target.closest('.scene-character[data-character-id]');
  if (!characterButton) return;
  event.preventDefault();
  event.stopPropagation();
  const entity = getEntity(activeScene, characterButton.dataset.characterId);
  if (entity?.kind === 'character') selectCharacter(entity);
}, { capture: true });

viewer.addEventListener('click', () => guide?.noteActivity());

recenterButton.addEventListener('click', () => {
  guide?.noteActivity();
  const startView = activeScene.metadata.startView;
  viewer.animate({
    yaw: `${startView.yaw}deg`,
    pitch: `${startView.pitch}deg`,
    zoom: startView.zoom,
    speed: '1.2rpm',
  });
});

panelClose.addEventListener('click', closePanel);
dialogueClose.addEventListener('click', closeDialogue);
dialogueChoices.addEventListener('click', (event) => {
  const choice = event.target.closest('button[data-story-action]');
  if (choice) handleDialogueAction(choice.dataset.storyAction);
});
panelAction.addEventListener('click', () => {
  guide?.noteActivity();
  const entity = getEntity(activeScene, panel.dataset.entityId);
  if (!entity) return;
  if (entity.id === 'portal-door' && !storyState.portalUnlocked) {
    const caretaker = getEntity(activeScene, 'workshop-caretaker');
    closePanel();
    if (caretaker) {
      focusGuideEntity(caretaker.id).catch(() => {});
      openCaretakerDialogue(caretaker);
    }
    return;
  }
  const targetSceneId = entity.components.interaction.targetSceneId;
  if (targetSceneId) {
    const targetScene = scenesById.get(targetSceneId);
    if (targetScene) {
      panelAction.textContent = '正在穿过门…';
      panelAction.disabled = true;
      useScene(targetScene).catch(() => {
        panelAction.textContent = '场景切换失败，请重试';
        panelAction.disabled = false;
      });
      return;
    }
  }
  panelAction.textContent = '该交互层待接入';
  panelAction.disabled = true;
});
