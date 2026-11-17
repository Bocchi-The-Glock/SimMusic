import { env, waitUntil } from 'cloudflare:workers';
import { db } from './core';
import { HttpError } from './validation';
import { ADMIN } from './constants';

export const MAX_IMAGE_BYTES = 100000;
export const IMAGE_BODY_BYTES = 160000;
export type ImageKind = 'livehouse' | 'song' | 'shop' | 'profile' | 'activity';
type Raster = {bytes: Uint8Array; mime: string; extension: string};
export type StoredImage = {key: string; mime: string; size: number};

function invalid(): never { throw new HttpError(400, '图片格式无效，请重新选择 JPG、PNG 或 WebP 图片'); }
function dimensions(width: number, height: number) {
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16777216) invalid();
}
function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}
const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Browser compression emits a fresh static raster. Check its container and dimensions
// before storing; no caller-supplied path, MIME header or URL is trusted.
export function decodeImage(value: unknown): Raster | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid();
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32) throw new HttpError(413, '图片必须压缩到 100 KB 以内');
  const match = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) invalid();
  let raw: string;
  try { raw = atob(match[2]); } catch { invalid(); }
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, '图片必须压缩到 100 KB 以内');
  const view = new DataView(bytes.buffer);
  if (match[1] === 'png') {
    if (bytes.length < 45 || ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n') invalid();
    let offset = 8, sawHeader = false, sawData = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), type = ascii(bytes, offset + 4, 4);
      if (offset + length + 12 > bytes.length) invalid();
      if (crc32(bytes.subarray(offset + 4, offset + length + 8)) !== view.getUint32(offset + length + 8)) invalid();
      if (!sawHeader) {
        if (type !== 'IHDR' || length !== 13) invalid();
        dimensions(view.getUint32(offset + 8), view.getUint32(offset + 12));
        sawHeader = true;
      } else if (type === 'IHDR' || type === 'acTL') invalid();
      if (type === 'IDAT' && length) sawData = true;
      offset += length + 12;
      if (type === 'IEND') { if (length !== 0 || offset !== bytes.length) invalid(); ended = true; break; }
    }
    if (!sawData || !ended) invalid();
  } else if (match[1] === 'webp') {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let offset = 12, sawPixels = false;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + length > bytes.length) invalid();
      if (type === 'ANIM' || type === 'ANMF') invalid();
      if (type === 'VP8 ') {
        if (sawPixels || length < 10 || ascii(bytes, start + 3, 3) !== '\x9d\x01\x2a' || (bytes[start] & 1)) invalid();
        dimensions(view.getUint16(start + 6, true) & 0x3fff, view.getUint16(start + 8, true) & 0x3fff);
        sawPixels = true;
      } else if (type === 'VP8L') {
        if (sawPixels || length < 5 || bytes[start] !== 0x2f) invalid();
        const bits = view.getUint32(start + 1, true);
        dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        sawPixels = true;
      } else if (type === 'VP8X') {
        if (length !== 10 || (bytes[start] & 2)) invalid();
        dimensions(1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16), 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16));
      }
      offset = start + length + (length % 2);
    }
    if (!sawPixels || offset !== bytes.length) invalid();
  } else {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid();
    let offset = 2, sawFrame = false, sawScan = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) invalid();
        dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        sawFrame = true;
      }
      if (marker === 0xda) { sawScan = true; break; }
      offset += length;
    }
    if (!sawFrame || !sawScan) invalid();
  }
  return {bytes, mime: `image/${match[1]}`, extension: match[1] === 'jpeg' ? 'jpg' : match[1]};
}

