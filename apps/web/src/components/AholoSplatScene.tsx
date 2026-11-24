import { useEffect, useRef, useState } from 'react';
import type { SceneManifest, SpatialAnchorSet } from '@spatial-intelligence/contracts';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera as ThreePerspectiveCamera,
  Quaternion as ThreeQuaternion,
  Raycaster,
  Scene as ThreeScene,
  SRGBColorSpace,
  Vector2,
  Vector3 as ThreeVector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MobileMovementPad } from './MobileMovementPad';

interface AholoSplatSceneProps {
  manifest: SceneManifest;
  immersive: boolean;
  spatialAnchors?: SpatialAnchorSet | null;
}

interface AlignmentResult {
  status: 'aligned' | 'untrusted' | 'unverified';
  message: string;
}

interface MeshOverlay {
  resize: () => void;
  syncCamera: (position: Point3, direction: Point3, fov: number) => void;
  render: () => void;
  pick: (clientX: number, clientY: number) => string | null;
  destroy: () => void;
}

type Point3 = [number, number, number];
const HARD_DOWNLOAD_LIMIT = 650 * 1024 * 1024;

export function AholoSplatScene({ manifest, immersive, spatialAnchors = null }: AholoSplatSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [message, setMessage] = useState('正在初始化 Aholo Viewer…');
  const [alignment, setAlignment] = useState<AlignmentResult | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const splatAsset = manifest.assets.find((asset) => asset.kind === 'splat');
  const visualLayer = manifest.metadata.visualLayer as { referenceImagePolicy?: string } | undefined;
  const renderedFurniture = visualLayer?.referenceImagePolicy === 'source-render-layout-and-appearance';

  useEffect(() => {
    const container = containerRef.current;
    const overlayContainer = overlayRef.current;
    if (!container || !overlayContainer || !splatAsset) return undefined;
    const activeSplatAsset = splatAsset;
    let disposed = false;
    let frame = 0;
    let cleanupViewer = () => undefined;
    let meshOverlay: MeshOverlay | null = null;
    const abort = new AbortController();

    async function mount() {
      try {
        assertWebGl2();
        const lowPower = isLowPowerDevice();
        const aholo = await import('@manycore/aholo-viewer');
        if (disposed) return;
        let viewer: ReturnType<typeof aholo.createViewer>;
        try {
          viewer = aholo.createViewer(`myspace-${manifest.sceneId}-${manifest.revision}`, container!, {
            antialiasing: !lowPower,
            alpha: false,
          });
        } catch (error) {
          throw viewerError('viewer_initialization_failed', 'Aholo Viewer 初始化失败', error);
        }

        const bytes = await downloadSplat(activeSplatAsset.uri, abort.signal, (loaded, total) => {
          if (disposed) return;
          const progress = total ? ` ${Math.round((loaded / total) * 100)}%` : ` ${(loaded / 1024 / 1024).toFixed(1)} MB`;
          setMessage(`正在下载 Aholo 3DGS 资源…${progress}`);
        });
        setMessage('正在解析 Aholo 3DGS 资源…');
        const fileName = new URL(activeSplatAsset.uri, window.location.href).pathname;
        const detected = aholo.SplatLoader.detectSplatFileType(fileName, bytes);
        const declared = activeSplatAsset.format === 'spz'
          ? aholo.SplatLoader.SplatFileType.SPZ
          : activeSplatAsset.format === 'ply'
            ? aholo.SplatLoader.SplatFileType.PLY
            : undefined;
        const fileType = detected ?? declared;
        if (fileType === undefined) {
          viewer.destroy();
          throw viewerError('asset_format_unsupported', `Aholo 资产格式不支持（${activeSplatAsset.format ?? 'unknown'}）`);
        }

        const data = await aholo.SplatLoader.parseSplatData(fileType, bytes);
        const nativeBounds = robustSplatBounds(data);
        const splat = await aholo.SplatUtils.createSplat(data);
        if (disposed) {
          splat.freeGPU();
          viewer.destroy();
          return;
        }

        const nativeUpAxis = readNativeUpAxis(activeSplatAsset.metadata.nativeUpAxis, manifest.coordinateSystem.upAxis);
        const alignmentResult = alignVisualLayer(aholo, splat, nativeBounds, nativeUpAxis, spatialAnchors);
        setAlignment(alignmentResult);

        const view = viewBounds(spatialAnchors, nativeBounds, nativeUpAxis);
        const aspect = Math.max(1, container!.clientWidth) / Math.max(1, container!.clientHeight);
        const camera = new aholo.PerspectiveCamera(immersive ? 68 : 52, aspect, 0.05, 2_000);
        camera.up.set(0, 1, 0);
        let yaw = immersive ? entranceYaw(spatialAnchors) : -0.7;
        let pitch = immersive ? 0 : -0.25;
        const position = new aholo.Vector3(...(immersive
          ? entrancePosition(spatialAnchors, view)
          : overviewPosition(view)));
        const keys = new Set<string>();
        let dragging = false;
        let previousX = 0;
        let previousY = 0;
        let previousFrameAt = performance.now();
        let renderRequested = true;
        let pointerTravel = 0;
        if (!renderedFurniture) meshOverlay = createMeshOverlay(overlayContainer!, manifest, lowPower);

        const updateCamera = () => {
          const direction = directionFromAngles(yaw, pitch);
          camera.position.copy(position);
          camera.lookAt(new aholo.Vector3(
            position.x + direction[0],
            position.y + direction[1],
            position.z + direction[2],
          ));
          viewer.setCamera(camera);
          meshOverlay?.syncCamera(
            [position.x, position.y, position.z],
            direction,
            camera.fov,
          );
          renderRequested = true;
        };
        const tick = (time: number) => {
          frame = window.requestAnimationFrame(tick);
          const delta = Math.min(0.05, (time - previousFrameAt) / 1_000);
          previousFrameAt = time;
          if (immersive && moveCamera(position, yaw, keys, delta, spatialAnchors, view)) updateCamera();
          if (renderRequested) {
            renderRequested = false;
            viewer.render();
            meshOverlay?.render();
          }
        };

        viewer.getScene().add(splat);
        aholo.setViewerConfig(viewer, {
          pipeline: {
            Background: {
              background: {
                active: aholo.BackgroundMode.BasicBackground,
                basic: { color: new aholo.Color(0.035, 0.035, 0.035) },
              },
              ground: { enabled: false },
            },
            Splatting: { enabled: true },
            TAA: { enabled: !lowPower },
          },
        });
        viewer.requestRenderHandler = () => { renderRequested = true; };
        updateCamera();
        frame = window.requestAnimationFrame(tick);

        const pointerDown = (event: PointerEvent) => {
          dragging = true;
          previousX = event.clientX;
          previousY = event.clientY;
          pointerTravel = 0;
          container!.setPointerCapture(event.pointerId);
        };
        const pointerMove = (event: PointerEvent) => {
          if (!dragging) return;
          pointerTravel += Math.abs(event.movementX) + Math.abs(event.movementY);
          yaw -= (event.clientX - previousX) * 0.005;
          pitch = Math.max(-1.2, Math.min(1.2, pitch - (event.clientY - previousY) * 0.004));
          previousX = event.clientX;
          previousY = event.clientY;
          updateCamera();
        };
        const pointerUp = (event: PointerEvent) => {
          dragging = false;
          if (pointerTravel < 7) setSelectedEntity(meshOverlay?.pick(event.clientX, event.clientY) ?? null);
        };
        const wheel = (event: WheelEvent) => {
          if (immersive) return;
          event.preventDefault();
          const center = centerOf(view);
          const factor = Math.max(0.78, Math.min(1.22, 1 + event.deltaY * 0.001));
          position.set(
            center[0] + (position.x - center[0]) * factor,
            center[1] + (position.y - center[1]) * factor,
            center[2] + (position.z - center[2]) * factor,
          );
          camera.position.copy(position);
          camera.lookAt(new aholo.Vector3(...center));
          viewer.setCamera(camera);
          meshOverlay?.syncCamera(
            [position.x, position.y, position.z],
            [center[0] - position.x, center[1] - position.y, center[2] - position.z],
            camera.fov,
          );
          renderRequested = true;
        };
        const keyDown = (event: KeyboardEvent) => keys.add(event.key.toLowerCase());
        const keyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
        container!.addEventListener('pointerdown', pointerDown);
        container!.addEventListener('pointermove', pointerMove);
        container!.addEventListener('pointerup', pointerUp);
        container!.addEventListener('pointercancel', pointerUp);
        container!.addEventListener('wheel', wheel, { passive: false });
        window.addEventListener('keydown', keyDown);
        window.addEventListener('keyup', keyUp);
        const resize = new ResizeObserver(() => {
          camera.aspect = Math.max(1, container!.clientWidth) / Math.max(1, container!.clientHeight);
          viewer.resize();
          meshOverlay?.resize();
          viewer.setCamera(camera);
          renderRequested = true;
        });
        resize.observe(container!);

        cleanupViewer = () => {
          resize.disconnect();
          container!.removeEventListener('pointerdown', pointerDown);
          container!.removeEventListener('pointermove', pointerMove);
          container!.removeEventListener('pointerup', pointerUp);
          container!.removeEventListener('pointercancel', pointerUp);
          container!.removeEventListener('wheel', wheel);
          window.removeEventListener('keydown', keyDown);
          window.removeEventListener('keyup', keyUp);
          viewer.requestRenderHandler = undefined;
          viewer.getScene().remove(splat);
          splat.freeGPU();
          meshOverlay?.destroy();
          meshOverlay = null;
          viewer.destroy();
        };
        setMessage(lowPower ? 'Aholo 3DGS 已加载（性能降级模式）' : 'Aholo 3DGS 已加载');
        setStatus('ready');
      } catch (error) {
        if (disposed || abort.signal.aborted) return;
        setStatus('failed');
        setMessage(error instanceof Error ? error.message : 'Aholo Viewer 初始化失败');
      }
    }

    void mount();
    return () => {
      disposed = true;
      abort.abort();
      if (frame) window.cancelAnimationFrame(frame);
      cleanupViewer();
      meshOverlay?.destroy();
    };
  }, [immersive, manifest, renderedFurniture, spatialAnchors, splatAsset]);

  if (!splatAsset) return <ViewerFailure message="Aholo 成功结果缺少 3DGS 资源" />;
  return (
    <div className="room-canvas aholo-room-canvas" data-testid="aholo-room-scene">
      <div ref={containerRef} className="aholo-viewer-host" />
      <div ref={overlayRef} className="semantic-mesh-overlay" aria-hidden="true" />
      {status !== 'ready' && (
        <div className={`aholo-viewer-status ${status}`} role={status === 'failed' ? 'alert' : 'status'}>
          {status === 'loading' && <span className="spinner" />}
          <strong>{message}</strong>
        </div>
      )}
      {status === 'ready' && alignment && (
        <div className={`spatial-alignment-status ${alignment.status}`} role="status">{alignment.message}</div>
      )}
      {status === 'ready' && !immersive && <div className="orbit-hint">Aholo 真实 3DGS · 拖动环视 · 滚轮缩放</div>}
      {status === 'ready' && !renderedFurniture && manifest.assets.some((asset) => asset.kind === 'mesh') && (
        <div className="mesh-fallback-status">Lux3D 浏览器直渲叠加 · 最终遮挡以 RenderCloud 验收为准</div>
      )}
      {selectedEntity && <div className="selected-entity-card">已选择：{selectedEntity}</div>}
      {status === 'ready' && immersive && <MobileMovementPad />}
    </div>
  );
}

