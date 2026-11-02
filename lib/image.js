/**
 * image.js —— 参考图解码与像素工具（纯 JS，零运行时依赖）
 *
 * 支持：PNG（含 Adam7 隔行、1/2/4/8/16 bit、调色板+tRNS）、JPEG（vendored jpeg-js）、
 *      GIF（首帧、LZW、隔行）、BMP（24/32/8bit、BI_RGB/BI_BITFIELDS）、TGA（未压缩/RLE、24/32bit）。
 * 输出统一为 { width, height, data: Uint8ClampedArray(RGBA), format }。
 *
 * 为什么自带解码器：这个插件要在用户机器上直接跑，不能要求 npm install 或外部二进制，
 * 而 DSH runtime 的 node_modules 里没有任何可用的图像库。
 */

import { inflateSync, deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { decode as decodeJpeg } from "./vendor/jpeg-decoder.js";

export class ImageError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageError";
  }
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** 按文件头判断格式。 */
export function sniffFormat(buf) {
  if (!buf || buf.length < 4) return "unknown";
  if (buf.length >= 8 && PNG_SIG.every((b, i) => buf[i] === b)) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 6) {
    const tag = buf.toString("ascii", 0, 6);
    if (tag === "GIF87a" || tag === "GIF89a") return "gif";
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
  if (buf.length >= 26) {
    const t = buf[2];
    if ((t === 2 || t === 3 || t === 10 || t === 11 || t === 1 || t === 9) && (buf[16] === 8 || buf[16] === 16 || buf[16] === 24 || buf[16] === 32)) {
      // TGA 没有魔数，只能用「类型 + 位深」这种弱签名，最后再靠调用方兜底
      if (t === 2 || t === 10 || t === 3 || t === 11) return "tga";
    }
  }
  return "unknown";
}

/** 解码任意支持的图片，返回 RGBA。hint 用于 TGA 这类没有魔数的格式。 */
export function decodeImage(buf, hint = "") {
  if (!buf || buf.length === 0) throw new ImageError("图片是空的（0 字节）");
  const format = sniffFormat(buf) === "unknown" ? hint.toLowerCase() : sniffFormat(buf);
  if (format === "png") return decodePng(buf);
  if (format === "jpeg" || format === "jpg") return decodeJpegStrict(buf);
  if (format === "gif") return decodeGif(buf);
  if (format === "bmp") return decodeBmp(buf);
  if (format === "tga") return decodeTga(buf);
  throw new ImageError(
    "认不出这张图的格式（支持 png / jpg / gif / bmp / tga）。webp、heic、avif 目前不支持，请先另存为 png。",
  );
}

/** 从磁盘读一张图。 */
export function loadImage(path) {
  const buf = readFileSync(path);
  try {
    const img = decodeImage(buf, extOf(path));
    img.path = path;
    return img;
  } catch (err) {
    throw new ImageError(path + "：" + err.message);
  }
}

function extOf(path) {
  const m = /\.([a-z0-9]+)$/i.exec(String(path));
  return m ? m[1] : "";
}

/* ------------------------------------------------------------------ PNG */

