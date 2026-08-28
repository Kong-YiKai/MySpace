import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const REFERENCE_VIEWS = Object.freeze([
  Object.freeze({ id: 'front', label: '正面', yaw: 0 }),
  Object.freeze({ id: 'left-45', label: '左前 45°', yaw: Math.PI * 0.25 }),
  Object.freeze({ id: 'right-45', label: '右前 45°', yaw: -Math.PI * 0.25 }),
]);

function normalizeReferenceModel(model, label) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const longestSide = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longestSide) || longestSide < 0.0001) {
    throw new Error(`${label}没有可用于视觉识别的有效尺寸`);
  }

  // 所有 Lux3D 模型先标准化到同一取景尺寸；Qwen 看到的是形态，而不是导出单位差异。
  model.scale.setScalar(2.45 / longestSide);
  model.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(model);
  model.position.sub(normalizedBounds.getCenter(new THREE.Vector3()));
  model.updateMatrixWorld(true);
  return model;
}

/**
 * 为 Qwen 准备“视觉参考集”：从当前项目里的 GLB 离屏渲染出固定三机位，
 * 而不是使用文件名或文字标签假装模型已经被训练。参考图缓存在当前页面会话内，
 * 真实花园的截图仍会在每次提问时重新抓取。
 */
export function createPlantVisionReferenceCapture({ assets, size = 192 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x173020, 1);
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  camera.position.set(0, 0.08, 5.8);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xf3ffe5, 0x31502b, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffeac4, 3.4);
  keyLight.position.set(3.4, 4.2, 5.4);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x9bdcff, 2.1);
  rimLight.position.set(-4.6, 2.3, 2.1);
  scene.add(rimLight);

  const rig = new THREE.Group();
  scene.add(rig);
  const loader = new GLTFLoader();
  const prototypes = new Map();
  const capturedViews = new Map();
  let capturePromise = null;
  let cachedReferences = null;
  let disposed = false;

  async function loadPrototype(asset) {
    if (prototypes.has(asset.id)) return prototypes.get(asset.id);
    const gltf = await loader.loadAsync(asset.uri);
    const source = gltf.scene ?? gltf.scenes?.[0];
    if (!source) throw new Error(`${asset.label} GLB 中没有可渲染的场景根节点`);
    const prototype = normalizeReferenceModel(source, asset.label);
    prototypes.set(asset.id, prototype);
    return prototype;
  }

  async function captureAssetViews(asset, { idPrefix = asset.id, label = asset.label } = {}) {
    const cacheKey = `${asset.id}:${idPrefix}:${label}`;
    if (capturedViews.has(cacheKey)) return capturedViews.get(cacheKey);
    if (disposed) return [];
    const prototype = await loadPrototype(asset);
    const visual = prototype.clone(true);
    const images = [];
    rig.add(visual);
    try {
      for (const view of REFERENCE_VIEWS) {
        rig.rotation.set(-0.08, view.yaw, 0);
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.76);
        // 防止异常材质把请求体撑爆；缺失某张参考图不影响真实场景问答。
        if (dataUrl.length <= 180_000) {
          images.push({
            id: `${idPrefix}:${view.id}`,
            label: `${label}·${view.label}`,
            dataUrl,
            detail: 'low',
          });
        }
      }
    } finally {
      rig.remove(visual);
    }
    capturedViews.set(cacheKey, images);
    return images;
  }

  async function capture() {
    if (cachedReferences) return cachedReferences;
    if (capturePromise) return capturePromise;
    capturePromise = (async () => {
      const images = [];
      for (const asset of assets ?? []) {
        images.push(...await captureAssetViews(asset));
      }
      cachedReferences = images;
      return images;
    })().finally(() => {
      capturePromise = null;
    });
    return capturePromise;
  }

  return {
    capture,
    captureAssetViews,
    dispose() {
      disposed = true;
      renderer.dispose();
      prototypes.clear();
      capturedViews.clear();
      cachedReferences = null;
    },
  };
}