function ViewerFailure({ message }: { message: string }) {
  return <div className="room-canvas aholo-room-canvas"><div className="aholo-viewer-status failed" role="alert"><strong>{message}</strong></div></div>;
}

function createMeshOverlay(host: HTMLDivElement, manifest: SceneManifest, lowPower: boolean): MeshOverlay {
  const renderer = new WebGLRenderer({ alpha: true, antialias: !lowPower });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(lowPower ? 0.75 : Math.min(window.devicePixelRatio, 1.5));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.pointerEvents = 'none';
  host.appendChild(renderer.domElement);
  const scene = new ThreeScene();
  const camera = new ThreePerspectiveCamera(60, 1, 0.05, 2_000);
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const loadedRoots: Group[] = [];
  let disposed = false;
  scene.add(new AmbientLight('#fff8ed', 1.5));
  const key = new DirectionalLight('#fff1dc', 2.8);
  key.position.set(4, 7, 5);
  scene.add(key);

  const loader = new GLTFLoader();
  for (const entity of manifest.entities.filter((item) => item.interactive && item.assetRefs.length > 0)) {
    const asset = manifest.assets.find((item) => item.kind === 'mesh' && entity.assetRefs.includes(item.id));
    if (!asset) continue;
    loader.load(asset.uri, (gltf) => {
      if (disposed) return;
      const root = new Group();
      root.name = entity.label || entity.id;
      root.userData.entityLabel = root.name;
      root.position.fromArray(entity.transform.position);
      root.quaternion.fromArray(entity.transform.rotation);
      root.scale.fromArray(entity.transform.scale);
      const normalization = readNormalization(entity.components.assetNormalization);
      if (normalization) {
        gltf.scene.scale.fromArray(normalization.scale);
        gltf.scene.quaternion.fromArray(normalization.rotationQuaternion);
        gltf.scene.position.fromArray(normalization.translationMeters);
      }
      gltf.scene.traverse((object) => {
        object.userData.entityLabel = root.name;
        if (object instanceof Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      root.add(gltf.scene);
      loadedRoots.push(root);
      scene.add(root);
    }, undefined, () => { /* 资产失败由独立 Lux3D 状态卡给出诊断。 */ });
  }

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  return {
    resize,
    syncCamera(position, direction, fov) {
      camera.position.fromArray(position);
      camera.up.set(0, 1, 0);
      camera.fov = fov;
      camera.lookAt(new ThreeVector3(
        position[0] + direction[0], position[1] + direction[1], position[2] + direction[2],
      ));
      camera.updateProjectionMatrix();
    },
    render() { renderer.render(scene, camera); },
    pick(clientX, clientY) {
      const bounds = host.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;
      pointer.set(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(loadedRoots, true)[0];
      return typeof hit?.object.userData.entityLabel === 'string' ? hit.object.userData.entityLabel : null;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function readNormalization(value: unknown): {
  scale: Point3;
  rotationQuaternion: [number, number, number, number];
  translationMeters: Point3;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const scale = point3(record.scale);
  const translationMeters = point3(record.translationMeters);
  const rotation = record.rotationQuaternion;
  if (!scale || !translationMeters || !Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(Number.isFinite)) return null;
  return { scale, translationMeters, rotationQuaternion: rotation.map(Number) as [number, number, number, number] };
}

function point3(value: unknown): Point3 | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  return value as Point3;
}

async function downloadSplat(
  uri: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(uri, { signal });
  } catch (error) {
    throw viewerError('asset_download_failed', 'Aholo 3DGS 资源下载失败，请检查资源有效期与网络', error);
  }
  if (!response.ok) throw viewerError('asset_download_failed', `Aholo 3DGS 资源下载失败（HTTP ${response.status}）`);
  const total = Number(response.headers.get('content-length')) || null;
  if (total && total > HARD_DOWNLOAD_LIMIT) {
    throw viewerError('performance_budget_exceeded', `3DGS 资源 ${(total / 1024 / 1024).toFixed(0)} MB，超过浏览器 ${HARD_DOWNLOAD_LIMIT / 1024 / 1024} MB 安全预算`);
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (loaded > HARD_DOWNLOAD_LIMIT) {
      await reader.cancel();
      throw viewerError('performance_budget_exceeded', '3DGS 流式下载超过浏览器安全预算');
    }
    chunks.push(value);
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function robustSplatBounds(data: { counts: number; fillCenters: (centers: Float32Array) => void }): { min: Point3; max: Point3 } {
  if (!data.counts) throw viewerError('asset_empty', 'Aholo 3DGS 资源为空');
  const centers = new Float32Array(data.counts * 3);
  data.fillCenters(centers);
  const sampleCount = Math.min(data.counts, 50_000);
  const axes = [[], [], []] as [number[], number[], number[]];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const index = Math.min(data.counts - 1, Math.floor((sample / sampleCount) * data.counts)) * 3;
    for (let axis = 0; axis < 3; axis += 1) axes[axis].push(centers[index + axis]);
  }
  axes.forEach((axis) => axis.sort((left, right) => left - right));
  const low = Math.floor(sampleCount * 0.01);
  const high = Math.max(low, Math.ceil(sampleCount * 0.99) - 1);
  return { min: [axes[0][low], axes[1][low], axes[2][low]], max: [axes[0][high], axes[1][high], axes[2][high]] };
}

function alignVisualLayer(
  aholo: typeof import('@manycore/aholo-viewer'),
  splat: import('@manycore/aholo-viewer').Splat,
  native: { min: Point3; max: Point3 },
  nativeUpAxis: 'Y' | 'Z',
  anchors: SpatialAnchorSet | null,
): AlignmentResult {
  if (!anchors) return { status: 'unverified', message: '视觉层已加载；缺少锁定空间锚点，坐标对齐尚未验收' };
  const rotated = nativeUpAxis === 'Z' ? rotateBoundsZToY(native) : native;
  const sourceSpan = span(rotated);
  const target = anchors.bounds;
  const targetSpan = span(target);
  if (Math.min(sourceSpan[0], sourceSpan[2], targetSpan[0], targetSpan[2]) <= 0.01) {
    return { status: 'untrusted', message: '视觉层不可信：3DGS 或锁定空间边界无效' };
  }
  const scale = Math.min(targetSpan[0] / sourceSpan[0], targetSpan[2] / sourceSpan[2]) * 0.98;
  const sourceCenter = centerOf(rotated);
  const targetCenter = centerOf(target);
  splat.scale.set(scale, scale, scale);
  if (nativeUpAxis === 'Z') splat.quaternion.setFromAxisAngle(new aholo.Vector3(1, 0, 0), -Math.PI / 2);
  splat.position.set(
    targetCenter[0] - sourceCenter[0] * scale,
    anchors.walkableBounds.min[1] - rotated.min[1] * scale,
    targetCenter[2] - sourceCenter[2] * scale,
  );
  const sourceAspect = sourceSpan[0] / sourceSpan[2];
  const targetAspect = targetSpan[0] / targetSpan[2];
  const aspectDrift = Math.abs(Math.log(sourceAspect / targetAspect));
  const heightRatio = (sourceSpan[1] * scale) / Math.max(targetSpan[1], 0.1);
  if (aspectDrift > 0.32 || heightRatio < 0.45 || heightRatio > 1.8) {
    return {
      status: 'untrusted',
      message: `视觉层不可信：与锁定户型比例漂移（平面偏差 ${Math.round((Math.exp(aspectDrift) - 1) * 100)}%）`,
    };
  }
  return { status: 'aligned', message: '视觉层已按锁定空间对齐；墙体与入口仍由语义碰撞层约束' };
}

function moveCamera(
  position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => unknown },
  yaw: number,
  keys: Set<string>,
  delta: number,
  anchors: SpatialAnchorSet | null,
  fallback: { min: Point3; max: Point3 },
): boolean {
  let forward = 0;
  let right = 0;
  if (keys.has('w') || keys.has('arrowup')) forward += 1;
  if (keys.has('s') || keys.has('arrowdown')) forward -= 1;
  if (keys.has('d') || keys.has('arrowright')) right += 1;
  if (keys.has('a') || keys.has('arrowleft')) right -= 1;
  if (!forward && !right) return false;
  const length = Math.hypot(forward, right);
  const speed = 1.75 * delta;
  const next: Point3 = [
    position.x + ((Math.sin(yaw) * forward + Math.cos(yaw) * right) / length) * speed,
    position.y,
    position.z + ((-Math.cos(yaw) * forward + Math.sin(yaw) * right) / length) * speed,
  ];
  const walkable = anchors?.walkableBounds ?? fallback;
  next[0] = clamp(next[0], walkable.min[0] + 0.22, walkable.max[0] - 0.22);
  next[2] = clamp(next[2], walkable.min[2] + 0.22, walkable.max[2] - 0.22);
  if (anchors && collidesWithWall(next, anchors)) return false;
  position.set(...next);
  return true;
}

function collidesWithWall(position: Point3, anchors: SpatialAnchorSet): boolean {
  return anchors.surfaces.some((surface) => surface.kind === 'wall'
    && position[0] >= surface.bounds.min[0] - 0.2
    && position[0] <= surface.bounds.max[0] + 0.2
    && position[2] >= surface.bounds.min[2] - 0.2
    && position[2] <= surface.bounds.max[2] + 0.2);
}

function viewBounds(anchors: SpatialAnchorSet | null, native: { min: Point3; max: Point3 }, nativeUpAxis: 'Y' | 'Z') {
  return anchors?.bounds ?? (nativeUpAxis === 'Z' ? rotateBoundsZToY(native) : native);
}

function rotateBoundsZToY(bounds: { min: Point3; max: Point3 }) {
  return { min: [bounds.min[0], bounds.min[2], -bounds.max[1]] as Point3, max: [bounds.max[0], bounds.max[2], -bounds.min[1]] as Point3 };
}

function overviewPosition(bounds: { min: Point3; max: Point3 }): Point3 {
  const center = centerOf(bounds);
  const extent = Math.max(...span(bounds));
  return [center[0] + extent * 0.8, center[1] + extent * 0.62, center[2] + extent * 0.88];
}

function entrancePosition(anchors: SpatialAnchorSet | null, bounds: { min: Point3; max: Point3 }): Point3 {
  if (!anchors) {
    const center = centerOf(bounds);
    return [center[0], bounds.min[1] + 1.65, bounds.max[2] - 0.35];
  }
  return [anchors.entrance.position[0], anchors.walkableBounds.min[1] + anchors.entrance.cameraHeight, anchors.entrance.position[2]];
}

function entranceYaw(anchors: SpatialAnchorSet | null): number {
  return anchors ? Math.atan2(anchors.entrance.direction[0], -anchors.entrance.direction[2]) : 0;
}

function directionFromAngles(yaw: number, pitch: number): Point3 {
  const horizontal = Math.cos(pitch);
  return [Math.sin(yaw) * horizontal, Math.sin(pitch), -Math.cos(yaw) * horizontal];
}

function readNativeUpAxis(value: unknown, fallback: 'X' | 'Y' | 'Z'): 'Y' | 'Z' {
  if (value === 'Y' || value === 'Z') return value;
  if (fallback === 'Y' || fallback === 'Z') return fallback;
  throw viewerError('coordinate_system_unsupported', `Aholo Viewer 不支持 ${fallback}-up 视觉层`);
}

function centerOf(bounds: { min: Point3; max: Point3 }): Point3 {
  return bounds.min.map((value, index) => (value + bounds.max[index]) / 2) as Point3;
}

function span(bounds: { min: Point3; max: Point3 }): Point3 {
  return bounds.min.map((value, index) => bounds.max[index] - value) as Point3;
}

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

function assertWebGl2() {
  const canvas = document.createElement('canvas');
  if (!canvas.getContext('webgl2')) throw viewerError('viewer_webgl2_unsupported', '当前设备不支持 Aholo Viewer 所需的 WebGL2');
}

function isLowPowerDevice(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return navigator.hardwareConcurrency <= 4 || (typeof memory === 'number' && memory <= 4);
}

function viewerError(code: string, message: string, cause?: unknown): Error & { code: string; cause?: unknown } {
  return Object.assign(new Error(`${message} [${code}]`), { code, cause });
}
