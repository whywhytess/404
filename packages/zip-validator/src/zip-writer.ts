/**
 * Minimal ZIP writer used ONLY to build test fixtures, including malformed and malicious
 * archives that normal ZIP libraries refuse to create (absolute paths, `..`, symlinks,
 * lying size fields). Not used by the application at runtime.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntrySpec {
  /** Entry name exactly as stored (no validation). */
  name: string | Buffer;
  data?: Buffer | string;
  /** 0 = stored, 8 = deflate (default). */
  method?: 0 | 8;
  /** Unix mode (e.g. 0o100644 file, 0o040755 dir, 0o120777 symlink). */
  unixMode?: number;
  /** Set the UTF-8 file name flag (general purpose bit 11). Default true. */
  utf8?: boolean;
  /** Set the encryption flag without actually encrypting (for rejection tests). */
  encryptedFlag?: boolean;
  /** Override the uncompressed size written in the headers (to simulate lying archives). */
  declaredSize?: number;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

export function buildZip(entries: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.isBuffer(e.name) ? e.name : Buffer.from(e.name, 'utf8');
    const data =
      e.data === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(e.data)
          ? e.data
          : Buffer.from(e.data);
    const method = e.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const size = e.declaredSize ?? data.length;
    let flags = 0;
    if (e.utf8 ?? true) flags |= 0x0800;
    if (e.encryptedFlag) flags |= 0x0001;
    const isDir = name.toString('latin1').endsWith('/');
    const mode = e.unixMode ?? (isDir ? 0o040755 : 0o100644);

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(compressed.length),
      u32(size),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16((3 << 8) | 20), // made by Unix, so external attributes carry a Unix mode
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0x21),
      u32(crc),
      u32(compressed.length),
      u32(size),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(((mode & 0xffff) << 16) >>> 0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}
