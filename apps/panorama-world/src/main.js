import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { parseSceneManifest } from 'spatial-intelligence-core';
import { workshopScene } from './scenes/workshop.scene.js';
import './styles.css';

const scene = parseSceneManifest(workshopScene);
const panoramaAsset = scene.assets.find((asset) => asset.id === 'workshop-panorama');
const entitiesById = new Map(scene.entities.map((entity) => [entity.id, entity]));
const startView = scene.metadata.startView;

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

document.querySelector('#scene-title').textContent = scene.metadata.title;

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

const markers = scene.entities
  .filter((entity) => entity.interactive && entity.components.panoramaMarker)
  .map(createMarker);

const viewer = new Viewer({
  container: document.querySelector('#viewer'),
  panorama: panoramaAsset.uri,
  defaultYaw: `${startView.yaw}deg`,
  defaultPitch: `${startView.pitch}deg`,
  defaultZoomLvl: startView.zoom,
  maxFov: 95,
  minFov: 35,
  navbar: ['zoom', 'move', 'fullscreen'],
  plugins: [MarkersPlugin.withConfig({ markers })],
});

const markersPlugin = viewer.getPlugin(MarkersPlugin);

function openPanel(entity) {
  const interaction = entity.components.interaction;
  panelKicker.textContent = entity.kind.replaceAll('-', ' ').toUpperCase();
  panelTitle.textContent = interaction.title;
  panelCopy.textContent = interaction.copy;
  panelAction.textContent = interaction.actionLabel;
  panelAction.hidden = false;
  panel.dataset.entityId = entity.id;
  panel.setAttribute('aria-hidden', 'false');
}

function closePanel() {
  panel.setAttribute('aria-hidden', 'true');
  panel.removeAttribute('data-entity-id');
}

markersPlugin.addEventListener('select-marker', ({ marker }) => {
  const entity = entitiesById.get(marker.data.entityId);
  if (entity) openPanel(entity);
});

viewer.addEventListener('load-progress', ({ progress }) => {
  const percent = Math.round(progress * 100);
  progressValue.style.width = `${percent}%`;
  progressLabel.textContent = `加载全景底图 ${percent}%`;
});

viewer.addEventListener('ready', () => {
  loadingLayer.classList.add('is-hidden');
  progressLabel.textContent = '全景已就绪';
});

recenterButton.addEventListener('click', () => {
  viewer.animate({
    yaw: `${startView.yaw}deg`,
    pitch: `${startView.pitch}deg`,
    zoom: startView.zoom,
    speed: '1.2rpm',
  });
});

panelClose.addEventListener('click', closePanel);
panelAction.addEventListener('click', () => {
  const entity = entitiesById.get(panel.dataset.entityId);
  if (!entity) return;
  panelAction.textContent = entity.id === 'portal-door' ? '第二场景待接入' : '该交互层待接入';
  panelAction.disabled = true;
});
