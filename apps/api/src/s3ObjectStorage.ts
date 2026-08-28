import {
  CreateBucketCommand,
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
    if (result.ContentLength > 10 * 1024 * 1024) {
      throw objectStorageError('file_too_large', '户型图不能超过 10 MB');
    }
    if (result.ContentType !== asset.expectedMediaType) {
      throw objectStorageError('upload_media_type_mismatch', '上传文件类型与授权信息不一致');
    }
    if (result.Metadata?.assetid !== asset.assetId) {
      throw objectStorageError('upload_metadata_mismatch', '上传文件元数据不完整');
    }
  }
}

function objectStorageError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
