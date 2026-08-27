import { describe, expect, it } from 'vitest';
import { scoreFloorPlanPixels } from './floorPlanValidator';

function makePixels(width: number, height: number, valueAt: (x: number, y: number) => number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = valueAt(x, y);
      const index = (y * width + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

describe('floor-plan image heuristic', () => {
  it('rejects a flat unrelated image', () => {
    const pixels = makePixels(80, 60, () => 150);
    expect(scoreFloorPlanPixels(pixels, 80, 60).accepted).toBe(false);
  });

  it('accepts a bright plan with repeated dark walls', () => {
    const pixels = makePixels(80, 60, (x, y) => (
      x % 18 <= 2 || y % 16 <= 2 ? 32 : 248
    ));
    expect(scoreFloorPlanPixels(pixels, 80, 60).accepted).toBe(true);
  });
});
