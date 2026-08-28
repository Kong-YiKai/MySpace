import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { EditableRoomObject, SceneManifest, WallpaperPreset } from '@spatial-intelligence/contracts';
import type { ObjectColors } from '../domain/experience';

interface RoomSceneProps {
  decorated: boolean;
  immersive: boolean;
  oneBedroom: boolean;
  wallpaper: WallpaperPreset;
  objectColors: ObjectColors;
  selectedObject: EditableRoomObject | null;
  onSelect: (objectId: EditableRoomObject | null) => void;
  manifest?: SceneManifest | null;
  preview?: boolean;
}

const wallpaperColors: Record<WallpaperPreset, string> = {
  'cream-white': '#f1eee6',
  'oat-beige': '#dfd3bf',
  'sage-mist': '#d7ded3',
};

export function RoomScene({
  decorated,
  immersive,
  oneBedroom,
  wallpaper,
  objectColors,
  selectedObject,
  onSelect,
  manifest = null,
  preview = false,
}: RoomSceneProps) {
  return (
    <div className="room-canvas" data-testid="room-scene">
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{ position: [7.4, 5.2, 8.4], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#f8f5ef']} />
        <fog attach="fog" args={['#f5f1e9', 10.5, 24]} />
        <ambientLight intensity={1.08} color="#fff8ee" />
        <directionalLight
          castShadow
          color="#ffe8ca"
          intensity={1.75}
          position={[5, 8, 6]}
          shadow-mapSize={[1024, 1024]}
          shadow-camera-far={22}
          shadow-camera-left={-7}
          shadow-camera-right={7}
          shadow-camera-top={7}
          shadow-camera-bottom={-7}
        />
        <hemisphereLight args={['#fffdf8', '#aaa297', 0.68]} />
        <RoomShell wallpaper={wallpaper} oneBedroom={oneBedroom} manifest={manifest} immersive={immersive} />
        {decorated && (
          <Furnishings
            colors={objectColors}
            selectedObject={selectedObject}
            onSelect={preview ? () => undefined : onSelect}
          />
        )}
        <CameraRig immersive={immersive} preview={preview} />
      </Canvas>
      {!preview && !immersive && <div className="orbit-hint">拖动旋转 · 滚轮缩放 · 点击物体</div>}
    </div>
  );
}

function RoomShell({
  wallpaper,
  oneBedroom,
  manifest,
  immersive,
}: {
  wallpaper: WallpaperPreset;
  oneBedroom: boolean;
  manifest: SceneManifest | null;
  immersive: boolean;
}) {
  if (manifest) return <ManifestRoomShell manifest={manifest} wallpaper={wallpaper} immersive={immersive} />;
  const wallColor = wallpaperColors[wallpaper];
  return (
    <group>
      <gridHelper args={[18, 36, '#d8d1c5', '#e9e4dc']} position={[0, -0.1, 0]} />
      <mesh receiveShadow position={[0, -0.03, 0]}>
        <boxGeometry args={[8, 0.14, 6]} />
        <meshStandardMaterial color="#e9e4da" roughness={0.96} />
      </mesh>
      <mesh receiveShadow position={[0, 1.5, -3]}>
        <boxGeometry args={[8, 3, 0.16]} />
        <meshStandardMaterial color={wallColor} roughness={0.92} />
      </mesh>
      <mesh receiveShadow position={[-4, 1.5, 0]}>
        <boxGeometry args={[0.16, 3, 6]} />
        <meshStandardMaterial color={wallColor} roughness={0.92} />
      </mesh>
      <mesh position={[0.9, 1.75, -2.88]}>
        <boxGeometry args={[2.15, 1.25, 0.08]} />
        <meshPhysicalMaterial
          color="#dfe9e8"
          transparent
          opacity={0.62}
          roughness={0.22}
          transmission={0.08}
        />
      </mesh>
      <mesh position={[0.9, 1.75, -2.82]}>
        <boxGeometry args={[2.34, 1.43, 0.05]} />
        <meshStandardMaterial color="#f4f0e7" roughness={0.78} />
      </mesh>
      <mesh position={[0.9, 1.75, -2.75]}>
        <boxGeometry args={[2.14, 1.22, 0.06]} />
        <meshPhysicalMaterial color="#dfe9e8" transparent opacity={0.72} roughness={0.2} />
      </mesh>
      {oneBedroom && (
        <group>
          <mesh receiveShadow position={[2.0, 1.38, -1.35]}>
            <boxGeometry args={[0.14, 2.76, 3.15]} />
            <meshStandardMaterial color={wallColor} roughness={0.92} />
          </mesh>
          <mesh position={[2.0, 1.1, 0.65]}>
            <boxGeometry args={[0.18, 2.2, 0.86]} />
            <meshStandardMaterial color="#e3dacd" roughness={0.86} />
          </mesh>
        </group>
      )}
      <mesh receiveShadow position={[0, 0.015, 2.75]}>
        <boxGeometry args={[1.28, 0.04, 0.36]} />
        <meshStandardMaterial color="#caa477" roughness={0.86} />
      </mesh>
    </group>
  );
}

function ManifestRoomShell({
  manifest,
  wallpaper,
  immersive,
}: {
  manifest: SceneManifest;
  wallpaper: WallpaperPreset;
  immersive: boolean;
}) {
  const floor = manifest.entities.find((entity) => entity.kind === 'floor');
  const floorSize = primitiveOf(floor?.components)?.size ?? [10, 0.12, 8];
  const gridSize = Math.max(Number(floorSize[0]), Number(floorSize[2])) + 8;
  return (
    <group>
      <gridHelper args={[gridSize, Math.max(20, Math.round(gridSize * 2)), '#d8d1c5', '#e9e4dc']} position={[0, -0.13, 0]} />
      {manifest.entities.map((entity) => {
        if (!immersive && entity.kind === 'wall'
          && (entity.label === 'wall-east' || entity.label === 'wall-south')) return null;
        const primitive = primitiveOf(entity.components);
        if (!primitive || primitive.shape !== 'box') return null;
        const appearance = appearanceOf(entity.components);
        const color = entity.kind === 'wall' ? wallpaperColors[wallpaper] : appearance.color;
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
              color={color}
              roughness={appearance.roughness}
              transparent={appearance.transparent}
              opacity={appearance.opacity}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function primitiveOf(components: Record<string, unknown> | undefined): {
  shape: string;
  size: [number, number, number];
} | null {
  const primitive = components?.primitive;
  if (!primitive || typeof primitive !== 'object') return null;
  const candidate = primitive as { shape?: unknown; size?: unknown };
  if (candidate.shape !== 'box' || !Array.isArray(candidate.size) || candidate.size.length !== 3) return null;
  return { shape: candidate.shape, size: candidate.size.map(Number) as [number, number, number] };
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

interface SelectableProps {
  id: EditableRoomObject;
  onSelect: (objectId: EditableRoomObject) => void;
  children: ReactNode;
}

function Selectable({ id, onSelect, children }: SelectableProps) {
  const [hovered, setHovered] = useState(false);
  const activate = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(id);
  };
  return (
    <group
      onClick={activate}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'default';
      }}
      scale={hovered ? 1.018 : 1}
    >
      {children}
    </group>
  );
}

function materialProps(color: string, selected: boolean) {
  return {
    color,
    roughness: 0.76,
    metalness: 0.02,
    emissive: selected ? '#ffad68' : '#000000',
    emissiveIntensity: selected ? 0.18 : 0,
  };
}

function Furnishings({
  colors,
  selectedObject,
  onSelect,
}: {
  colors: ObjectColors;
  selectedObject: EditableRoomObject | null;
  onSelect: (objectId: EditableRoomObject) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const appeared = useRef(0);
  useFrame((_, delta) => {
    appeared.current = THREE.MathUtils.damp(appeared.current, 1, 4.8, delta);
    group.current?.scale.setScalar(appeared.current);
  });

  return (
    <group ref={group}>
      <Selectable id="rug" onSelect={onSelect}>
        <mesh receiveShadow position={[-0.3, 0.08, 0.1]}>
          <boxGeometry args={[4.6, 0.08, 2.65]} />
          <meshStandardMaterial {...materialProps(colors.rug, selectedObject === 'rug')} roughness={0.98} />
        </mesh>
      </Selectable>

      <Selectable id="sofa" onSelect={onSelect}>
        <group position={[-0.55, 0.55, -1.48]}>
          <mesh castShadow receiveShadow position={[0, 0, 0]}>
            <boxGeometry args={[3.15, 0.48, 0.88]} />
            <meshStandardMaterial {...materialProps(colors.sofa, selectedObject === 'sofa')} />
          </mesh>
          <mesh castShadow position={[0, 0.43, -0.31]} rotation={[-0.11, 0, 0]}>
            <boxGeometry args={[3.12, 0.83, 0.28]} />
            <meshStandardMaterial {...materialProps(colors.sofa, selectedObject === 'sofa')} />
          </mesh>
          {[-1.36, 1.36].map((x) => (
            <mesh key={x} castShadow position={[x, 0.24, 0]}>
              <boxGeometry args={[0.36, 0.66, 0.95]} />
              <meshStandardMaterial {...materialProps(colors.sofa, selectedObject === 'sofa')} />
            </mesh>
          ))}
          {[-0.76, 0, 0.76].map((x) => (
            <mesh key={x} castShadow position={[x, 0.31, 0.04]}>
              <boxGeometry args={[0.68, 0.18, 0.72]} />
              <meshStandardMaterial color="#eee5d6" roughness={0.94} />
            </mesh>
          ))}
        </group>
      </Selectable>

      <Selectable id="coffee-table" onSelect={onSelect}>
        <group position={[-0.25, 0, 0.65]}>
          <mesh castShadow receiveShadow position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.83, 0.83, 0.14, 48]} />
            <meshStandardMaterial {...materialProps(colors['coffee-table'], selectedObject === 'coffee-table')} roughness={0.5} />
          </mesh>
          <mesh castShadow position={[0, 0.21, 0]}>
            <cylinderGeometry args={[0.22, 0.31, 0.43, 32]} />
            <meshStandardMaterial color="#716963" roughness={0.7} />
          </mesh>
        </group>
      </Selectable>

      <Selectable id="vase" onSelect={onSelect}>
        <group position={[-0.25, 0.58, 0.65]}>
          <mesh castShadow position={[0, 0.13, 0]}>
            <cylinderGeometry args={[0.12, 0.18, 0.28, 32]} />
            <meshStandardMaterial {...materialProps(colors.vase, selectedObject === 'vase')} roughness={0.62} />
          </mesh>
          <mesh castShadow position={[0, 0.34, 0]}>
            <sphereGeometry args={[0.18, 28, 18]} />
            <meshStandardMaterial {...materialProps(colors.vase, selectedObject === 'vase')} roughness={0.62} />
          </mesh>
        </group>
      </Selectable>

      <Selectable id="plant" onSelect={onSelect}>
        <group position={[2.8, 0, -1.95]}>
          <mesh castShadow position={[0, 0.38, 0]}>
            <cylinderGeometry args={[0.34, 0.27, 0.72, 28]} />
            <meshStandardMaterial color="#d8c3ad" roughness={0.86} />
          </mesh>
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const angle = index * 1.05;
            return (
              <mesh
                key={index}
                castShadow
                position={[Math.sin(angle) * 0.28, 0.95 + (index % 2) * 0.2, Math.cos(angle) * 0.28]}
                rotation={[0.15, angle, 0.62]}
              >
                <sphereGeometry args={[0.16, 18, 12]} />
                <meshStandardMaterial {...materialProps(colors.plant, selectedObject === 'plant')} roughness={0.94} />
              </mesh>
            );
          })}
        </group>
      </Selectable>

      <Selectable id="floor-lamp" onSelect={onSelect}>
        <group position={[-2.9, 0, -1.85]}>
          <mesh castShadow position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.28, 0.34, 0.2, 32]} />
            <meshStandardMaterial color="#8f857c" roughness={0.66} />
          </mesh>
          <mesh castShadow position={[0, 0.96, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 1.55, 20]} />
            <meshStandardMaterial color="#8f857c" roughness={0.55} />
          </mesh>
          <mesh castShadow position={[0, 1.72, 0]}>
            <coneGeometry args={[0.43, 0.58, 32, 1, true]} />
            <meshStandardMaterial
              {...materialProps(colors['floor-lamp'], selectedObject === 'floor-lamp')}
              side={THREE.DoubleSide}
            />
          </mesh>
          <pointLight position={[0, 1.52, 0]} color="#ffd7a1" intensity={1.2} distance={3.2} />
        </group>
      </Selectable>
    </group>
  );
}

