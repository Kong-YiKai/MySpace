import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  basicFurnitureKindSchema, isStairRoom, normalizedAssetTransformSchema, pointInPlanPolygon, structuredFloorPlanSchema,
  type SceneManifest, type SpatialAnchorSet,
} from '@spatial-intelligence/contracts';
import { BasicFurniture } from './BasicFurniture';
import { AholoSplatScene } from './AholoSplatScene';
import { MobileMovementPad } from './MobileMovementPad';

interface RoomSceneProps {
  immersive: boolean;
  layoutOnly?: boolean;
  manifest?: SceneManifest | null;
  preview?: boolean;
  spatialAnchors?: SpatialAnchorSet | null;
  furnitureEdit?: { busy: boolean; message: string; undoable: boolean };
  onTransformFurniture?: (id: string, transform: SceneEntity['transform']) => void;
  onUndoFurniture?: () => void;
}

type SceneEntity = SceneManifest['entities'][number];
interface SceneMetrics {
  width: number;
  depth: number;
  entrance: [number, number, number];
  entranceDirection: [number, number];
  cameraHeight: number;
  walkableBounds: SpatialAnchorSet['walkableBounds'];
}

export function RoomScene({
  immersive,
  layoutOnly = false,
  manifest = null,
  preview = false,
  spatialAnchors = null,
  furnitureEdit,
  onTransformFurniture,
  onUndoFurniture,
}: RoomSceneProps) {
  if (!manifest) return <div className="room-canvas room-placeholder" data-testid="room-scene" />;
  if (!layoutOnly && manifest.assets.some((asset) => asset.kind === 'splat')) {
    return <AholoSplatScene manifest={manifest} immersive={immersive} spatialAnchors={spatialAnchors} />;
  }
  return <LocalRoomScene {...{ manifest, immersive, preview, spatialAnchors, furnitureEdit, onTransformFurniture, onUndoFurniture }} />;
}

