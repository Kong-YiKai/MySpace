import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { NormalizedAssetTransform } from '@spatial-intelligence/contracts';

export interface StoredLux3dAssets {
  sourceGlbAssetId: string;
  normalizedGlbAssetId: string;
}

export interface AssetStorage {
  store(jobId: string, bytes: Buffer, transform: NormalizedAssetTransform): Promise<StoredLux3dAssets>;
}

export function createS3AssetStorage(): AssetStorage {
  const bucket = process.env.S3_BUCKET ?? 'spatial-assets';
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'spatial',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'spatial-development-only',
    },
  });
  return {
    store: async (jobId, bytes, transform) => {
      const prefix = `asset-generation/${jobId}`;
      await Promise.all([
        client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/source.glb`,
          Body: bytes,
          ContentType: 'model/gltf-binary',
          Metadata: { lineage: 'lux3d-source' },
        })),
        client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/normalized.glb`,
          Body: bytes,
          ContentType: 'model/gltf-binary',
          Metadata: { lineage: 'lux3d-normalized-by-scene-transform' },
        })),
        client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/normalization.json`,
          Body: JSON.stringify(transform),
          ContentType: 'application/json',
        })),
      ]);
      return {
        sourceGlbAssetId: `asset-lux3d-source-${jobId}`,
        normalizedGlbAssetId: `asset-lux3d-normalized-${jobId}`,
      };
    },
  };
}