function CameraRig({ immersive, preview }: { immersive: boolean; preview: boolean }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const yaw = useRef(0);
  const pitch = useRef(0);
  const dragging = useRef(false);
  const previous = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (immersive) return undefined;
    camera.position.set(7.4, 5.2, 8.4);
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 0.75, -0.35);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 4.8;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.autoRotate = preview;
    controls.autoRotateSpeed = 0.35;
    controls.update();

    let frame = 0;
    const tick = () => {
      controls.update();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      controls.dispose();
    };
  }, [camera, gl.domElement, immersive, preview]);

  useEffect(() => {
    if (!immersive) return undefined;
    camera.position.set(0, 1.65, 2.55);
    yaw.current = 0;
    pitch.current = 0;
    camera.rotation.set(0, 0, 0, 'YXZ');

    const down = (event: KeyboardEvent) => keys.current.add(event.key.toLowerCase());
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const pointerDown = (event: PointerEvent) => {
      dragging.current = true;
      previous.current = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = () => { dragging.current = false; };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
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
  }, [camera, gl.domElement, immersive]);

  useFrame((_, delta) => {
    if (!immersive) return;
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
    const forward = new THREE.Vector3(Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, Math.sin(yaw.current));
    const movement = new THREE.Vector3();
    if (keys.current.has('w') || keys.current.has('arrowup')) movement.add(forward);
    if (keys.current.has('s') || keys.current.has('arrowdown')) movement.sub(forward);
    if (keys.current.has('d') || keys.current.has('arrowright')) movement.add(right);
    if (keys.current.has('a') || keys.current.has('arrowleft')) movement.sub(right);
    if (movement.lengthSq() > 0) {
      movement.normalize().multiplyScalar(delta * 2.15);
      camera.position.add(movement);
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, -3.45, 3.45);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, -2.35, 2.65);
    }
  });

  return null;
}
