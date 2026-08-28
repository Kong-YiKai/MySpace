import { GLTFLoader, MeshBasicMaterial, downloadTexture } from '@manycore/aholo-viewer';

// Lux3D 的标准 GLB 会以 metallicFactor=1 导出，而 Aholo 的嵌入式 Viewer
// 不会为动态注入模型自动提供对应的环境反射贴图。这里将兼容逻辑集中起来，
// 以后所有 Lux 模型均通过 loadLux3dGlbForAholo() 载入即可。
export function normalizeLuxPbrForAholo(buffer) {
  const bytes = new Uint8Array(buffer.slice(0));
  if (bytes.byteLength < 20) return buffer;

  const view = new DataView(bytes.buffer);
  const isGlb = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'glTF';
  const jsonLength = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);
  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  // JSON chunk type is ASCII "JSON" in little-endian form. 非 GLB 时保留原数据交给加载器。
  if (!isGlb || jsonChunkType !== 0x4E4F534A || jsonEnd > bytes.byteLength) return buffer;

  const source = new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd));
  // 只改变数值的第一个字符，确保 GLB JSON chunk 的字节长度不变，可以原位写回。
  const normalized = source.replace(
    /("metallicFactor"\s*:\s*)(1(?:\.0+)?)/g,
    (_match, prefix, value) => `${prefix}0${value.slice(1)}`,
  );
  if (normalized === source) return buffer;

  const replacement = new TextEncoder().encode(normalized);
  if (replacement.byteLength !== jsonLength) return buffer;
  bytes.set(replacement, jsonStart);
  return bytes.buffer;
}

function toUnlitMaterial(source) {
  // GLTFLoader 当前会产出 MeshPhongMaterial；这里也兼容已是 MeshBasicMaterial 的来源，
  // 避免未来模型或加载器升级后再次出现材质分支。
  const color = source.isMeshBasicMaterial ? source.color?.color : source.color;
  const texture = source.texture ?? source.color?.texture ?? null;
  return new MeshBasicMaterial({
    color,
    texture,
    opacity: source.opacity ?? 1,
    transparent: source.transparent,
    side: source.side,
    depthWrite: source.depthWrite,
    uvTransform: source.uvTransform,
  });
}

export function applyAholoSafeLuxMaterials(root) {
  root.traverse((object) => {
    if (!object.isMesh || !object.getMaterials || !object.setMaterials) return;
    const materials = object.getMaterials().filter(Boolean);
    if (materials.length) object.setMaterials(materials.map(toUnlitMaterial));
  });
  return root;
}

export async function loadLux3dGlbForAholo({ viewer, uri, label = 'Lux3D 模型' }) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`${label} GLB 读取失败（HTTP ${response.status}）`);
  const parsed = await GLTFLoader.loadGLTF(normalizeLuxPbrForAholo(await response.arrayBuffer()), {
    textureLoader: (url) => downloadTexture(url, { context: viewer }),
  });
  if (!parsed.scene) throw new Error(`${label} GLB 没有可渲染的场景根节点`);
  return applyAholoSafeLuxMaterials(parsed.scene);
}
