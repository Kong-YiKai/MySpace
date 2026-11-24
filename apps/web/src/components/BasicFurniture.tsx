import type { BasicFurnitureKind } from '@spatial-intelligence/contracts';

type Dimensions = [number, number, number];
type Part = { position: Dimensions; size: Dimensions; color: string };

export function BasicFurniture({ kind, size: [w, h, d] }: { kind: BasicFurnitureKind; size: Dimensions }) {
  const cloth = '#d6c4ad';
  const wood = '#80654d';
  const lightWood = '#b79b78';
  const frame = '#514339';
  const parts: Part[] = [];
  const box = (size: Dimensions, position: Dimensions, color: string) => parts.push({ size, position, color });

  if (kind === 'sofa') {
    box([w, h * 0.3, d], [0, h * 0.22, 0], cloth);
    box([w - 0.24, h * 0.2, d * 0.72], [0, h * 0.45, d * 0.11], '#e2d4bf');
    box([w, h * 0.48, d * 0.23], [0, h * 0.76, -d * 0.385], cloth);
    for (const side of [-1, 1]) {
      box([0.12, h * 0.35, d], [side * (w / 2 - 0.06), h * 0.57, 0], cloth);
      box([0.34, h * 0.33, 0.15], [side * w * 0.3, h * 0.71, -d * 0.18], side < 0 ? '#657769' : '#b28b64');
    }
  } else if (kind === 'bed') {
    box([w, h * 0.31, d], [0, h * 0.18, 0], wood);
    box([w, h * 0.21, d * 0.96], [0, h * 0.43, d * 0.02], '#ece4da');
    box([w, h, 0.09], [0, h / 2, -d / 2 + 0.045], wood);
    box([w, 0.06, d * 0.67], [0, h * 0.55, d * 0.16], '#b6ad96');
    for (const side of [-1, 1]) box([w * 0.38, 0.1, d * 0.19], [side * w * 0.23, h * 0.59, -d * 0.32], '#f2eee4');
  } else if (kind === 'wardrobe') {
    box([w, h, d], [0, h / 2, 0], wood);
    for (const side of [-1, 1]) {
      box([w * 0.48, h * 0.97, 0.025], [side * w * 0.25, h / 2, d / 2 - 0.012], lightWood);
      box([0.018, 0.14, 0.02], [side * 0.06, h * 0.57, d / 2 + 0.01], frame);
    }
  } else {
    const top = kind === 'chair' ? h * 0.56 : h;
    const surface = kind === 'chair' ? '#a99d85' : lightWood;
    box([w, 0.06, d], [0, top - 0.03, 0], surface);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) box([0.05, top - 0.06, 0.05], [x * w * 0.40, (top - 0.06) / 2, z * d * 0.39], frame);
    }
    if (kind === 'chair') box([w * 0.95, h - top, 0.06], [0, (h + top) / 2, -d / 2 + 0.03], surface);
  }

  return parts.map((part, index) => (
    <mesh key={index} position={part.position} castShadow receiveShadow>
      <boxGeometry args={part.size} />
      <meshStandardMaterial color={part.color} roughness={0.78} />
    </mesh>
  ));
}
