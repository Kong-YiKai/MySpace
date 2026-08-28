import * as THREE from 'three';

/**
 * 远景环境的纯配置。实际可活动范围仍由 scene-config.js 的
 * clampPlayerPosition 控制；这里所有网格都只是用于遮蔽边界、补足景深。
 */
export const BATTLE_ENVIRONMENT_DEFAULTS = Object.freeze({
  // 海面已扩展到实际潮沟之外，天空与雾距同步拉远，避免边界在有限视野中露出。
  skyRadius: 128,
  skySegments: Object.freeze({ width: 48, height: 24 }),
  fog: Object.freeze({ color: '#b9e4e8', near: 42, far: 94 }),
  horizonZ: 78,
});

const CLOUD_LAYER_SPEC = Object.freeze([
  Object.freeze({ id: 'macro-cumulus', scale: 0.24, speed: 0.0028 }),
  Object.freeze({ id: 'broken-cumulus', scale: 0.54, speed: -0.0046 }),
  Object.freeze({ id: 'high-wisps', scale: 1.08, speed: 0.0078 }),
]);

const BOUNDARY_BLUEPRINT = Object.freeze([
  // 岩石、围栏和后方收口已改由 main.js 中的 Lux3D 环境资产负责；这里仅保留远方海雾。
  Object.freeze({ id: 'front-surf', kind: 'front-surf' }),
]);

export function createBattleEnvironmentSpec(overrides = {}) {
  const values = {
    ...BATTLE_ENVIRONMENT_DEFAULTS,
    ...overrides,
    skySegments: {
      ...BATTLE_ENVIRONMENT_DEFAULTS.skySegments,
      ...(overrides.skySegments ?? {}),
    },
    fog: {
      ...BATTLE_ENVIRONMENT_DEFAULTS.fog,
      ...(overrides.fog ?? {}),
    },
  };

  return Object.freeze({
    sky: Object.freeze({
      kind: 'procedural-cloud-dome',
      followsCamera: true,
      radius: values.skyRadius,
      segments: Object.freeze({ ...values.skySegments }),
      cloudLayers: CLOUD_LAYER_SPEC,
    }),
    atmosphere: Object.freeze({ ...values.fog }),
    boundaries: Object.freeze(BOUNDARY_BLUEPRINT.map((boundary) => Object.freeze({
      ...boundary,
      x: 0,
      z: values.horizonZ,
    }))),
    values: Object.freeze({
      ...values,
      skySegments: Object.freeze({ ...values.skySegments }),
      fog: Object.freeze({ ...values.fog }),
    }),
  });
}

function smoothNoiseStep(value) {
  return value * value * (3 - 2 * value);
}

function seededNoise(x, y, seed) {
  const value = Math.sin((x * 127.1) + (y * 311.7) + (seed * 74.7)) * 43758.5453123;
  return value - Math.floor(value);
}

function tiledValueNoise(x, y, frequency, seed) {
  const scaledX = x * frequency;
  const scaledY = y * frequency;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const x1 = (x0 + 1) % frequency;
  const y1 = (y0 + 1) % frequency;
  const wrappedX0 = ((x0 % frequency) + frequency) % frequency;
  const wrappedY0 = ((y0 % frequency) + frequency) % frequency;
  const tx = smoothNoiseStep(scaledX - x0);
  const ty = smoothNoiseStep(scaledY - y0);
  const a = seededNoise(wrappedX0, wrappedY0, seed);
  const b = seededNoise(x1, wrappedY0, seed);
  const c = seededNoise(wrappedX0, y1, seed);
  const d = seededNoise(x1, y1, seed);
  const low = a + (b - a) * tx;
  const high = c + (d - c) * tx;
  return low + (high - low) * ty;
}

function createCloudNoiseTexture(three) {
  // 一次性的 192px 平铺噪声，运行时只做少量纹理采样；不会把云计算压到每个屏幕像素。
  const size = 192;
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const macro = tiledValueNoise(u, v, 5, 3);
      const middle = tiledValueNoise(u, v, 11, 7);
      const fine = tiledValueNoise(u, v, 23, 17);
      const density = macro * 0.58 + middle * 0.31 + fine * 0.11;
      pixels[y * size + x] = Math.round(density * 255);
    }
  }
  const texture = new three.DataTexture(pixels, size, size, three.RedFormat);
  texture.wrapS = three.RepeatWrapping;
  texture.wrapT = three.RepeatWrapping;
  texture.magFilter = three.LinearFilter;
  texture.minFilter = three.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = three.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uCloudNoise;
  uniform float uTime;
  uniform float uCloudCover;
  uniform vec3 uSunDirection;
  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);
    float height = clamp(direction.y * 0.72 + 0.18, 0.0, 1.0);
    vec3 horizonColor = vec3(0.77, 0.91, 0.91);
    vec3 zenithColor = vec3(0.12, 0.45, 0.74);
    vec3 sky = mix(horizonColor, zenithColor, pow(height, 0.58));

    float sunFacing = max(dot(direction, normalize(uSunDirection)), 0.0);
    float sunGlow = smoothstep(0.88, 1.0, sunFacing);
    float sunDisc = smoothstep(0.9985, 1.0, sunFacing);
    sky += vec3(1.0, 0.66, 0.30) * sunGlow * 0.16;
    sky += vec3(1.0, 0.93, 0.64) * sunDisc * 1.35;

    // 将视线投向高空平面再采样，避免普通球体 UV 在头顶出现拉伸。
    vec2 projected = direction.xz / max(0.22, direction.y + 0.22);
    vec2 macroWind = vec2(-uTime * 0.0028, uTime * 0.0008);
    vec2 brokenWind = vec2(uTime * 0.0046, uTime * 0.0016);
    vec2 wispWind = vec2(-uTime * 0.0078, -uTime * 0.0012);
    float macro = texture2D(uCloudNoise, projected * 0.24 + macroWind).r;
    float broken = texture2D(uCloudNoise, projected * 0.54 + brokenWind).r;
    float wisps = texture2D(uCloudNoise, projected * 1.08 + wispWind).r;
    float cloudField = macro * 0.60 + broken * 0.29 + wisps * 0.11 + uCloudCover * 0.10;
    // 先铺一层全方位淡云，再由高密度区域叠出更亮的大云团；不让某一侧整片天空碰巧空掉。
    float cloudVeil = smoothstep(0.25, 0.58, cloudField);
    float cloudBillow = smoothstep(0.52, 0.76, cloudField);
    float cloud = max(cloudVeil * 0.36, cloudBillow);
    cloud *= smoothstep(-0.10, 0.16, direction.y);

    vec3 cloudShade = vec3(0.55, 0.73, 0.82);
    vec3 cloudLight = vec3(1.0, 0.93, 0.76);
    vec3 cloudColor = mix(cloudShade, cloudLight, 0.42 + sunFacing * 0.54);
    sky = mix(sky, cloudColor, cloud * 0.80);

    gl_FragColor = vec4(sky, 1.0);
  }