function LocalRoomScene({ manifest, immersive, preview, spatialAnchors, furnitureEdit, onTransformFurniture, onUndoFurniture }: {
  manifest: SceneManifest;
  immersive: boolean;
  preview: boolean;
  spatialAnchors: SpatialAnchorSet | null;
} & Pick<RoomSceneProps, 'furnitureEdit' | 'onTransformFurniture' | 'onUndoFurniture'>) {
  const metrics = useMemo(() => sceneMetrics(manifest, spatialAnchors), [manifest, spatialAnchors]);
  const [selectedFurniture, setSelectedFurniture] = useState<string | null>(null);
  const [failedAsset, setFailedAsset] = useState<string | null>(null);
  const draggingFurniture = useRef(false);
  const furniture = manifest.entities.filter((entity) => entity.interactive && entity.kind.startsWith('furniture:'));
  const selected = furniture.find((entity) => entity.id === selectedFurniture);
  const movementAllowed = useMemo(() => buildMovementCheck(manifest), [manifest]);
  const select = (id: string) => { if (!furnitureEdit?.busy) setSelectedFurniture(id); };
  return (
    <div className="room-canvas" data-testid="room-scene">
      <Canvas
        shadows="basic"
        dpr={[1, 1.6]}
        camera={{ position: overviewPosition(metrics), fov: 42, near: 0.1, far: 200 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#f8f5ef']} />
        <fog
          attach="fog"
          args={[
            '#f5f1e9',
            Math.max(metrics.width, metrics.depth) * 1.4,
            Math.max(metrics.width, metrics.depth) * 3,
          ]}
        />
        <ambientLight intensity={1.08} color="#fff8ee" />
        <directionalLight castShadow color="#ffe8ca" intensity={1.75} position={[5, 8, 6]} />
        <hemisphereLight args={['#fffdf8', '#aaa297', 0.68]} />
        <ManifestRoomShell manifest={manifest} immersive={immersive} metrics={metrics} />
        {furniture.map((entity) => {
          const asset = manifest.assets.find((entry) => entry.kind === 'mesh' && entity.assetRefs.includes(entry.id));
          return (
            <RoomFurniture
              key={entity.id}
              entity={entity}
              uri={asset?.uri}
              onSelect={select}
              onLoadFailure={setFailedAsset}
              onTransform={selected?.id === entity.id && !furnitureEdit?.busy ? onTransformFurniture : undefined}
              draggingFurniture={draggingFurniture}
            />
          );
        })}
        <CameraRig immersive={immersive} preview={preview} metrics={metrics}
          movementAllowed={movementAllowed} draggingFurniture={draggingFurniture} />
      </Canvas>
      {!preview && !immersive && <div className="orbit-hint">拖动旋转 · 滚轮缩放</div>}
      {immersive && <MobileMovementPad />}
      {failedAsset && (
        <div className="mesh-fallback-status" role="status">
          {failedAsset}的模型加载失败
        </div>
      )}
      {!preview && onTransformFurniture && furniture.length > 0 && (
        <div className="furniture-editor" aria-label="家具编辑">
          <select aria-label="选择家具" value={selected?.id ?? ''} onChange={(event) => select(event.target.value)}
            disabled={furnitureEdit?.busy}>
            <option value="">选择家具</option>
            {furniture.map((entity) => <option key={entity.id} value={entity.id}>{furnitureLabel(entity, manifest)}</option>)}
          </select>
          <button type="button" disabled={!selected || furnitureEdit?.busy}
            onClick={() => selected && onTransformFurniture(selected.id, rotateFurniture(selected.transform))}>
            旋转 90°
          </button>
          <button type="button" disabled={!furnitureEdit?.undoable || furnitureEdit.busy} onClick={onUndoFurniture}>撤销</button>
          {selected && !furnitureEdit?.message && <small>拖动场景中的箭头移动家具</small>}
          {furnitureEdit?.message && <small role="status">{furnitureEdit.message}</small>}
        </div>
      )}
    </div>
  );
}

function RoomFurniture({ entity, uri, onSelect, onLoadFailure, onTransform, draggingFurniture }: {
  entity: SceneEntity;
  uri?: string;
  onSelect: (id: string) => void;
  onLoadFailure: (label: string) => void;
  onTransform?: RoomSceneProps['onTransformFurniture'];
  draggingFurniture: React.RefObject<boolean>;
}) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const group = useRef<THREE.Group>(null);
  const normalization = normalizedAssetTransformSchema.safeParse(entity.components.assetNormalization);
  const basic = entity.components.basicFurniture as { kind?: unknown; size?: [number, number, number] } | undefined;
  const basicKind = basicFurnitureKindSchema.safeParse(basic?.kind).data;
  useEffect(() => {
    if (!uri) return;
    let active = true;
    setModel(null);
    new GLTFLoader().load(uri, ({ scene }) => {
      if (active) setModel(scene);
    }, undefined, () => {
      if (active) onLoadFailure(entity.label);
    });
    return () => { active = false; };
  }, [uri, entity.label, onLoadFailure]);

  const { camera, gl, scene } = useThree();
  const commit = useRef(onTransform);
  commit.current = onTransform;
  const editable = Boolean(onTransform);
  useEffect(() => {
    const object = group.current;
    if (!editable || !object) return;
    const control = new TransformControls(camera, gl.domElement);
    control.setMode('translate');
    control.showY = false;
    control.setSize(0.75);
    control.setTranslationSnap(0.05);
    control.attach(object);
    scene.add(control.getHelper());
    const start = () => { draggingFurniture.current = true; };
    const finish = () => {
      draggingFurniture.current = false;
      const position = object.position.toArray();
      // The server owns the position. Keep the committed pose until it accepts the drop.
      object.position.fromArray(entity.transform.position);
      if (position.every((value, axis) => Math.abs(value - entity.transform.position[axis]!) < 1e-4)) return;
      commit.current?.(entity.id, { ...entity.transform, position });
    };
    control.addEventListener('mouseDown', start);
    control.addEventListener('mouseUp', finish);
    return () => {
      draggingFurniture.current = false;
      scene.remove(control.getHelper());
      control.detach();
      control.dispose();
    };
  }, [editable, camera, gl.domElement, scene, entity, draggingFurniture]);

  return (
    <group
      ref={group}
      position={entity.transform.position}
      quaternion={entity.transform.rotation}
      scale={entity.transform.scale}
      onClick={(event) => {
        if (event.delta > 5) return;
        event.stopPropagation();
        onSelect(entity.id);
      }}
    >
      {basicKind && basic?.size && <BasicFurniture kind={basicKind} size={basic.size} />}
      {model && <group
        position={normalization.data?.translationMeters}
        quaternion={normalization.data?.rotationQuaternion}
        scale={normalization.data?.scale}
      >
        <primitive object={model} />
      </group>}
    </group>
  );
}

function rotateFurniture(transform: SceneEntity['transform']): SceneEntity['transform'] {
  const rotation = new THREE.Quaternion().fromArray(transform.rotation)
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
  return { ...transform, rotation: rotation.toArray() };
}

function furnitureLabel(entity: SceneEntity, manifest: SceneManifest): string {
  const id = (entity.components.basicFurniture as { roomId?: string } | undefined)?.roomId;
  const plan = manifest.metadata.floorPlan as { rooms?: Array<{ id: string; label: string }> } | undefined;
  const room = plan?.rooms?.find((entry) => entry.id === id)?.label;
  return room ? `${room} · ${entity.label}` : entity.label;
}

function ManifestRoomShell({
  manifest,
  immersive,
  metrics,
}: {
  manifest: SceneManifest;
  immersive: boolean;
  metrics: SceneMetrics;
}) {
  const gridSize = Math.max(metrics.width, metrics.depth) + 8;
  return (
    <group>
      <gridHelper
        args={[gridSize, Math.max(20, Math.round(gridSize * 2)), '#d8d1c5', '#e9e4dc']}
        position={[0, -0.13, 0]}
      />
      {manifest.entities.map((entity) => {
        const primitive = primitiveOf(entity.components);
        if (!primitive) return null;
        const appearance = appearanceOf(entity.components);
        const isOverviewWall = !immersive && entity.kind === 'wall';
        return (
          <mesh
            key={entity.id}
            castShadow={entity.kind !== 'floor'}
            receiveShadow
            position={entity.transform.position}
            quaternion={entity.transform.rotation}
            scale={entity.transform.scale}
          >
            <boxGeometry args={primitive.size} />
            <meshStandardMaterial
              color={appearance.color}
              roughness={appearance.roughness}
              transparent={appearance.transparent || isOverviewWall}
              opacity={isOverviewWall ? 0.55 : appearance.opacity}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function primitiveOf(components: Record<string, unknown> | undefined): {
  size: [number, number, number];
} | null {
  const primitive = components?.primitive;
  if (!primitive || typeof primitive !== 'object') return null;
  const candidate = primitive as { shape?: unknown; size?: unknown };
  if (candidate.shape !== 'box' || !Array.isArray(candidate.size) || candidate.size.length !== 3) {
    return null;
  }
  return { size: candidate.size.map(Number) as [number, number, number] };
}

function appearanceOf(components: Record<string, unknown>): {
  color: string;
  roughness: number;
  transparent: boolean;
  opacity: number;
} {
  const candidate = (components.appearance ?? {}) as Record<string, unknown>;
  return {
    color: typeof candidate.color === 'string' ? candidate.color : '#f1eee6',
    roughness: typeof candidate.roughness === 'number' ? candidate.roughness : 0.9,
    transparent: candidate.transparent === true,
    opacity: typeof candidate.opacity === 'number' ? candidate.opacity : 1,
  };
}

function sceneMetrics(manifest: SceneManifest, anchors: SpatialAnchorSet | null): SceneMetrics {
  const floorPlan = manifest.metadata.floorPlan as Record<string, unknown> | undefined;
  const width = positiveNumber(floorPlan?.width) ?? entitySpan(manifest, 0) ?? 8;
  const depth = positiveNumber(floorPlan?.depth) ?? entitySpan(manifest, 2) ?? 6;
  const anchor = manifest.entities.find(
    (entity) => entity.kind === 'anchor' && entity.tags.includes('entrance'),
  );
  const entrance = anchors?.entrance.position ?? anchor?.transform.position ?? [0, 0, depth / 2 - 0.4];
  const entranceData = floorPlan?.entrance as Record<string, unknown> | undefined;
  const direction = entranceData?.direction;
  const entranceDirection: [number, number] = anchors
    ? [anchors.entrance.direction[0], anchors.entrance.direction[2]]
    : Array.isArray(direction) && direction.length === 2
    ? [Number(direction[0]), Number(direction[1])]
    : [0, -1];
  return {
    width,
    depth,
    entrance: [...entrance] as [number, number, number],
    entranceDirection,
    cameraHeight: anchors?.entrance.cameraHeight ?? 1.65,
    walkableBounds: anchors?.walkableBounds ?? {
      min: [-width / 2, 0, -depth / 2],
      max: [width / 2, 0, depth / 2],
    },
  };
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function entitySpan(manifest: SceneManifest, axis: 0 | 2): number | null {
  const bounds = manifest.entities.flatMap((entity) => {
    const primitive = primitiveOf(entity.components);
    if (!primitive) return [];
    const half = primitive.size[axis] / 2;
    return [entity.transform.position[axis] - half, entity.transform.position[axis] + half];
  });
  return bounds.length ? Math.max(...bounds) - Math.min(...bounds) : null;
}

function overviewPosition(metrics: SceneMetrics): [number, number, number] {
  const extent = Math.max(metrics.width, metrics.depth);
  return [extent * 0.82, extent * 0.72, extent * 0.88];
}

function buildMovementCheck(manifest: SceneManifest) {
  const plan = structuredFloorPlanSchema.safeParse(manifest.metadata.floorPlan).data;
  const stairs = plan?.rooms.filter(isStairRoom) ?? [];
  const obstacles = manifest.entities.flatMap((entity) => {
    const primitive = entity.kind === 'wall' ? primitiveOf(entity.components) : null;
    const bounds = (entity.components.collider as {
      bounds?: { min: [number, number, number]; max: [number, number, number] };
    } | undefined)?.bounds;
    if (!primitive && !bounds) return [];
    const center = new THREE.Vector3(...entity.transform.position);
    const inverse = new THREE.Quaternion(...entity.transform.rotation).invert();
    const half = primitive?.size.map((value, axis) => value * entity.transform.scale[axis]! / 2);
    const box = bounds ?? {
      min: [-half![0]!, -half![1]!, -half![2]!],
      max: [half![0]!, half![1]!, half![2]!],
    };
    const worldY = entity.transform.position[1];
    if (worldY + box.min[1]! >= 1.78 || worldY + box.max[1]! <= 0.13) return [];
    return [{ center, inverse, box }];
  });
  const point = new THREE.Vector3();
  return (x: number, z: number) => {
    if (plan && stairs.some((room) => pointInPlanPolygon([x + plan.width / 2, z + plan.depth / 2], room.polygon))) {
      return false;
    }
    return !obstacles.some(({ center, inverse, box }) => {
      point.set(x, center.y, z).sub(center).applyQuaternion(inverse);
      return point.x > box.min[0]! - 0.16 && point.x < box.max[0]! + 0.16
        && point.z > box.min[2]! - 0.16 && point.z < box.max[2]! + 0.16;
    });
  };
}

function CameraRig({
  immersive,
  preview,
  metrics,
  movementAllowed,
  draggingFurniture,
}: {
  immersive: boolean;
  preview: boolean;
  metrics: SceneMetrics;
  movementAllowed: (x: number, z: number) => boolean;
  draggingFurniture: React.RefObject<boolean>;
}) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const dragging = useRef(false);
  const previous = useRef({ x: 0, y: 0 });
  const overview = useMemo(() => overviewPosition(metrics), [metrics]);
  const [entranceX, entranceY, entranceZ] = metrics.entrance;
  const [directionX, directionZ] = metrics.entranceDirection;
  const { cameraHeight, walkableBounds } = metrics;
  const currentMovementCheck = useRef(movementAllowed);
  currentMovementCheck.current = movementAllowed;

  useEffect(() => {
    if (immersive) return undefined;
    camera.position.set(...overview);
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 0.75, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = Math.max(metrics.width, metrics.depth) * 0.45;
    controls.maxDistance = Math.max(metrics.width, metrics.depth) * 2.6;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.autoRotate = preview;
    controls.autoRotateSpeed = 0.35;
    controls.update();
    let frame = requestAnimationFrame(function tick() {
      controls.enabled = !draggingFurniture.current;
      controls.update();
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      controls.dispose();
    };
  }, [camera, gl.domElement, immersive, metrics, overview, preview, draggingFurniture]);

  useEffect(() => {
    if (!immersive) return undefined;
    // An estimated landing can sit a few centimeters inside the stair outline.
    // Spawn just beyond it in the planned entry direction so movement starts on the floor.
    let x = entranceX;
    let z = entranceZ;
    for (let distance = 0; distance <= 1.5; distance += 0.1) {
      const candidateX = entranceX + directionX * distance;
      const candidateZ = entranceZ + directionZ * distance;
      if (currentMovementCheck.current(candidateX, candidateZ)) {
        x = candidateX;
        z = candidateZ;
        break;
      }
    }
    camera.position.set(x, entranceY + cameraHeight, z);
    yaw.current = Math.atan2(-directionX, -directionZ);
    pitch.current = 0;
    camera.rotation.set(0, yaw.current, 0, 'YXZ');
    const down = (event: KeyboardEvent) => keys.current.add(event.key.toLowerCase());
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const pointerDown = (event: PointerEvent) => {
      dragging.current = true;
      previous.current = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = () => { dragging.current = false; };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current || draggingFurniture.current) return;
      yaw.current -= (event.clientX - previous.current.x) * 0.004;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - (event.clientY - previous.current.y) * 0.0035,
        -1.15,
        1.15,
      );
      previous.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    gl.domElement.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointermove', pointerMove);
    return () => {
      keys.current.clear();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      gl.domElement.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointermove', pointerMove);
    };
  }, [camera, gl.domElement, immersive, entranceX, entranceY, entranceZ, cameraHeight, directionX, directionZ, draggingFurniture]);

  useFrame((_, delta) => {
    if (!immersive || draggingFurniture.current) return;
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    const movement = new THREE.Vector3();
    if (keys.current.has('w') || keys.current.has('arrowup')) movement.add(forward);
    if (keys.current.has('s') || keys.current.has('arrowdown')) movement.sub(forward);
    if (keys.current.has('d') || keys.current.has('arrowright')) movement.add(right);
    if (keys.current.has('a') || keys.current.has('arrowleft')) movement.sub(right);
    if (movement.lengthSq() > 0) {
      movement.normalize().multiplyScalar(Math.min(delta, 0.05) * 2.15);
      const x = THREE.MathUtils.clamp(
        camera.position.x + movement.x,
        walkableBounds.min[0] + 0.2,
        walkableBounds.max[0] - 0.2,
      );
      const z = THREE.MathUtils.clamp(
        camera.position.z + movement.z,
        walkableBounds.min[2] + 0.2,
        walkableBounds.max[2] - 0.2,
      );
      // Test each axis separately so movement slides along a wall.
      if (movementAllowed(x, camera.position.z)) camera.position.x = x;
      if (movementAllowed(camera.position.x, z)) camera.position.z = z;
    }
  });
  return null;
}
