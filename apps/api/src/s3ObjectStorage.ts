import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AssetRecord, ObjectStorage } from './ports.js';

interface S3ObjectStorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(options: S3ObjectStorageOptions) {
    this.#bucket = options.bucket;
    this.#client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined,
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
    } catch {
      await this.#client.send(new CreateBucketCommand({ Bucket: this.#bucket }));
    }
  }

  async createUploadUrl(asset: AssetRecord, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.#client, new PutObjectCommand({
      Bucket: this.#bucket,
      Key: asset.storageKey,
      ContentType: asset.expectedMediaType,
      Metadata: { assetid: asset.assetId },
    }), { expiresIn: expiresInSeconds });
  }

  async createDownloadUrl(asset: AssetRecord, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.#client, new GetObjectCommand({
      Bucket: this.#bucket,
      Key: asset.storageKey,
      ResponseContentDisposition: `attachment; filename="${safeFileName(asset.originalFileName)}"`,
    }), { expiresIn: expiresInSeconds });
  }

  async verifyUploadedObject(asset: AssetRecord): Promise<void> {
    let result;
    try {
      result = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: asset.storageKey }));
    } catch {
      throw objectStorageError('asset_not_uploaded', '上传文件不存在或上传尚未完成');
    }
    if (result.ContentLength !== asset.sizeBytes) {
      throw objectStorageError('upload_size_mismatch', '上传文件大小与授权信息不一致');
    }
    const maximum = assetSizeLimit(asset.kind);
    if (result.ContentLength > maximum) {
      throw objectStorageError('file_too_large', `上传文件不能超过 ${Math.round(maximum / 1024 / 1024)} MB`);
    }
    if (result.ContentType !== asset.expectedMediaType) {
      throw objectStorageError('upload_media_type_mismatch', '上传文件类型与授权信息不一致');
    }
    if (result.Metadata?.assetid !== asset.assetId) {
      throw objectStorageError('upload_metadata_mismatch', '上传文件元数据不完整');
    }
  }

  async deleteObjects(storageKeys: string[]): Promise<void> {
    for (let offset = 0; offset < storageKeys.length; offset += 1_000) {
      const keys = storageKeys.slice(offset, offset + 1_000);
      if (keys.length === 0) continue;
      await this.#client.send(new DeleteObjectsCommand({
        Bucket: this.#bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }));
    }
  }
}

function assetSizeLimit(kind: AssetRecord['kind']): number {
  if (kind === 'floor-plan') return 10 * 1024 * 1024;
  if (kind === 'decoration-reference-image') return 30 * 1024 * 1024;
  if (kind === 'room-capture-image' || kind === 'reference-image') return 50 * 1024 * 1024;
  return 2 * 1024 * 1024 * 1024;
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'asset.bin';
}

function objectStorageError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
