/**
 * 正式世界入口统一使用 2:1 等距柱状全景母图。
 * 六面体仅用于此前的清晰度实验，不再随产品交付。
 */
export function getPanoramaDescriptor(scene) {
  const equirectangular = scene.assets.find((asset) => asset.metadata.projection === 'equirectangular');
  if (!equirectangular) throw new Error(`场景 ${scene.sceneId} 没有可用的全景底图`);

  return {
    projection: 'equirectangular',
    source: equirectangular.uri,
  };
}