function decodePng(buf) {
  let p = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (!ihdr) throw new ImageError("PNG 缺 IHDR");
  if (idat.length === 0) throw new ImageError("PNG 没有像素数据（IDAT）");
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  if (!CHANNELS[colorType]) throw new ImageError("PNG 色彩类型 " + colorType + " 不支持");
  if (colorType === 3 && !plte) throw new ImageError("调色板 PNG 缺 PLTE");

  const channels = CHANNELS[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(width * height * 4);
  const ctx = { raw, pos: 0, width, height, bitDepth, colorType, channels, plte, trns, out };

  if (interlace === 0) {
    const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
    const bpp = Math.max(1, (channels * bitDepth) >> 3);
    const rows = unfilterAll(ctx, width, height, rowBytes, bpp);
    for (let y = 0; y < height; y++) emitRow(ctx, rows[y], 0, y, width, 1);
  } else if (interlace === 1) {
    for (const [x0, y0, dx, dy] of ADAM7) {
      const pw = Math.ceil((width - x0) / dx);
      const ph = Math.ceil((height - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const rowBytes = Math.ceil((pw * channels * bitDepth) / 8);
      const bpp = Math.max(1, (channels * bitDepth) >> 3);
      const rows = unfilterAll(ctx, pw, ph, rowBytes, bpp);
      for (let y = 0; y < ph; y++) emitRow(ctx, rows[y], 0, y0 + y * dy, pw, dx, x0);
    }
  } else {
    throw new ImageError("PNG 隔行方式 " + interlace + " 不支持");
  }
  return { width, height, data: out, format: "png" };
}

/** 逐行反滤波；ctx.pos 会被推进。 */
function unfilterAll(ctx, w, h, rowBytes, bpp) {
  const { raw } = ctx;
  const rows = [];
  let prev = null;
  for (let y = 0; y < h; y++) {
    if (ctx.pos + 1 + rowBytes > raw.length) throw new ImageError("PNG 数据被截断（第 " + (y + 1) + " 行）");
    const filter = raw[ctx.pos++];
    const row = Buffer.allocUnsafe(rowBytes);
    raw.copy(row, 0, ctx.pos, ctx.pos + rowBytes);
    ctx.pos += rowBytes;
    unfilterRow(row, prev, bpp, filter);
    rows.push(row);
    prev = row;
  }
  return rows;
}

function unfilterRow(row, prev, bpp, filter) {
  const n = row.length;
  if (filter === 0) return;
  if (filter === 1) {
    for (let i = bpp; i < n; i++) row[i] = (row[i] + row[i - bpp]) & 0xff;
    return;
  }
  if (filter === 2) {
    if (!prev) return;
    for (let i = 0; i < n; i++) row[i] = (row[i] + prev[i]) & 0xff;
    return;
  }
  if (filter === 3) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      row[i] = (row[i] + ((a + b) >> 1)) & 0xff;
    }
    return;
  }
  if (filter === 4) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = i >= bpp && prev ? prev[i - bpp] : 0;
      row[i] = (row[i] + paeth(a, b, c)) & 0xff;
    }
    return;
  }
  throw new ImageError("PNG 滤波类型 " + filter + " 未知");
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** 把一行像素（可能 <8bit）展开成 RGBA 写进 out。 */
function emitRow(ctx, row, x0, y, count, stepX = 1, baseX = 0) {
  const { width, bitDepth, colorType, channels, plte, trns, out } = ctx;
  const maxv = bitDepth === 16 ? 65535 : (1 << bitDepth) - 1;
  const sample = (index) => {
    if (bitDepth === 8) return row[index];
    if (bitDepth === 16) return row.readUInt16BE(index * 2);
    const bitPos = index * bitDepth;
    const byte = row[bitPos >> 3];
    const shift = 8 - bitDepth - (bitPos & 7);
    return (byte >> shift) & maxv;
  };
  const to8 = (v) => (bitDepth === 16 ? Math.round(v / 257) : bitDepth === 8 ? v : Math.round((v * 255) / maxv));
  for (let i = 0; i < count; i++) {
    const x = baseX + i * stepX;
    if (x >= width) break;
    const o = (y * width + x) * 4;
    let r, g, b, a = 255;
    if (colorType === 3) {
      const idx = sample(i);
      r = plte[idx * 3] ?? 0;
      g = plte[idx * 3 + 1] ?? 0;
      b = plte[idx * 3 + 2] ?? 0;
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 0 || colorType === 4) {
      const v = to8(sample(i * channels));
      r = g = b = v;
      if (colorType === 4) a = to8(sample(i * channels + 1));
    } else {
      r = to8(sample(i * channels));
      g = to8(sample(i * channels + 1));
      b = to8(sample(i * channels + 2));
      if (colorType === 6) a = to8(sample(i * channels + 3));
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
}

/** 编码成 PNG（RGBA，filter 0）。 */
export function encodePng({ width, height, data }, { level = 9 } = {}) {
  const rowBytes = width * 4;
  const raw = Buffer.allocUnsafe((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * rowBytes, rowBytes).copy(raw, y * (rowBytes + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level })),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat([Buffer.from(PNG_SIG), ...chunks]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/* ------------------------------------------------------------------ JPEG */

function decodeJpegStrict(buf) {
  let img;
  try {
    img = decodeJpeg(buf, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
  } catch (err) {
    throw new ImageError("JPEG 解码失败：" + err.message);
  }
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data), format: "jpeg" };
}

/* ------------------------------------------------------------------- GIF */

function decodeGif(buf) {
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const flags = buf[10];
  let p = 13;
  let gct = null;
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 0x07) + 1));
    gct = buf.subarray(p, p + size);
    p += size;
  }
  let transparent = -1;
  const canvas = new Uint8ClampedArray(width * height * 4);
  let found = false;
  while (p < buf.length) {
    const block = buf[p++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = buf[p++];
      if (label === 0xf9 && buf[p] >= 4) {
        const packed = buf[p + 1];
        if (packed & 0x01) transparent = buf[p + 4];
      }
      p = skipSubBlocks(buf, p + 1);
      continue;
    }
    if (block === 0x2c) {
      const left = buf.readUInt16LE(p);
      const top = buf.readUInt16LE(p + 2);
      const fw = buf.readUInt16LE(p + 4);
      const fh = buf.readUInt16LE(p + 6);
      const iflags = buf[p + 8];
      p += 9;
      let lct = gct;
      if (iflags & 0x80) {
        const size = 3 * (1 << ((iflags & 0x07) + 1));
        lct = buf.subarray(p, p + size);
        p += size;
      }
      if (!lct) throw new ImageError("GIF 缺调色板");
      const minCode = buf[p++];
      const collected = collectSubBlocks(buf, p);
      p = collected.end;
      const indices = lzwDecode(collected.data, minCode, fw * fh);
      const interlace = (iflags & 0x40) !== 0;
      const rowMap = interlace ? interlaceRows(fh) : null;
      for (let i = 0; i < fw * fh; i++) {
        const srcRow = (i / fw) | 0;
        const y = top + (rowMap ? rowMap[srcRow] : srcRow);
        const x = left + (i % fw);
        if (x >= width || y >= height || x < 0 || y < 0) continue;
        const o = (y * width + x) * 4;
        const idx = indices[i];
        if (idx === transparent) {
          canvas[o + 3] = 0;
          continue;
        }
        canvas[o] = lct[idx * 3] ?? 0;
        canvas[o + 1] = lct[idx * 3 + 1] ?? 0;
        canvas[o + 2] = lct[idx * 3 + 2] ?? 0;
        canvas[o + 3] = 255;
      }
      found = true;
      break;
    }
    p = skipSubBlocks(buf, p);
  }
  if (!found) throw new ImageError("GIF 里没有可用的图像帧（动图只取第一帧）");
  return { width, height, data: canvas, format: "gif" };
}