function bucket() {
  if (!env.BUCKET) throw new HttpError(503, '图片服务暂不可用，请稍后重试');
  return env.BUCKET;
}
export function imageUrl(key: string | null | undefined) { return key ? `/api/images/${key}` : null; }
export async function storeImage(image: Raster | null): Promise<StoredImage | null> {
  if (!image) return null;
  const key = `${crypto.randomUUID()}.${image.extension}`;
  await bucket().put(`covers/${key}`, image.bytes, {httpMetadata: {contentType: image.mime, cacheControl: 'public, max-age=31536000, immutable'}});
  return {key, mime: image.mime, size: image.bytes.byteLength};
}
export function imageInsert(kind: ImageKind, id: string, image: StoredImage, afterMutation=false) {
  const existence: Record<ImageKind, {sql: string; args: string[]}> = {
    livehouse: {sql: "(?='starry' OR EXISTS(SELECT 1 FROM livehouses WHERE id=?))", args: [id,id]},
    song: {sql: 'EXISTS(SELECT 1 FROM songs WHERE id=?)', args: [id]},
    shop: {sql: 'EXISTS(SELECT 1 FROM shops WHERE id=?)', args: [id]},
    profile: {sql: '(?=? OR EXISTS(SELECT 1 FROM users WHERE id=?))', args: [id,ADMIN.id,id]},
    activity: {sql: 'EXISTS(SELECT 1 FROM activities WHERE id=?)', args: [id]},
  };
  const exists=existence[kind];
  // afterMutation is used immediately after an entity write in the same batch:
  // a rejected optimistic update must leave its existing cover untouched.
  return db().prepare(`INSERT INTO entity_images (entity_type,entity_id,object_key,mime_type,size_bytes) SELECT ?,?,?,?,? WHERE ${exists.sql}${afterMutation?' AND changes()>0':''} ON CONFLICT(entity_type,entity_id) DO UPDATE SET object_key=excluded.object_key,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes`).bind(kind,id,image.key,image.mime,image.size,...exists.args);
}
export function imageSelect(kind: ImageKind, id: string) {
  return db().prepare('SELECT object_key FROM entity_images WHERE entity_type=? AND entity_id=?').bind(kind,id);
}
export function imageDelete(kind: ImageKind, id: string, afterMutation=false) {
  return db().prepare(`DELETE FROM entity_images WHERE entity_type=? AND entity_id=?${afterMutation?' AND changes()>0':''}`).bind(kind,id);
}
export async function discardImage(key: string | null | undefined) {
  if (!key) return;
  for (let attempt=0;attempt<3;attempt++) {
    try { await bucket().delete(`covers/${key}`); return; }
    catch { if (attempt===2) console.error('Unable to remove unused cover object'); }
  }
}
export function discardImageLater(key: string | null | undefined) {
  // These unique object keys have already been detached by a committed D1 batch.
  // waitUntil keeps the cleanup alive after sending the successful response.
  if (key) waitUntil(discardImage(key));
}
export async function replaceImage(kind: ImageKind, id: string, value: unknown) {
  const decoded = decodeImage(value), image = await storeImage(decoded);
  let previousKey: string | undefined;
  try {
    // Capture the exact replaced key in the same transaction as the update. A concurrent
    // replacement or deletion cannot make us remove its newly attached image.
    const [previous,result] = await db().batch<Record<string, unknown>>([imageSelect(kind,id),image ? imageInsert(kind,id,image) : imageDelete(kind,id)]);
    if (image && !result.meta.changes) throw new HttpError(404, '场地或乐曲已不存在');
    previousKey=previous.results[0]?.object_key as string | undefined;
  }
  catch (error) { await discardImage(image?.key); throw error; }
  discardImageLater(previousKey);
  return imageUrl(image?.key);
}
export async function readImage(key: string) {
  if (!/^[a-f0-9-]{36}\.(webp|jpg|png)$/.test(key)) throw new HttpError(404, '图片不存在');
  const record = await db().prepare('SELECT mime_type FROM entity_images WHERE object_key=?').bind(key).first<{mime_type:string}>();
  if (!record) throw new HttpError(404, '图片不存在');
  const object = await bucket().get(`covers/${key}`);
  if (!object) throw new HttpError(404, '图片不存在');
  return new Response(object.body, {headers: {'Content-Type':record.mime_type,'Content-Length':String(object.size),'Cache-Control':'public, max-age=31536000, immutable','ETag':object.httpEtag,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
