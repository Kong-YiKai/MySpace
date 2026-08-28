const PLY_TYPE_BYTES = Object.freeze({
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseBinaryPlyLayout(buffer) {
  const bytes = new Uint8Array(buffer);
  // PLY header 是 ASCII；只读取一小段即可，不会把 32 MB 点云转成字符串。
  const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const marker = 'end_header';
  const markerIndex = prefix.indexOf(marker);
  if (markerIndex < 0) throw new Error('PLY 缺少 end_header，无法建立锚点拾取索引。');
  const newlineIndex = prefix.indexOf('\n', markerIndex);
  if (newlineIndex < 0) throw new Error('PLY header 格式不完整，无法建立锚点拾取索引。');

  const header = prefix.slice(0, newlineIndex + 1);
  if (!/^format binary_little_endian 1\.0$/m.test(header)) {
    throw new Error('锚点拾取目前只支持 binary_little_endian PLY。');
  }

  let vertexCount = 0;
  let currentElement = null;
  let rowBytes = 0;
  const properties = [];
  for (const rawLine of header.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'element') {
      currentElement = parts[1] ?? null;
      if (currentElement === 'vertex') vertexCount = Number(parts[2]);
      continue;
    }
    if (currentElement !== 'vertex' || parts[0] !== 'property') continue;
    if (parts[1] === 'list') throw new Error('顶点 list PLY 不支持作为锚点拾取来源。');
    const type = parts[1];
    const name = parts[2];
    const bytesPerValue = PLY_TYPE_BYTES[type];
    if (!name || !bytesPerValue) throw new Error(`未知 PLY 顶点属性：${type ?? 'unknown'}。`);
    properties.push({ name, type, offset: rowBytes });
    rowBytes += bytesPerValue;
  }

  const coordinate = Object.fromEntries(properties.map((property) => [property.name, property]));
  if (!Number.isInteger(vertexCount) || vertexCount <= 0 || rowBytes <= 0 || !coordinate.x || !coordinate.y || !coordinate.z) {
    throw new Error('PLY 不包含可用于空间锚点的 x/y/z 顶点坐标。');
  }
  const headerBytes = newlineIndex + 1;
  if (headerBytes + vertexCount * rowBytes > buffer.byteLength) {
    throw new Error('PLY 顶点数据不完整，无法建立锚点拾取索引。');
  }
  return { headerBytes, vertexCount, rowBytes, coordinate };
}

function readCoordinate(view, byteOffset, property) {
  if (property.type === 'float' || property.type === 'float32') return view.getFloat32(byteOffset + property.offset, true);
  if (property.type === 'double' || property.type === 'float64') return view.getFloat64(byteOffset + property.offset, true);
  throw new Error(`坐标属性 ${property.name} 必须为 float 或 double。`);
}

/**
 * 从 Gaussian PLY 顶点中心建立一个“仅点击时查询”的拾取器。
 *
 * 3DGS 没有三角面可供普通 Raycaster 命中；这里在鼠标轻点时找出屏幕射线
 * 最前方的高斯中心。扫描只发生在锚点编辑时，正常渲染不会多出循环或 GPU 开销。
 */
export function createSplatPointPicker(positions) {
  if (!(positions instanceof Float32Array) || positions.length < 3 || positions.length % 3 !== 0) {
    throw new Error('3DGS 锚点拾取需要有效的 Float32 顶点坐标。');
  }

  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], positions[index + axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], positions[index + axis]);
    }
  }

  return Object.freeze({
    count: positions.length / 3,
    bounds,
    /**
     * 返回点击射线前方最先命中的真实高斯中心。阈值以“屏幕像素半径”换算，
     * 因而远近都能保持近似一致的点选手感。
     */
    pick(origin, direction, {
      fovDegrees = 64,
      viewportHeight = 720,
      pixelTolerance = 7,
      minDistance = 0.12,
      maxDistance = 40,
      minRadius = 0.035,
      maxRadius = 0.34,
    } = {}) {
      const pixelToWorld = (2 * Math.tan((fovDegrees * Math.PI) / 360) * pixelTolerance) / Math.max(viewportHeight, 1);
      let closestDistance = Infinity;
      let closestPerpendicularSq = Infinity;
      let result = null;
      for (let index = 0; index < positions.length; index += 3) {
        const x = positions[index];
        const y = positions[index + 1];
        const z = positions[index + 2];
        const deltaX = x - origin.x;
        const deltaY = y - origin.y;
        const deltaZ = z - origin.z;
        const alongRay = deltaX * direction.x + deltaY * direction.y + deltaZ * direction.z;
        if (alongRay < minDistance || alongRay > maxDistance) continue;
        const perpendicularSq = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ - alongRay * alongRay;
        const radius = clamp(alongRay * pixelToWorld, minRadius, maxRadius);
        if (perpendicularSq > radius * radius) continue;
        // 先满足“最前方”，同一深度内再选更贴近射线的点，模拟有深度的鼠标拾取。
        if (
          alongRay < closestDistance - 0.005
          || (Math.abs(alongRay - closestDistance) <= 0.005 && perpendicularSq < closestPerpendicularSq)
        ) {
          closestDistance = alongRay;
          closestPerpendicularSq = perpendicularSq;
          result = [
            Number(x.toFixed(3)),
            Number(y.toFixed(3)),
            Number(z.toFixed(3)),
          ];
        }
      }
      return result;
    },
  });
}

export function createSplatPointPickerFromPly(buffer) {
  const layout = parseBinaryPlyLayout(buffer);
  const view = new DataView(buffer);
  const positions = new Float32Array(layout.vertexCount * 3);
  let offset = 0;
  for (let vertexIndex = 0; vertexIndex < layout.vertexCount; vertexIndex += 1) {
    const rowOffset = layout.headerBytes + vertexIndex * layout.rowBytes;
    const x = readCoordinate(view, rowOffset, layout.coordinate.x);
    const y = readCoordinate(view, rowOffset, layout.coordinate.y);
    const z = readCoordinate(view, rowOffset, layout.coordinate.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    offset += 3;
  }
  if (offset === 0) throw new Error('PLY 中没有可用的 Gaussian 顶点。');
  return createSplatPointPicker(positions.subarray(0, offset));
}

export async function loadSplatPointPicker(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`3DGS 锚点拾取源读取失败（HTTP ${response.status}）。`);
  return createSplatPointPickerFromPly(await response.arrayBuffer());
}