/** 把 LZW 数据从「长度前缀子块」里拼成一整块连续字节。 */
function collectSubBlocks(buf, p) {
  const parts = [];
  let q = p;
  while (q < buf.length) {
    const len = buf[q++];
    if (len === 0) break;
    parts.push(buf.subarray(q, q + len));
    q += len;
  }
  return { data: Buffer.concat(parts), end: Math.min(buf.length, q) };
}

function skipSubBlocks(buf, p) {
  while (p < buf.length) {
    const size = buf[p++];
    if (size === 0) break;
    p += size;
  }
  return Math.min(buf.length, p);
}

function interlaceRows(h) {
  const rows = new Int32Array(h);
  let idx = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < h; y += step) rows[idx++] = y;
  }
  return rows;
}

function lzwDecode(data, minCode, pixelCount) {
  const out = new Uint8Array(pixelCount);
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
  }
  const stack = new Uint8Array(4097);
  let codeSize = minCode + 1;
  const clear = 1 << minCode;
  const end = clear + 1;
  let nextCode = clear + 2;
  let maxCode = (1 << codeSize) - 1;
  let bitPos = 0;
  let prev = -1;
  let outPos = 0;

  const readCode = () => {
    if (((bitPos + codeSize + 7) >> 3) > data.length) return -1;
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const abs = bitPos + i;
      const bit = (data[abs >> 3] >> (abs & 7)) & 1;
      code |= bit << i;
    }
    bitPos += codeSize;
    return code;
  };
  const firstByte = (code) => {
    let c = code;
    let guard = 0;
    while (prefix[c] >= 0 && guard++ < 4096) c = prefix[c];
    return suffix[c];
  };
  const emit = (code) => {
    let c = code;
    let depth = 0;
    while (c >= 0 && depth < 4097) {
      stack[depth++] = suffix[c];
      c = prefix[c];
    }
    for (let i = depth - 1; i >= 0 && outPos < pixelCount; i--) out[outPos++] = stack[i];
  };

  while (outPos < pixelCount) {
    const code = readCode();
    if (code < 0) break;
    if (code === clear) {
      codeSize = minCode + 1;
      nextCode = clear + 2;
      maxCode = (1 << codeSize) - 1;
      prev = -1;
      continue;
    }
    if (code === end) break;
    if (prev === -1) {
      if (code < clear) {
        out[outPos++] = suffix[code];
        prev = code;
      }
      continue;
    }
    let first;
    if (code < nextCode) {
      first = firstByte(code);
      emit(code);
    } else if (code === nextCode) {
      first = firstByte(prev);
      emit(prev);
      if (outPos < pixelCount) out[outPos++] = first;
    } else {
      break;
    }
    if (nextCode < 4096) {
      prefix[nextCode] = prev;
      suffix[nextCode] = first;
      nextCode++;
      if (nextCode > maxCode && codeSize < 12) {
        codeSize++;
        maxCode = (1 << codeSize) - 1;
      }
    }
    prev = code;
  }
  return out;
}

