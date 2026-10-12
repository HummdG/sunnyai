// Cloud-Optimised GeoTIFF access through fetchCached: byte ranges are requested as fixed, aligned blocks so that the
// set of HTTP requests depends only on the bytes geotiff.js needs (never on timing) => cacheable, recordable and
// replayable. The first block's ETag is appended to later block URLs as a #fragment (never sent), so a changed remote
// file can never be mixed with cached blocks of the previous version.
import { GeoTIFF, type GeoTIFFImage } from 'geotiff';
import type { Bbox27700 } from '../contracts.js';
import { fetchCached } from '../http/index.js';
import { readImageWindow, type GeoRaster } from './grid.js';

/** Block size of COG range requests (bytes). */
export const COG_BLOCK = 65_536;

/** Remote file missing or not readable (e.g. S3 403/404 for a tile that does not exist). */
export class RemoteFileError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`remote file ${url}: HTTP ${status}`);
    this.name = 'RemoteFileError';
  }
}

/** geotiff.js BaseSource reading aligned blocks via fetchCached. */
export class CachedRangeSource {
  private readonly blocks = new Map<number, Promise<Uint8Array>>();
  private size: number | null = null;
  private etag = '';

  constructor(readonly url: string, readonly provider: string, readonly blockSize = COG_BLOCK) {}

  get fileSize(): number | null {
    return this.size;
  }

  async close(): Promise<void> {
    this.blocks.clear();
  }

  async fetch(slices: { offset: number; length: number }[], _signal?: AbortSignal): Promise<ArrayBuffer[]> {
    return Promise.all(slices.map((s) => this.read(s.offset, s.length)));
  }

  async fetchSlice(slice: { offset: number; length: number }, _signal?: AbortSignal): Promise<{ offset: number; length: number; data: ArrayBuffer }> {
    return { ...slice, data: await this.read(slice.offset, slice.length) };
  }

  private block(id: number): Promise<Uint8Array> {
    let p = this.blocks.get(id);
    if (!p) {
      p = this.load(id);
      this.blocks.set(id, p);
      p.catch(() => this.blocks.delete(id));
    }
    return p;
  }

  private async load(id: number): Promise<Uint8Array> {
    if (id > 0) await this.block(0); // learn file size + ETag first
    const start = id * this.blockSize;
    let end = start + this.blockSize - 1;
    if (this.size != null) {
      if (start >= this.size) return new Uint8Array(0);
      end = Math.min(end, this.size - 1);
    }
    const url = id > 0 && this.etag ? `${this.url}#etag=${encodeURIComponent(this.etag)}` : this.url;
    const res = await fetchCached({ url, provider: this.provider, range: [start, end], ...(id === 0 ? { ttlSec: 86_400 } : {}) });
    if (res.status === 416) return new Uint8Array(0);
    if (res.status !== 206 && res.status !== 200) throw new RemoteFileError(this.url, res.status);
    if (id === 0) {
      const total = /\/(\d+)\s*$/.exec(res.headers['content-range'] ?? '');
      if (total) this.size = Number(total[1]);
      this.etag = (res.headers.etag ?? '').replace(/^W\//, '');
    }
    return res.body;
  }

  private async read(offset: number, length: number): Promise<ArrayBuffer> {
    if (length <= 0) return new ArrayBuffer(0);
    const bs = this.blockSize;
    const first = Math.floor(offset / bs);
    const last = Math.floor((offset + length - 1) / bs);
    const ids: number[] = [];
    for (let id = first; id <= last; id++) ids.push(id);
    const parts = await Promise.all(ids.map((id) => this.block(id)));
    const out = new Uint8Array(length);
    let filled = 0;
    parts.forEach((data, k) => {
      const blockStart = (first + k) * bs;
      const from = Math.max(offset, blockStart);
      const to = Math.min(offset + length, blockStart + data.byteLength);
      if (to > from) {
        out.set(data.subarray(from - blockStart, to - blockStart), from - offset);
        filled = Math.max(filled, to - offset);
      }
    });
    return (filled < length ? out.slice(0, filled) : out).buffer;
  }
}

/** Opens a remote (C)OG through the cached range source. */
export async function openRemoteTiff(url: string, provider: string): Promise<GeoTIFF> {
  const source = new CachedRangeSource(url, provider);
  return GeoTIFF.fromSource(source as unknown as Parameters<typeof GeoTIFF.fromSource>[0]);
}

/** Reads the full-resolution pixels of a remote GeoTIFF covering `win`; null when the window misses the image. */
export async function readRemoteWindow(url: string, provider: string, win: Bbox27700): Promise<{ raster: GeoRaster | null; image: GeoTIFFImage }> {
  const tiff = await openRemoteTiff(url, provider);
  const image = await tiff.getImage(0);
  return { raster: await readImageWindow(image, win), image };
}
