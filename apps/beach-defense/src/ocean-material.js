import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vWave;
  uniform float uTime;

  void main() {
    vUv = uv;
    vec3 displaced = position;
    float longWave = sin(position.x * 0.64 + uTime * 0.92) * 0.045;
    float crossWave = sin(position.y * 1.32 - uTime * 1.48) * 0.026;
    vWave = longWave + crossWave;
    displaced.z += vWave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uAlbedoMap;
  uniform sampler2D uNoiseMap;
  uniform sampler2D uFoamMap;
  uniform float uTime;
  uniform vec2 uTileScale;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vec2 flowA = vec2(uTime * 0.026, uTime * 0.010);
    vec2 flowB = vec2(-uTime * 0.052, uTime * 0.032);
    vec2 foamFlow = vec2(uTime * 0.026, -uTime * 0.014);
    vec2 tiledUv = vUv * uTileScale;

    vec3 albedoA = texture2D(uAlbedoMap, tiledUv + flowA).rgb;
    vec3 albedoB = texture2D(uAlbedoMap, tiledUv * 1.74 + flowB).rgb;
    float noiseA = texture2D(uNoiseMap, tiledUv * 1.12 + flowA).r;
    float noiseB = texture2D(uNoiseMap, tiledUv * 2.18 + flowB).r;
    float foamTexture = texture2D(uFoamMap, tiledUv * 1.28 + foamFlow).r;

    float ripple = smoothstep(0.44, 0.86, noiseA * 0.58 + noiseB * 0.42 + vWave * 1.8);
    vec3 deep = vec3(0.018, 0.196, 0.405);
    vec3 mid = vec3(0.025, 0.465, 0.715);
    vec3 ocean = mix(deep, mid, 0.52 + ripple * 0.30);
    ocean = mix(ocean, albedoA, 0.42);
    ocean = mix(ocean, albedoB, 0.18);

    float shore = smoothstep(0.0, 0.32, vUv.y) * (1.0 - smoothstep(0.64, 1.0, vUv.y));
    float foam = smoothstep(0.76, 0.95, foamTexture) * (0.45 + shore * 0.55);
    float glint = ripple * 0.12;
    ocean += vec3(0.45, 0.88, 1.0) * glint;
    ocean = mix(ocean, vec3(0.84, 0.97, 1.0), foam * 0.56);

    gl_FragColor = vec4(clamp(ocean, 0.0, 1.0), 1.0);
  }
`;

function loadRepeatTexture(loader, url, colorSpace = THREE.NoColorSpace) {
  const texture = loader.load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createTideMaterial({ tileScale = new THREE.Vector2(4.4, 3.2) } = {}) {
  const loader = new THREE.TextureLoader();
  const albedoMap = loadRepeatTexture(loader, '/textures/ocean/ocean_albedo.webp', THREE.SRGBColorSpace);
  const noiseMap = loadRepeatTexture(loader, '/textures/ocean/ocean_noise.webp');
  const foamMap = loadRepeatTexture(loader, '/textures/ocean/ocean_foam_mask.webp');

  return new THREE.ShaderMaterial({
    uniforms: {
      uAlbedoMap: { value: albedoMap },
      uNoiseMap: { value: noiseMap },
      uFoamMap: { value: foamMap },
      uTime: { value: 0 },
      uTileScale: { value: tileScale.clone?.() ?? new THREE.Vector2(tileScale.x, tileScale.y) },
    },
    vertexShader,
    fragmentShader,
  });
}

export function updateTideMaterial(material, elapsedTime) {
  material.uniforms.uTime.value = elapsedTime;
}