/* ------------------------------------------------------------------- BMP */

function decodeBmp(buf) {
  const dataOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  const width = buf.readInt32LE(18);
  let height = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = dibSize >= 40 ? buf.readUInt32LE(30) : 0;
  if (width <= 0) throw new ImageError("BMP 宽度非法：" + width);
  const topDown = height < 0;
  if (topDown) height = -height;
  if (height <= 0) throw new ImageError("BMP 高度非法：" + height);
  if (![1, 4, 8, 24, 32].includes(bpp)) throw new ImageError("BMP 位深 " + bpp + " 不支持");
  if (compression !== 0 && compression !== 3) throw new ImageError("BMP 压缩方式 " + compression + " 不支持（只支持未压缩）");

  let palette = null;
  if (bpp <= 8) {
    const count = dibSize >= 40 && buf.readUInt32LE(46) ? buf.readUInt32LE(46) : 1 << bpp;
    palette = [];
    let pp = 14 + dibSize;
    for (let i = 0; i < count; i++) {
      palette.push([buf[pp + 2], buf[pp + 1], buf[pp], 255]);
      pp += 4;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const rowBytes = Math.ceil((width * bpp) / 8);
  const stride = (rowBytes + 3) & ~3;
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y;
    const rowStart = dataOffset + srcY * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (bpp === 24) {
        const i = rowStart + x * 3;
        b = buf[i]; g = buf[i + 1]; r = buf[i + 2];
      } else if (bpp === 32) {
        const i = rowStart + x * 4;
        b = buf[i]; g = buf[i + 1]; r = buf[i + 2]; a = buf[i + 3] || 255;
      } else if (bpp === 8) {
        const entry = palette[buf[rowStart + x]] || [0, 0, 0, 255];
        [r, g, b, a] = entry;
      } else if (bpp === 4) {
        const byte = buf[rowStart + (x >> 1)];
        const idx = x & 1 ? byte & 0x0f : byte >> 4;
        const entry = palette[idx] || [0, 0, 0, 255];
        [r, g, b, a] = entry;
      } else {
        const byte = buf[rowStart + (x >> 3)];
        const idx = (byte >> (7 - (x & 7))) & 1;
        const entry = palette[idx] || [0, 0, 0, 255];
        [r, g, b, a] = entry;
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return { width, height, data: out, format: "bmp" };
}

/* ------------------------------------------------------------------- TGA */

function decodeTga(buf) {
  const idLength = buf[0];
  const cmapType = buf[1];
  const imageType = buf[2];
  const cmapFirst = buf.readUInt16LE(3);
  const cmapLength = buf.readUInt16LE(5);
  const cmapDepth = buf[7];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const pixelDepth = buf[16];
  const descriptor = buf[17];
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  if (width <= 0 || height <= 0) throw new ImageError("TGA 尺寸非法");
  let p = 18 + idLength;
  let palette = null;
  if (cmapType === 1) {
    palette = [];
    const bytesPer = Math.ceil(cmapDepth / 8);
    for (let i = 0; i < cmapLength; i++) {
      const q = p + i * bytesPer;
      if (bytesPer >= 3) palette.push([buf[q + 2], buf[q + 1], buf[q], bytesPer === 4 ? buf[q + 3] : 255]);
      else palette.push([buf[q], buf[q], buf[q], 255]);
    }
    p += cmapLength * bytesPer;
  }
  const bytesPer = Math.ceil(pixelDepth / 8);
  const out = new Uint8ClampedArray(width * height * 4);
  const total = width * height;
  const writePixel = (index, src) => {
    const x = index % width;
    const y = (index / width) | 0;
    const dx = rightOrigin ? width - 1 - x : x;
    const dy = topOrigin ? y : height - 1 - y;
    const o = (dy * width + dx) * 4;
    if (imageType === 1 || imageType === 9) {
      const idx = bytesPer === 1 ? src[0] : src[0] | (src[1] << 8);
      const entry = palette[idx - cmapFirst] || [0, 0, 0, 255];
      out[o] = entry[0]; out[o + 1] = entry[1]; out[o + 2] = entry[2]; out[o + 3] = entry[3];
      return;
    }
    if (bytesPer >= 3) {
      out[o] = src[2]; out[o + 1] = src[1]; out[o + 2] = src[0];
      out[o + 3] = bytesPer === 4 ? src[3] : 255;
    } else {
      out[o] = out[o + 1] = out[o + 2] = src[0];
      out[o + 3] = bytesPer === 2 ? src[1] : 255;
    }
  };
  if (imageType === 2 || imageType === 1 || imageType === 3) {
    for (let i = 0; i < total; i++) writePixel(i, buf.subarray(p + i * bytesPer, p + (i + 1) * bytesPer));
  } else if (imageType === 10 || imageType === 9 || imageType === 11) {
    let i = 0;
    while (i < total && p < buf.length) {
      const header = buf[p++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        const src = buf.subarray(p, p + bytesPer);
        p += bytesPer;
        for (let k = 0; k < count && i < total; k++) writePixel(i++, src);
      } else {
        for (let k = 0; k < count && i < total; k++) {
          writePixel(i++, buf.subarray(p, p + bytesPer));
          p += bytesPer;
        }
      }
    }
  } else {
    throw new ImageError("TGA 图像类型 " + imageType + " 不支持");
  }
  return { width, height, data: out, format: "tga" };
}

/* ------------------------------------------------------------- 像素工具 */

/** 裁切（坐标自动夹到图内）。 */
export function cropImage(img, x, y, w, h) {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const ww = Math.max(1, Math.min(img.width - x0, Math.round(w)));
  const hh = Math.max(1, Math.min(img.height - y0, Math.round(h)));
  const data = new Uint8ClampedArray(ww * hh * 4);
  for (let row = 0; row < hh; row++) {
    const src = ((y0 + row) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + ww * 4), row * ww * 4);
  }
  return { width: ww, height: hh, data, format: img.format };
}

/** 箱式滤波缩放（下采样质量够好，且不会像最近邻那样丢细节）。 */
export function resizeArea(img, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const o = (yy * img.width + xx) * 4;
          const alpha = img.data[o + 3] / 255;
          r += img.data[o] * alpha;
          g += img.data[o + 1] * alpha;
          b += img.data[o + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
        out[o + 3] = (a / n) * 255;
      }
    }
  }
  return { width: w, height: h, data: out, format: img.format };
}

/** 长边超限就等比缩下去，返回 { image, scale }。 */
export function fitLongSide(img, maxSide) {
  const long = Math.max(img.width, img.height);
  if (long <= maxSide) return { image: img, scale: 1 };
  const scale = maxSide / long;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return { image: resizeArea(img, w, h), scale };
}

/** 亮度（BT.709）0..1 浮点数组。 */
export function lumaOf(img) {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = (0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]) / 255;
  }
  return out;
}

/** 生成一张纯白底预览（把 alpha 叠到白上，方便肉眼看裁切结果）。 */
export function flattenOn(img, bg = [255, 255, 255]) {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = img.data[i] * a + bg[0] * (1 - a);
    out[i + 1] = img.data[i + 1] * a + bg[1] * (1 - a);
    out[i + 2] = img.data[i + 2] * a + bg[2] * (1 - a);
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out, format: "png" };
}
