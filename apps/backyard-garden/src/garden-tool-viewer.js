import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const HELD_POSE = Object.freeze({
  position: new THREE.Vector3(0.48, -0.5, 0),
  rotation: new THREE.Euler(-0.16, 0.34, -0.24),
  scale: 1,
});
const INSPECT_POSE = Object.freeze({
  position: new THREE.Vector3(0, -0.02, 0),
  rotation: new THREE.Euler(0, 0, 0),
  scale: 1.26,
});

function cloneMaterials(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (Array.isArray(node.material)) node.material = node.material.map((material) => material?.clone?.() ?? material);
    else if (node.material?.clone) node.material = node.material.clone();
  });
}

function normalizeViewModel(model, definition) {
  cloneMaterials(model);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const longestSide = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longestSide) || longestSide < 0.0001) {
    throw new Error(`${definition.label}模型没有可用尺寸`);
  }
  model.scale.multiplyScalar(definition.targetSize / longestSide);
  model.rotation.y = definition.yaw ?? 0;
  model.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(model);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -center.y, -center.z);
  model.updateMatrixWorld(true);
  return model;
}

/**
 * 与 Aholo Viewer 完全隔离的透明前景层。
 * 工具只在这个 Three.js 小场景里渲染，因此绝不会与 3DGS 点云发生深度排序或材质混合。
 */
export function createGardenToolViewer({ container, assets }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1, 0.01, 100);
  camera.position.set(0, 0, 5.2);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.replaceChildren(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xe6f4ff, 0x38512b, 2.2));
  const keyLight = new THREE.DirectionalLight(0xfff3da, 3.2);
  keyLight.position.set(2.7, 3.8, 4.6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xa4dfff, 2.1);
  rimLight.position.set(-3.8, 1.6, 2.4);
  scene.add(rimLight);

  const rig = new THREE.Group();
  scene.add(rig);
  const loader = new GLTFLoader();
  const prototypes = new Map();
  const loading = new Map();
  let activeToolId = null;
  let visual = null;
  let inspecting = false;
  let manualYaw = 0;
  let manualPitch = 0;
  let lastFrameAt = performance.now();
  let disposed = false;

  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  async function loadPrototype(toolId) {
    if (prototypes.has(toolId)) return prototypes.get(toolId);
    if (loading.has(toolId)) return loading.get(toolId);
    const definition = assets[toolId];
    const pending = loader.loadAsync(definition.uri)
      .then((gltf) => gltf.scene ?? gltf.scenes?.[0])
      .then((model) => {
        if (!model) throw new Error(`${definition.label} GLB 中没有可加载的场景`);
        return normalizeViewModel(model, definition);
      })
      .then((model) => {
        prototypes.set(toolId, model);
        return model;
      })
      .finally(() => loading.delete(toolId));
    loading.set(toolId, pending);
    return pending;
  }

  function removeVisual() {
    if (!visual) return;
    rig.remove(visual);
    visual = null;
  }

  function applyPose() {
    const pose = inspecting ? INSPECT_POSE : HELD_POSE;
    rig.position.copy(pose.position);
    rig.rotation.copy(pose.rotation);
    rig.scale.setScalar(pose.scale);
    if (inspecting) {
      rig.rotation.x += manualPitch;
      rig.rotation.y += manualYaw;
    }
  }

  function frame(now) {
    if (disposed) return;
    const delta = Math.min((now - lastFrameAt) / 1000, 0.05);
    lastFrameAt = now;
    if (inspecting) manualYaw += delta * 0.78;
    applyPose();
    renderer.render(scene, camera);
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  return {
    async setTool(toolId) {
      activeToolId = toolId;
      inspecting = false;
      manualYaw = 0;
      manualPitch = 0;
      if (!toolId || !assets[toolId]) {
        removeVisual();
        return false;
      }
      const prototype = await loadPrototype(toolId);
      if (disposed || activeToolId !== toolId) return false;
      removeVisual();
      visual = prototype.clone(true);
      rig.add(visual);
      return true;
    },
    setInspection(value) {
      inspecting = Boolean(value && visual);
      if (!inspecting) {
        manualYaw = 0;
        manualPitch = 0;
      }
      return inspecting;
    },
    rotateInspection(deltaX, deltaY) {
      if (!inspecting) return;
      manualYaw += deltaX * 0.008;
      manualPitch = THREE.MathUtils.clamp(manualPitch + deltaY * 0.006, -0.68, 0.68);
    },
    hasVisual() {
      return Boolean(visual);
    },
    dispose() {
      disposed = true;
      resizeObserver.disconnect();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
