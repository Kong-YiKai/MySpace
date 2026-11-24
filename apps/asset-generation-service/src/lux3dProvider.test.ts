import { describe, expect, it, vi } from 'vitest';
import type { AssetGenerationRequest } from '@spatial-intelligence/contracts';
import { createLux3dProvider, type Lux3dClientLike } from './lux3dProvider.js';

const baseRequest: AssetGenerationRequest = {
  sessionId: '67784412-a635-4488-8a54-c981e10af269',
  analysisId: '9f073d6d-ed5b-48df-aa28-4b190c9c602a',
  objectId: 'main-sofa',
  mode: 'text-to-3d',
  prompt: 'Photorealistic cream linen sofa',
  targetSizeMeters: { width: 2.2, height: 0.85, depth: 0.9 },
  placement: { support: 'floor', roomZone: 'living-room', notes: '' },
  quality: 'production',
  photorealistic: true,
};

function fakeClient(): Lux3dClientLike {
  return {
    imgTo3d: { create: vi.fn(async () => 99) },
    textTo3d: { create: vi.fn(async () => 42) },
    tasks: { waitFor: vi.fn(async () => ({
      taskId: 42, status: 3 as const, outputs: [{ content: 'https://cdn.example.test/sofa.glb' }],
    })) },
  };
}

describe('Lux3D provider', () => {
  it('forces photorealistic PBR GLB for text generation', async () => {
    const client = fakeClient();
    const result = await createLux3dProvider({ client }).generate(baseRequest, async () => undefined);
    expect(client.textTo3d.create).toHaveBeenCalledWith(expect.objectContaining({
      style: 'photorealistic', enablePbr: true, outputFormat: ['glb'], faceCount: 200_000,
    }));
    expect(result.taskId).toBe('42');
    expect(result.evidence.status).toBe('succeeded');
  });

  it('uses the cropped image together with prompt and photorealistic style', async () => {
    const client = fakeClient();
    const prepareReference = vi.fn(async () => 'data:image/png;base64,cropped');
    await createLux3dProvider({ client, prepareReference }).generate({
      ...baseRequest,
      mode: 'image-guided-3d',
      referenceAssetId: 'asset-reference',
      referenceImageUrl: 'https://storage.example.test/reference.png',
      referenceBoundingBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
    }, async () => undefined);
    expect(prepareReference).toHaveBeenCalled();
    expect(client.textTo3d.create).toHaveBeenCalledWith(expect.objectContaining({
      img: 'data:image/png;base64,cropped',
      prompt: baseRequest.prompt,
      style: 'photorealistic',
      enablePbr: true,
    }));
    expect(client.imgTo3d.create).not.toHaveBeenCalled();
  });

  it('fails explicitly when credentials are missing', async () => {
    const previous = process.env.AHOLO_API_KEY;
    delete process.env.AHOLO_API_KEY;
    try {
      await expect(createLux3dProvider().generate(baseRequest, async () => undefined))
        .rejects.toMatchObject({ code: 'provider_credentials_missing', retryable: false });
    } finally {
      if (previous) process.env.AHOLO_API_KEY = previous;
    }
  });
});