`;

function createSkyDome(three, spec) {
  const cloudNoise = createCloudNoiseTexture(three);
  const geometry = new three.SphereGeometry(
    spec.sky.radius,
    spec.sky.segments.width,
    spec.sky.segments.height,
  );
  const material = new three.ShaderMaterial({
    uniforms: {
      uCloudNoise: { value: cloudNoise },
      uTime: { value: 0 },
      uCloudCover: { value: 0.78 },
      uSunDirection: { value: new three.Vector3(-8, 14, -5).normalize() },
    },
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: three.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new three.Mesh(geometry, material);
  dome.name = 'battle-sky-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.dynamicSkyNoise = cloudNoise;
  return { dome, material };
}

function createFrontSurf(three, z) {
  const group = new three.Group();
  group.name = 'front-surf-boundary';
  const foamMaterial = new three.MeshBasicMaterial({
    color: '#effff7',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });

  [-0.15, 0.2, 0.56, 0.92].forEach((offset, index) => {
    const wave = new three.Mesh(new three.PlaneGeometry(17.2 - index * 0.78, 0.18), foamMaterial.clone());
    wave.name = 'fogged-surf-line';
    wave.rotation.x = -Math.PI / 2;
    wave.position.set((index % 2 ? 0.22 : -0.19), 0.045 + index * 0.014, z + offset);
    group.add(wave);
  });

  const haze = new three.Mesh(
    new three.PlaneGeometry(20, 2.9),
    new three.MeshBasicMaterial({
      color: '#d6f4ee',
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: three.DoubleSide,
    }),
  );
  haze.name = 'horizon-haze';
  haze.position.set(0, 1.46, z + 1.55);
  group.add(haze);
  return group;
}

function disposeObject(three, object) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.filter(Boolean).forEach((material) => {
      material.map?.dispose();
      material.dispose?.();
    });
    node.userData?.dynamicSkyNoise?.dispose?.();
  });
  object.removeFromParent();
}

/**
 * 创建纯视觉的海滩远景。
 *
 * 主线接法：
 * const battleEnvironment = createBattleEnvironment({ scene, camera });
 * 在动画循环中调用 battleEnvironment.update();
 * 离开战斗页面时调用 battleEnvironment.dispose();
 */
export function createBattleEnvironment({
  scene,
  camera,
  options,
  three = THREE,
  canvasFactory = () => document.createElement('canvas'),
} = {}) {
  if (!scene?.add) throw new TypeError('createBattleEnvironment 需要 Three.js scene');
  if (!camera?.position) throw new TypeError('createBattleEnvironment 需要 camera');

  const spec = createBattleEnvironmentSpec(options);
  const root = new three.Group();
  root.name = 'battle-environment';
  const { dome: sky, material: skyMaterial } = createSkyDome(three, spec);
  const boundaries = new three.Group();
  boundaries.name = 'battle-visual-boundaries';

  boundaries.add(createFrontSurf(three, spec.values.horizonZ));
  root.add(sky, boundaries);
  scene.add(root);

  const previousBackground = scene.background;
  const previousFog = scene.fog;
  scene.background = new three.Color('#a9d8e4');
  scene.fog = new three.Fog(spec.atmosphere.color, spec.atmosphere.near, spec.atmosphere.far);

  let isDisposed = false;
  const update = (elapsedTime = 0) => {
    if (isDisposed) return;
    sky.position.copy(camera.position);
    skyMaterial.uniforms.uTime.value = elapsedTime;
  };

  update();

  return Object.freeze({
    root,
    sky,
    boundaries,
    spec,
    update,
    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      disposeObject(three, root);
      if (scene.background?.isColor && scene.background.getHex() === new three.Color('#a9d8e4').getHex()) {
        scene.background = previousBackground;
      }
      if (scene.fog?.near === spec.atmosphere.near && scene.fog?.far === spec.atmosphere.far) {
        scene.fog = previousFog;
      }
    },
  });
}
