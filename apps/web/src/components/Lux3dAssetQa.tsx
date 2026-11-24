import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface QaStats {
  meshes: number;
  materials: number;
  textures: number;
  sourceSize: [number, number, number];
}

export function Lux3dAssetQa({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<QaStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new Scene();
    scene.background = new Color('#dedbd4');
    const camera = new PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(3.2, 2.1, 3.8);
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const hemisphere = new HemisphereLight('#fffaf0', '#8b857a', 2.4);
    scene.add(hemisphere);
    const key = new DirectionalLight('#fff4df', 4.5);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    scene.add(key);
    const fill = new DirectionalLight('#dbe7ff', 2.2);
    fill.position.set(-4, 2.5, 2);
    scene.add(fill);
    const floor = new Mesh(new PlaneGeometry(12, 12), new ShadowMaterial({ color: '#4b463f', opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new GridHelper(10, 20, '#aaa49a', '#c8c3ba');
    grid.position.y = 0.002;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.65, 0);
    let frame = 0;
    let disposed = false;
    const resize = () => {
      const width = Math.max(Math.min(host.getBoundingClientRect().width, window.innerWidth), 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    new GLTFLoader().load(url, (gltf) => {
      if (disposed) return;
      const bounds = new Box3().setFromObject(gltf.scene);
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const scale = 1.8 / Math.max(size.x, size.y, size.z);
      gltf.scene.scale.setScalar(scale);
      gltf.scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      const materials = new Set();
      const textures = new Set();
      let meshes = 0;
      gltf.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        meshes += 1;
        object.castShadow = true;
        object.receiveShadow = true;
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (value instanceof Texture) textures.add(value.uuid);
          }
        }
      });
      scene.add(gltf.scene);
      setStats({ meshes, materials: materials.size, textures: textures.size, sourceSize: [size.x, size.y, size.z] });
    }, undefined, (reason) => {
      setError(reason instanceof Error ? reason.message : 'GLB 加载失败');
    });
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr', background: '#dedbd4' }}>
      <header style={{ padding: '14px 20px', background: '#24221f', color: '#f8f4ec', display: 'flex', gap: 24, alignItems: 'center' }}>
        <strong>Lux3D 写实资产 QA</strong>
        {stats && <span>Mesh {stats.meshes} · Material {stats.materials} · Texture {stats.textures}</span>}
        {stats && <span>源包围盒 {stats.sourceSize.map((value) => value.toFixed(3)).join(' × ')}</span>}
        {error && <span style={{ color: '#ff9c91' }}>{error}</span>}
      </header>
      <div ref={hostRef} style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }} aria-label="Lux3D asset preview" />
    </main>
  );
}
