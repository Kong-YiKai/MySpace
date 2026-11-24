import { describe, expect, it } from 'vitest';
import { inspectAndNormalizeGlb } from './glbNormalizer.js';

function createGlb(): Buffer {
  const document = {
    asset: { version: '2.0' },
    accessors: [{ type: 'VEC3', min: [-1, -0.5, -2], max: [1, 1.5, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    materials: [{ pbrMetallicRoughness: {} }],
  };
  const raw = Buffer.from(JSON.stringify(document), 'utf8');
  const padding = (4 - (raw.byteLength % 4)) % 4;
  const json = Buffer.concat([raw, Buffer.alloc(padding, 0x20)]);
  const output = Buffer.alloc(20 + json.byteLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.byteLength, 8);
  output.writeUInt32LE(json.byteLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  return output;
}

describe('GLB normalization', () => {
  it('validates GLB and derives meter-scale floor-center transform', () => {
    const result = inspectAndNormalizeGlb(createGlb(), { width: 1, height: 1, depth: 2 });
    expect(result.transform.scale).toEqual([0.5, 0.5, 0.5]);
    expect(result.transform.normalizedBoundsMeters.min).toEqual([-0.5, 0, -1]);
    expect(result.transform.normalizedBoundsMeters.max).toEqual([0.5, 1, 1]);
    expect(result.transform.pivot).toBe('floor-center');
    expect(result.diagnostics.hasPbrMaterial).toBe(true);
  });

  it('rejects invalid provider output', () => {
    expect(() => inspectAndNormalizeGlb(Buffer.from('not glb'), {
      width: null, height: null, depth: null,
    })).toThrow('有效 GLB');
  });
});
