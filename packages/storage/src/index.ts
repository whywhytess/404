/**
 * Object storage for immutable version files (SRD 3.9.1): `versions/{versionId}/{path}`.
 * Used by the platform API (write, delete) and the content server (read only).
 * The bucket is private; nothing is ever served from storage directly (INV-09).
 */
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

export interface StoredObject {
  body: Readable;
  size: number;
}

export interface ObjectStore {
  put(key: string, body: Buffer | Readable, size: number, contentType: string): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<StoredObject | null>;
  /** List keys under a prefix with their sizes. */
  list(prefix: string): Promise<ListedObject[]>;
  /** List the distinct "folders" directly under a prefix (e.g. version IDs under "versions/"). */
  listFolders(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<number>;
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified: Date | null;
}

export const versionPrefix = (versionId: string) => `versions/${versionId}/`;
export const versionKey = (versionId: string, path: string) => `versions/${versionId}/${path}`;

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint && { endpoint: cfg.endpoint, forcePathStyle: true }),
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Some S3-compatible servers do not support the newer default checksums.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
    }
  }

  async put(key: string, body: Buffer | Readable, size: number, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      return { body: res.Body as Readable, size: res.ContentLength ?? 0 };
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
        return null;
      throw err;
    }
  }

  async list(prefix: string) {
    const out: ListedObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.cfg.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key)
          out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async listFolders(prefix: string) {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.cfg.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: token,
        }),
      );
      for (const p of res.CommonPrefixes ?? []) {
        if (p.Prefix) out.push(p.Prefix.slice(prefix.length).replace(/\/$/, ''));
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async deletePrefix(prefix: string) {
    if (!prefix.endsWith('/') || prefix === '/')
      throw new Error('Refusing to delete a non-folder prefix');
    const keys = await this.list(prefix);
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.cfg.bucket,
          Delete: { Objects: batch.map((k) => ({ Key: k.key })), Quiet: true },
        }),
      );
    }
    return keys.length;
  }
}
