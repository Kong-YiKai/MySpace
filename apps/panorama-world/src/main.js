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

document.querySelector('#scene-title').textContent = activeScene.metadata.title;

function getMarkerClass(tone) {
  return `world-marker world-marker--${tone}`;
}

function createMarker(entity) {
  const marker = entity.components.panoramaMarker;
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
  panelKicker.textContent = entity.kind.replaceAll('-', ' ').toUpperCase();
  panelTitle.textContent = interaction.title;
  panelCopy.textContent = interaction.copy;
  panelAction.textContent = interaction.actionLabel;
  panelAction.disabled = false;
  panelAction.hidden = !interaction.actionLabel;
  panel.dataset.entityId = entity.id;
  panel.setAttribute('aria-hidden', 'false');
}

function closePanel() {
  panel.setAttribute('aria-hidden', 'true');
  panel.removeAttribute('data-entity-id');
}

function focusGuideEntity(entityId) {
  const entity = getEntity(activeScene, entityId);
  const marker = entity?.components.panoramaMarker;
  if (!marker) return Promise.reject(new Error(`引导目标不存在：${entityId}`));

  return viewer.animate({
    yaw: `${marker.yaw}deg`,
    pitch: `${marker.pitch}deg`,
    speed: '0.7rpm',
  });
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
  if (entity) {
    openPanel(entity);
    guide?.observeEntity(entity);
  }
});

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
panelAction.addEventListener('click', () => {
  guide?.noteActivity();
  const entity = getEntity(activeScene, panel.dataset.entityId);
  if (!entity) return;
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
