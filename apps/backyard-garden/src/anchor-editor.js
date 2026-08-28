import { INITIAL_PLOT_POSITIONS, getPlots } from './backyard.scene.js';

const STORAGE_KEY = 'myspace.backyard-garden.anchor-draft.v1';

export function loadAnchorDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!draft || typeof draft !== 'object') return { ...INITIAL_PLOT_POSITIONS };
    return { ...INITIAL_PLOT_POSITIONS, ...draft };
  } catch {
    return { ...INITIAL_PLOT_POSITIONS };
  }
}

export function saveAnchorDraft(manifest) {
  const coordinates = Object.fromEntries(getPlots(manifest).map((plot) => [plot.id, plot.transform.position]));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(coordinates));
  return coordinates;
}

export function clearAnchorDraft() {
  localStorage.removeItem(STORAGE_KEY);
  return { ...INITIAL_PLOT_POSITIONS };
}

export function getAnchorJson(manifest) {
  return JSON.stringify(Object.fromEntries(getPlots(manifest).map((plot) => [plot.id, {
    position: plot.transform.position,
    footprint: plot.components.spatialAnchor.footprint,
  }])), null, 2);
}
