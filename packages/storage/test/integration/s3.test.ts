import { randomUUID } from 'node:crypto';
import { text } from 'node:stream/consumers';
import { beforeAll, describe, expect, it } from 'vitest';
import { S3ObjectStore, versionKey, versionPrefix } from '../../src/index.js';

const store = new S3ObjectStore({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000',
  region: 'us-east-1',
  bucket: 'webcove-test',
  accessKeyId: process.env.S3_ACCESS_KEY ?? 'webcove',
  secretAccessKey: process.env.S3_SECRET_KEY ?? 'webcove_dev_only',
});

beforeAll(async () => store.ensureBucket());

describe('S3 object store (S3-compatible server)', () => {
  it('puts, gets, lists and deletes a version folder', async () => {
    const v = randomUUID();
    const body = Buffer.from('<h1>hello</h1>');
    await store.put(versionKey(v, 'index.html'), body, body.length, 'text/html; charset=utf-8');
    await store.put(versionKey(v, 'css/a b.css'), Buffer.from('x'), 1, 'text/css');

    const got = await store.get(versionKey(v, 'index.html'));
    expect(got).not.toBeNull();
    expect(await text(got!.body)).toBe('<h1>hello</h1>');
    expect(await store.get(versionKey(v, 'missing.html'))).toBeNull();

    const listed = await store.list(versionPrefix(v));
    expect(listed.map((o) => o.key).sort()).toEqual([
      versionKey(v, 'css/a b.css'),
      versionKey(v, 'index.html'),
    ]);
    expect(await store.listFolders('versions/')).toContain(v);

    expect(await store.deletePrefix(versionPrefix(v))).toBe(2);
    expect(await store.list(versionPrefix(v))).toEqual([]);
  });

  it('refuses to delete a prefix that is not a folder', async () => {
    await expect(store.deletePrefix('versions')).rejects.toThrow();
  });
});
