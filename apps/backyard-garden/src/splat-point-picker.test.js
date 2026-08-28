import { describe, expect, it } from 'vitest';
import { createSplatPointPicker, createSplatPointPickerFromPly } from './splat-point-picker.js';

function createMinimalPly(points) {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    'end_header',
    '',
  ].join('\n');
  const headerBytes = new TextEncoder().encode(header);
  const buffer = new ArrayBuffer(headerBytes.length + points.length * 12);
  new Uint8Array(buffer).set(headerBytes);
  const view = new DataView(buffer);
  points.forEach(([x, y, z], index) => {
    const offset = headerBytes.length + index * 12;
    view.setFloat32(offset, x, true);
    view.setFloat32(offset + 4, y, true);
    view.setFloat32(offset + 8, z, true);
  });
  return buffer;
}

describe('3DGS 锚点点云拾取', () => {
  it('解析 binary PLY 的真实 x/y/z 顶点，而不是引入固定高度', () => {
    const picker = createSplatPointPickerFromPly(createMinimalPly([
      [0, 1.25, 2],
      [1, 3, 4],
    ]));
    expect(picker.count).toBe(2);
    expect(picker.pick(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0.53, z: 0.848 },
      { viewportHeight: 1_000, pixelTolerance: 12 },
    )).toEqual([0, 1.25, 2]);
  });

  it('选择射线前方最先命中的 Gaussian 点位', () => {
    const picker = createSplatPointPicker(new Float32Array([
      0, 1.4, 2,
      0, 2.8, 4,
      0.8, 1.4, 2,
    ]));
    expect(picker.pick(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0.573462, z: 0.819232 },
      { viewportHeight: 1_000, pixelTolerance: 4 },
    )).toEqual([0, 1.4, 2]);
  });
});
