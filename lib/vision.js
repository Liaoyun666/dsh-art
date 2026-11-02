/**
 * vision.js —— 从参考图里「看懂」元素、风格与构图（纯 JS，无外部依赖）
 *
 * 这里刻意不假装自己会「语义识别」。它做的是可测量的事：
 *   像素 → 调色板 → 区域（颜色连通 + 邻接合并）→ 背景/天空/地面 → 前景元素（形态学闭合 + 连通）
 *   → 每个元素的几何与颜色特征 → 构图指标（三分法、对称、地平线、负空间、密度）
 * 元素的「角色」（focal / accent / prop / text …）是**按位置与形态推断**的，输出里会带 caveat，
 * 真正的语义命名留给调用方模型结合预览图去写。
 */

import { lumaOf, fitLongSide, resizeArea } from "./image.js";

export const MAX_ANALYSIS_SIDE = 1024;
const TRANSPARENT_ALPHA = 32;

/* ------------------------------------------------------------- 颜色小工具 */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hexOf(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

export function rgb2hsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** 近似人眼感知的 RGB 距离（redmean 加权），0..~765。 */
export function colorDist(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) * 0.5;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  const w = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  return Math.sqrt(w) / 2.4495; // 归一到大约 0..255 的尺度
}

const HUE_FAMILIES = [
  [345, 360, "红", "red"],
  [0, 15, "红", "red"],
  [15, 45, "橙", "orange"],
  [45, 70, "黄", "yellow"],
  [70, 95, "黄绿", "yellow-green"],
  [95, 150, "绿", "green"],
  [150, 180, "青绿", "teal"],
  [180, 200, "青", "cyan"],
  [200, 240, "蓝", "blue"],
  [240, 270, "靛", "indigo"],
  [270, 300, "紫", "purple"],
  [300, 320, "品红", "magenta"],
  [320, 345, "玫红", "rose"],
];

/** 把颜色讲成人话：十六进制 + 色相家族 + 明暗。 */
export function describeColor(r, g, b) {
  const { h, s, v } = rgb2hsv(r, g, b);
  let zh = "灰", en = "grey", family = "neutral";
  if (s < 0.12 || v < 0.06) {
    if (v < 0.12) { zh = "近黑"; en = "near-black"; }
    else if (v > 0.92) { zh = "近白"; en = "near-white"; }
    else if (v < 0.45) { zh = "深灰"; en = "dark grey"; }
    else { zh = "灰"; en = "grey"; }
  } else {
    // zh 的初值是「灰」（给灰阶分支用的）；颜色分支要先清空，否则会拼成「灰橙」「鲜灰橙」。
    zh = "";
    for (const [lo, hi, cz, ce] of HUE_FAMILIES) {
      if (h >= lo && h < hi) { zh += cz; en = ce; family = ce; break; }
    }
    // 更细的描述：低饱和 / 高明度
    if (s < 0.28) { zh = "灰调" + zh; en = "muted " + en; }
    else if (s > 0.75) { zh = "鲜" + zh; en = "vivid " + en; }
    if (v < 0.3) { zh = "暗" + zh; en = "dark " + en; }
    else if (v > 0.9 && s < 0.5) { zh = "浅" + zh; en = "pale " + en; }
  }
  return { hex: hexOf(r, g, b), rgb: [Math.round(r), Math.round(g), Math.round(b)], hue: Math.round(h), sat: +s.toFixed(3), val: +v.toFixed(3), zh, en, family };
}

/* --------------------------------------------------- 像素画网格检测 */

function countUniqueColors(img, cap) {
  const seen = new Set();
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (img.data[o + 3] < TRANSPARENT_ALPHA) continue;
    const key = (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2];
    seen.add(key);
    if (seen.size > cap) return cap + 1;
  }
  return seen.size;
}

/** 在候选块尺寸下，块内部相邻像素「完全相同」的比例。 */
function uniformFraction(img, s) {
  const { width: w, height: h, data } = img;
  let same = 0, total = 0;
  const step = Math.max(1, Math.floor((w * h) / 250000));
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (((x % s) === s - 1) || ((y % s) === s - 1)) continue;
      if ((i % step) !== 0) continue;
      const o = i * 4;
      const oright = o + 4, odown = o + w * 4;
      total++;
      if (data[o] === data[oright] && data[o + 1] === data[oright + 1] && data[o + 2] === data[oright + 2]
        && data[o] === data[odown] && data[o + 1] === data[odown + 1] && data[o + 2] === data[odown + 2]) same++;
    }
  }
  return total === 0 ? 0 : same / total;
}

/** 判断参考图是不是被整数倍放大的像素画，返回它真正的网格尺寸。 */
export function detectPixelArt(img, opts = {}) {
  const unique = countUniqueColors(img, 4096);
  const candidates = opts.scales || [8, 6, 4, 3, 2];
  for (const s of candidates) {
    if (img.width % s !== 0 || img.height % s !== 0) continue;
    if (img.width / s < 16 || img.height / s < 16) continue;
    if (unique > 4096) continue;
    const frac = uniformFraction(img, s);
    if (frac >= 0.985) return { isPixelArt: true, scale: s, uniqueColors: unique, confidence: +frac.toFixed(4) };
  }
  // 单倍图：色数少还不够，必须真的是大片同色（平涂/像素画），否则照片也会被算进来
  if (unique <= 96 && uniformFraction(img, 1) >= 0.55) return { isPixelArt: true, scale: 1, uniqueColors: unique, confidence: +uniformFraction(img, 1).toFixed(4) };
  return { isPixelArt: false, scale: 1, uniqueColors: unique, confidence: 0 };
}

/** 按整数块取代表像素（像素画降采样到真实分辨率，不产生插值杂色）。 */
export function downscaleByBlock(img, s) {
  const w = Math.max(1, Math.floor(img.width / s));
  const h = Math.max(1, Math.floor(img.height / s));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const so = ((y * s + (s >> 1)) * img.width + x * s + (s >> 1)) * 4;
      const doff = (y * w + x) * 4;
      data[doff] = img.data[so];
      data[doff + 1] = img.data[so + 1];
      data[doff + 2] = img.data[so + 2];
      data[doff + 3] = img.data[so + 3];
    }
  }
  return { width: w, height: h, data };
}

/* ------------------------------------------------------------ 调色板 */

/** 经典的 median-cut：在多维颜色盒里对最宽的一维按权重中位切开。 */
export function medianCut(samples, count) {
  if (samples.length === 0) return [{ r: 0, g: 0, b: 0, w: 0 }];
  let buckets = [samples];
  while (buckets.length < count) {
    let best = -1, bestScore = -1;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      const ranges = channelRanges(b);
      const score = Math.max(ranges.r, ranges.g, ranges.b) * Math.sqrt(b.length);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0 || bestScore <= 6) break; // 颜色已经够接近，别再细分
    const bucket = buckets[best];
    const ranges = channelRanges(bucket);
    const channel = ranges.r >= ranges.g && ranges.r >= ranges.b ? "r" : ranges.g >= ranges.b ? "g" : "b";
    bucket.sort((a, b) => a[channel] - b[channel]);
    const totalW = bucket.reduce((s, c) => s + c.w, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < bucket.length - 1; i++) {
      acc += bucket[i].w;
      if (acc >= totalW / 2) { cut = i + 1; break; }
      cut = i + 2;
    }
    buckets.splice(best, 1, bucket.slice(0, cut), bucket.slice(cut));
  }
  return buckets
    .map((b) => {
      let r = 0, g = 0, bl = 0, w = 0;
      for (const c of b) { r += c.r * c.w; g += c.g * c.w; bl += c.b * c.w; w += c.w; }
      return w > 0 ? { r: r / w, g: g / w, b: bl / w, w } : { r: 0, g: 0, b: 0, w: 0 };
    })
    .filter((c) => c.w > 0)
    .sort((a, b) => b.w - a.w);
}

function channelRanges(bucket) {
  let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
  for (const c of bucket) {
    if (c.r < rmin) rmin = c.r; if (c.r > rmax) rmax = c.r;
    if (c.g < gmin) gmin = c.g; if (c.g > gmax) gmax = c.g;
    if (c.b < bmin) bmin = c.b; if (c.b > bmax) bmax = c.b;
  }
  return { r: rmax - rmin, g: gmax - gmin, b: bmax - bmin };
}

/** 把每个像素映射到最近的调色板条目（用 5bit 缓存避免重复计算）。 */
export function buildIndexMap(img, palette) {
  const n = img.width * img.height;
  const out = new Uint16Array(n);
  const cache = new Int16Array(32768).fill(-1);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (img.data[o + 3] < TRANSPARENT_ALPHA) { out[i] = 65535; continue; }
    const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx < 0) {
      let bestD = Infinity;
      idx = 0;
      for (let k = 0; k < palette.length; k++) {
        const d = colorDist(r, g, b, palette[k].r, palette[k].g, palette[k].b);
        if (d < bestD) { bestD = d; idx = k; }
      }
      cache[key] = idx;
    }
    out[i] = idx;
  }
  return out;
}

/* ------------------------------------------------------------ 边缘图 */

/** Sobel 梯度幅值（0..1）。 */
export function gradientMagnitude(img, luma) {
  const { width: w, height: h } = img;
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = luma[i - w - 1], t = luma[i - w], tr = luma[i - w + 1];
      const l = luma[i - 1], r = luma[i + 1];
      const bl = luma[i + w - 1], b = luma[i + w], br = luma[i + w + 1];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      g[i] = Math.sqrt(gx * gx + gy * gy) / 4;
    }
  }
  return g;
}

/** Otsu 阈值（0..255 直方图）。 */
export function otsuThreshold(hist) {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  if (total === 0) return 128;
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

/** 边缘掩码：亮度 Sobel + 色度突变，阈值取 Otsu。 */
export function buildEdgeMap(img, luma) {
  const grad = gradientMagnitude(img, luma);
  const hist = new Float64Array(256);
  for (let i = 0; i < grad.length; i++) hist[Math.max(0, Math.min(255, Math.round(grad[i] * 255)))]++;
  const thr = Math.max(8, otsuThreshold(hist));
  const edge = new Uint8Array(grad.length);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (grad[i] * 255 >= thr) { edge[i] = 1; continue; }
      // 颜色跳变（同亮度不同色，比如红/绿交界）也算边
      const o = i * 4;
      if (data[o + 3] < TRANSPARENT_ALPHA) continue;
      let localMax = 0;
      if (x > 0) localMax = Math.max(localMax, colorDist(data[o], data[o + 1], data[o + 2], data[o - 4], data[o - 3], data[o - 2]));
      if (x + 1 < w) localMax = Math.max(localMax, colorDist(data[o], data[o + 1], data[o + 2], data[o + 4], data[o + 5], data[o + 6]));
      if (y > 0) { const q = o - w * 4; localMax = Math.max(localMax, colorDist(data[o], data[o + 1], data[o + 2], data[q], data[q + 1], data[q + 2])); }
      if (y + 1 < h) { const q = o + w * 4; localMax = Math.max(localMax, colorDist(data[o], data[o + 1], data[o + 2], data[q], data[q + 1], data[q + 2])); }
      if (localMax >= 48) edge[i] = 1;
    }
  }
  return { edge, gradient: grad, threshold: thr };
}

/* -------------------------------------------------------- 区域分割 */

/**
 * 颜色连通区域 + 邻接合并。
 * 返回 { labels, regions } —— labels[i] 是区域 id（-1 无效，-2 透明），regions[id] 有面积/包围盒/均值色。
 * edge 可选：给了就同时记下每对区域边界上有多少边缘像素（背景判定要用）。
 */
export function segmentRegions(img, indexMap, edge, opts = {}) {
  const { width: w, height: h } = img;
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const regions = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1) continue;
    const idx = indexMap[start];
    if (idx === 65535) { labels[start] = -2; continue; }
    const id = regions.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let area = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    let sr = 0, sg = 0, sb = 0;
    const pixels = [];
    while (sp > 0) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % w, y = (i / w) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      sr += img.data[i * 4]; sg += img.data[i * 4 + 1]; sb += img.data[i * 4 + 2];
      if (x > 0 && labels[i - 1] === -1 && indexMap[i - 1] === idx) { labels[i - 1] = id; stack[sp++] = i - 1; }
      if (x + 1 < w && labels[i + 1] === -1 && indexMap[i + 1] === idx) { labels[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && labels[i - w] === -1 && indexMap[i - w] === idx) { labels[i - w] = id; stack[sp++] = i - w; }
      if (y + 1 < h && labels[i + w] === -1 && indexMap[i + w] === idx) { labels[i + w] = id; stack[sp++] = i + w; }
    }
    regions.push({
      id, area, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      mean: { r: sr / area, g: sg / area, b: sb / area },
      pixels,
    });
  }

  if (opts.debug) console.error('[seg] 初始连通块 ' + regions.length + ' 个（' + w + 'x' + h + '）');
  return mergeRegions(img, labels, regions, edge, opts.mergeThreshold ?? 13, opts.maxRegions ?? 320, !!opts.debug);
}

/** 统计区域对的共享边界长度、其中边缘像素数（4 邻域，横向 + 纵向各算一次）。 */
function collectBoundaries(labels, w, h, edge) {
  const map = new Map();
  const bump = (a, b, i, j) => {
    if (a < 0 || b < 0 || a === b) return;
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * 1048576 + hi;
    let e = map.get(key);
    if (e === undefined) { e = { a: lo, b: hi, len: 0, ed: 0 }; map.set(key, e); }
    e.len++;
    if (edge && (edge.edge[i] || edge.edge[j])) e.ed++;
  };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (x + 1 < w) bump(labels[i], labels[i + 1], i, i + 1);
      if (y + 1 < h) bump(labels[i], labels[i + w], i, i + w);
    }
  }
  return map;
}

/**
 * 最小堆合并：每轮取当前颜色最接近的一对邻接区域合并，合并后按新均值重算受影响边的距离。
 * 阈值内的全部并完之后，若区域数仍超过 maxRegions，则不管颜色继续并到达标（细节爆炸的照片不至于拖死后续步骤）。
 */
function mergeRegions(img, labels, regions, edge, threshold, maxRegions, debug = false) {
  const t0 = Date.now();
  const { width: w, height: h } = img;
  const R = regions.length;
  const parent = new Int32Array(R);
  for (let i = 0; i < R; i++) parent[i] = i;
  const find = (a) => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) { const nx = parent[a]; parent[a] = r; a = nx; }
    return r;
  };
  const area = new Float64Array(R);
  const mean = new Float64Array(R * 3);
  for (let i = 0; i < R; i++) {
    area[i] = regions[i].area;
    mean[i * 3] = regions[i].mean.r;
    mean[i * 3 + 1] = regions[i].mean.g;
    mean[i * 3 + 2] = regions[i].mean.b;
  }

  // 边表：a / b 是初始区域 id，合并时用 find 换算；ver 用于「惰性失效」
  const bounds = collectBoundaries(labels, w, h, edge);
  const edges = new Array(bounds.size);
  let ei = 0;
  for (const bv of bounds.values()) edges[ei++] = bv;
  bounds.clear();

  const adj = new Array(R).fill(null);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!adj[e.a]) adj[e.a] = new Set();
    if (!adj[e.b]) adj[e.b] = new Set();
    adj[e.a].add(i);
    adj[e.b].add(i);
  }

  if (debug) console.error('[seg] 邻接边 ' + edges.length + ' 条，建表 ' + (Date.now() - t0) + 'ms');

  const ver = new Int32Array(edges.length);
  const distOf = (i) => {
    const e = edges[i];
    const ra = find(e.a), rb = find(e.b);
    if (ra === rb) return Infinity;
    return colorDist(mean[ra * 3], mean[ra * 3 + 1], mean[ra * 3 + 2], mean[rb * 3], mean[rb * 3 + 1], mean[rb * 3 + 2]);
  };

  // 最小堆（并列数组存 {d, i, ver}，不逐条 new 对象，省 GC）
  let hcap = Math.max(1024, edges.length * 2 + 64);
  let hd = new Float64Array(hcap);
  let hix = new Int32Array(hcap);
  let hvv = new Int32Array(hcap);
  let hn = 0;
  const hgrow = () => {
    hcap *= 2;
    const d2 = new Float64Array(hcap); d2.set(hd); hd = d2;
    const i2 = new Int32Array(hcap); i2.set(hix); hix = i2;
    const v2 = new Int32Array(hcap); v2.set(hvv); hvv = v2;
  };
  const hless = (x, y) => (hd[x] !== hd[y] ? hd[x] < hd[y] : hix[x] < hix[y]);
  const hpush = (d, i, v) => {
    if (hn === hcap) hgrow();
    let k = hn++;
    hd[k] = d; hix[k] = i; hvv[k] = v;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!hless(k, p)) break;
      const td = hd[k]; hd[k] = hd[p]; hd[p] = td;
      const ti = hix[k]; hix[k] = hix[p]; hix[p] = ti;
      const tv = hvv[k]; hvv[k] = hvv[p]; hvv[p] = tv;
      k = p;
    }
  };
  let popI = -1, popV = -1, popD = 0;
  const hpop = () => {
    popI = hix[0]; popV = hvv[0]; popD = hd[0];
    const n2 = --hn;
    if (n2 > 0) {
      hd[0] = hd[n2]; hix[0] = hix[n2]; hvv[0] = hvv[n2];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < n2 && hless(l, m)) m = l;
        if (r < n2 && hless(r, m)) m = r;
        if (m === k) break;
        const td = hd[k]; hd[k] = hd[m]; hd[m] = td;
        const ti = hix[k]; hix[k] = hix[m]; hix[m] = ti;
        const tv = hvv[k]; hvv[k] = hvv[m]; hvv[m] = tv;
        k = m;
      }
    }
  };

  let count = R;
  /**
   * 合并：keep 吃掉 gone。
   * 关键性能点：只重推 gone 那一侧的边（keep 侧的边距离虽然也变了，但 pop 时会现算，
   * 不会再「每并一次就把巨型区域的整圈边重推一遍」——那正是早先 O(边数×合并数) 爆炸的原因）。
   * keep 选邻边多的一侧，保证每条边被搬家的次数是 O(log)。
   */
  const merge = (ra, rb) => {
    const sa = adj[ra], sb = adj[rb];
    const lenA = sa ? sa.size : 0, lenB = sb ? sb.size : 0;
    const keep = lenA !== lenB ? (lenA > lenB ? ra : rb) : (area[ra] >= area[rb] ? ra : rb);
    const gone = keep === ra ? rb : ra;
    const a1 = area[keep], a2 = area[gone], tot = a1 + a2;
    for (let c = 0; c < 3; c++) mean[keep * 3 + c] = (mean[keep * 3 + c] * a1 + mean[gone * 3 + c] * a2) / tot;
    area[keep] = tot;
    parent[gone] = keep;
    const sg = adj[gone];
    if (sg) {
      let sk = adj[keep];
      if (!sk) { sk = new Set(); adj[keep] = sk; }
      for (const idx of sg) {
        const e = edges[idx];
        const internal = find(e.a) === find(e.b);
        sk.add(idx);
        if (internal) continue;
        ver[idx] = (ver[idx] + 1) | 0;
        hpush(distOf(idx), idx, ver[idx]);
      }
      adj[gone] = null;
    }
    count--;
  };

  for (let i = 0; i < edges.length; i++) hpush(distOf(i), i, ver[i]);
  let pops = 0;
  const maxPops = edges.length * 10 + 500000;
  while (hn > 0) {
    hpop();
    const idx = popI;
    if (popV !== ver[idx]) continue;
    const e = edges[idx];
    const ra = find(e.a), rb = find(e.b);
    if (ra === rb) continue;
    const d = distOf(idx);
    if (d > threshold) continue;
    merge(ra, rb);
    if (count <= 1) break;
    if (++pops > maxPops) break;
  }

  if (debug) console.error('[seg] 阈值段结束 count=' + count + ' pops=' + pops + ' 堆=' + hn + ' 用时 ' + (Date.now() - t0) + 'ms');

  // 阈值并完还超标：把「最小的区域」逐个并进最近的邻居（按面积最小优先，而不是按颜色最接近）。
  // 按颜色最先并会把两个大块并成一个横跨画面的怪物；按面积最小并只吃掉碎片，主体结构保住。
  if (count > maxRegions) {
    const rver = new Int32Array(R);
    const pushRegion = (r) => { rver[r] = (rver[r] + 1) | 0; hpush(area[r], r, rver[r]); };
    hn = 0;
    for (let i = 0; i < R; i++) if (parent[i] === i) pushRegion(i);
    let steps = 0;
    const maxSteps = R * 4 + 10000;
    while (hn > 0 && count > maxRegions) {
      hpop();
      const r = popI;
      if (popV !== rver[r]) continue;
      if (parent[r] !== r) continue;
      const s = adj[r];
      let bestE = -1, bestD = Infinity;
      if (s) for (const idx of s) {
        const d = distOf(idx);
        if (d < bestD) { bestD = d; bestE = idx; }
      }
      if (bestE < 0) continue;
      const e = edges[bestE];
      const ra = find(e.a), rb = find(e.b);
      if (ra === rb) continue;
      merge(ra, rb);
      const kept = parent[ra] === ra ? ra : rb;
      pushRegion(kept);
      if (++steps > maxSteps) break;
    }
  }
  if (debug) console.error('[seg] 碎片并段结束 count=' + count + ' 用时 ' + (Date.now() - t0) + 'ms');

  // 重编号 + 按像素重算面积/包围盒/均值色（合并时的加权均值与像素均值等价，这里统一以像素为准）
  const remap = new Int32Array(R).fill(-1);
  let outCount = 0;
  for (let i = 0; i < R; i++) {
    const root = find(i);
    if (remap[root] === -1) remap[root] = outCount++;
  }
  const outLabels = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    outLabels[i] = l < 0 ? l : remap[find(l)];
  }
  const out = new Array(outCount);
  for (let i = 0; i < outCount; i++) {
    out[i] = { id: i, area: 0, x0: w, y0: h, x1: -1, y1: -1, sr: 0, sg: 0, sb: 0, pixels: [] };
  }
  for (let i = 0; i < outLabels.length; i++) {
    const id = outLabels[i];
    if (id < 0) continue;
    const r = out[id];
    r.area++;
    r.pixels.push(i);
    const x = i % w, y = (i / w) | 0;
    if (x < r.x0) r.x0 = x;
    if (x > r.x1) r.x1 = x;
    if (y < r.y0) r.y0 = y;
    if (y > r.y1) r.y1 = y;
    const o = i * 4;
    r.sr += img.data[o]; r.sg += img.data[o + 1]; r.sb += img.data[o + 2];
  }
  for (const r of out) {
    r.bbox = { x: r.x0, y: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 };
    r.mean = r.area ? { r: r.sr / r.area, g: r.sg / r.area, b: r.sb / r.area } : { r: 0, g: 0, b: 0 };
    delete r.x0; delete r.y0; delete r.x1; delete r.y1;
    delete r.sr; delete r.sg; delete r.sb;
  }
  return { labels: outLabels, regions: out };
}

/** 区域邻接表（合并后重建）。 */
export function buildAdjacency(labels, w, h) {
  const adj = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, l = labels[i];
      if (x + 1 < w) link(adj, l, labels[i + 1]);
      if (y + 1 < h) link(adj, l, labels[i + w]);
    }
  }
  return adj;
}

function link(adj, a, b) {
  if (a < 0 || b < 0 || a === b) return;
  if (!adj.has(a)) adj.set(a, new Set());
  if (!adj.has(b)) adj.set(b, new Set());
  adj.get(a).add(b);
  adj.get(b).add(a);
}

/* ------------------------------------------------------- 背景 / 天空 / 地面 */

function borderCoverage(region, w, h) {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (const i of region.pixels) {
    const x = i % w, y = (i / w) | 0;
    if (y === 0) top++;
    if (y === h - 1) bottom++;
    if (x === 0) left++;
    if (x === w - 1) right++;
  }
  return { top: top / w, bottom: bottom / w, left: left / h, right: right / h };
}

function densityOf(pixels, map) {
  if (pixels.length === 0) return 0;
  let c = 0;
  for (const i of pixels) if (map[i]) c++;
  return c / pixels.length;
}

/**
 * 色相连续性：背景扩散允许「同色相、逐渐变亮/变暗」（渐变天空、光晕），
 * 但不允许跨色相（蓝天 -> 绿地的分界正是靠这个挡住的；两侧都接近灰阶时则只看亮度连续）。
 */
function hueContinuous(a, b, d) {
  if (d <= 12) return true;
  const A = rgb2hsv(a.r, a.g, a.b), B = rgb2hsv(b.r, b.g, b.b);
  if (A.s < 0.10 && B.s < 0.10) return true;
  if (A.v < 0.06 && B.v < 0.06) return true;
  let dh = Math.abs(A.h - B.h);
  if (dh > 180) dh = 360 - dh;
  return dh <= 32;
}

/**
 * 地平线不明确时（天空和地面连成一块），找背景里跳得最狠的一条「整行颜色分界」。
 * 只看背景像素够多（>=6% 宽）的行，避免被横穿画面的物体带偏；红均值色距 >= 22 才算数。
 */
function findHorizonByRows(bgMask, img, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0, c = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bgMask[i]) continue;
      const o = i * 4;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2];
      c++;
    }
    // 行里有 >=6% 宽的背景像素才算「已知」，否则这一行被前景占满
    rows.push(c >= Math.max(4, w * 0.06) ? { y, cov: c / w, r: r / c, g: g / c, b: b / c } : null);
  }
  const known = rows.filter(Boolean);
  const y0 = Math.floor(h * 0.08), y1 = Math.ceil(h * 0.94);
  let bestY = null, bestD = 0;
  for (let k = 1; k < known.length; k++) {
    const up = known[k - 1], down = known[k];
    if (down.y < y0 || down.y > y1) continue;
    if (down.y - up.y > Math.max(12, Math.round(h * 0.16))) continue;  // 中间隔太远就不算同一条分界
    if (down.cov < 0.25) continue;             // 分界下方得是成片的区域，不能是缝里的一两条
    const d = colorDist(up.r, up.g, up.b, down.r, down.g, down.b);
    if (d > bestD) { bestD = d; bestY = down.y; }
  }
  return bestD >= 22 ? bestY : null;
}

/**
 * 背景 = 从边框长出来的「大片 + 平滑 + 同色相」区域。
 *   1) 种子：贴边覆盖率高、面积够大、内部边缘稀疏的块；
 *   2) 扩散：与当前块色差 < 42、共享边界上的边缘像素占比 <= 0.5（强轮廓阻断）、色相连续；
 *   3) 天空 / 地面按背景掩膜连通块在顶边 / 底边的覆盖率认，地平线取两者交界。
 * 透明 PNG 的透明像素直接算背景。
 */
export function classifyBackground(img, seg, edge, opts = {}) {
  const { width: w, height: h } = img;
  const n = w * h;
  const { labels, regions } = seg;

  const transparent = new Uint8Array(n);
  let transparentPixels = 0;
  for (let i = 0; i < n; i++) {
    if (img.data[i * 4 + 3] < TRANSPARENT_ALPHA) { transparent[i] = 1; transparentPixels++; }
  }
  const transparentShare = transparentPixels / n;

  const bounds = collectBoundaries(labels, w, h, edge);
  const neigh = new Map();
  for (const e of bounds.values()) {
    const frac = e.len ? e.ed / e.len : 0;
    if (!neigh.has(e.a)) neigh.set(e.a, []);
    if (!neigh.has(e.b)) neigh.set(e.b, []);
    neigh.get(e.a).push({ other: e.b, frac });
    neigh.get(e.b).push({ other: e.a, frac });
  }

  const isBg = new Uint8Array(regions.length);
  const minSeedArea = Math.max(64, n * (opts.seedMinShare ?? 0.004));
  const seeds = [];
  regions.forEach((r, id) => {
    if (r.area < minSeedArea) return;
    const c = borderCoverage(r, w, h);
    const m = Math.max(c.top, c.bottom, c.left, c.right);
    if (m < (opts.seedCoverage ?? 0.28)) return;
    if (densityOf(r.pixels, edge.edge) >= 0.35) return;
    seeds.push(id);
  });
  seeds.sort((a, b) => regions[b].area - regions[a].area);

  const maxDist = opts.maxBgDist ?? 42;
  const maxEdgeFrac = opts.maxEdgeFrac ?? 0.5;
  const maxGrowShare = opts.maxBgShare ?? 0.85;
  let bgPixels = transparentPixels;
  const accept = (from, to, frac) => {
    const A = regions[from], B = regions[to];
    if (B.area > n * 0.55) return false;
    if (frac > maxEdgeFrac) return false;
    const d = colorDist(A.mean.r, A.mean.g, A.mean.b, B.mean.r, B.mean.g, B.mean.b);
    if (d > maxDist) return false;
    return hueContinuous(A.mean, B.mean, d);
  };

  const expandFrom = (seedIds) => {
    const queue = [];
    for (const s of seedIds) {
      if (isBg[s]) continue;
      isBg[s] = 1;
      bgPixels += regions[s].area;
      queue.push(s);
    }
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      for (const nb of neigh.get(cur) || []) {
        const t = nb.other;
        if (isBg[t]) continue;
        if (bgPixels + regions[t].area > n * maxGrowShare) continue;
        if (!accept(cur, t, nb.frac)) continue;
        isBg[t] = 1;
        bgPixels += regions[t].area;
        queue.push(t);
      }
    }
  };
  expandFrom(seeds);

  // 装裱层：包围盒几乎盖满全图、却只占很少面积的「环」= 留白 / 画框 / 圆环之类的外圈。
  // 环里面那块大的平坦块就是画板 / 支撑面（也可能是墙、幕布），同样算背景；
  // 夹在内外两层背景之间的环，就是画框本身，也归背景。
  const isRing = (r) => r.bbox.w >= w * 0.7 && r.bbox.h >= h * 0.7 && r.area <= r.bbox.w * r.bbox.h * 0.6;
  const supportIds = [];
  const frameIds = [];
  if (seeds.some((s) => isRing(regions[s])) || regions.some((r) => isBg[r.id] && isRing(r))) {
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      for (const r of regions) {
        if (!isBg[r.id] || !isRing(r)) continue;
        const bx = r.bbox.x + 1, by = r.bbox.y + 1;
        const bw = Math.max(0, r.bbox.w - 2), bh = Math.max(0, r.bbox.h - 2);
        let best = -1, bestArea = 0;
        for (const c of regions) {
          if (isBg[c.id]) continue;
          const b = c.bbox;
          if (b.x < bx || b.y < by || b.x + b.w > bx + bw + 1 || b.y + b.h > by + bh + 1) continue;
          if (b.w * b.h < (bw * bh) * 0.45) continue;                      // 得几乎铺满环内
          if (densityOf(c.pixels, edge.edge) > (opts.supportEdgeMax ?? 0.10)) continue;  // 而且得平
          if (c.area > bestArea) { bestArea = c.area; best = c.id; }
        }
        if (best >= 0) { add.push(best); supportIds.push(best); }
      }
      if (!add.length) break;
      expandFrom(add);
    }
    // 画框：环状、面积够、平、且挨着背景
    for (const r of regions) {
      if (r.area < n * 0.02) continue;
      const nbs = neigh.get(r.id) || [];
      if (!nbs.some((x) => isBg[x.other])) continue;
      if (isBg[r.id] || !isRing(r)) continue;
      if (densityOf(r.pixels, edge.edge) > (opts.frameEdgeMax ?? 0.25)) continue;
      isBg[r.id] = 1;
      bgPixels += r.area;
      frameIds.push(r.id);
    }
    if (frameIds.length) expandFrom(frameIds);
  }

  const bgMask = new Uint8Array(n);
  let bgArea = 0;
  for (let i = 0; i < n; i++) {
    if (transparent[i]) { bgMask[i] = 1; bgArea++; continue; }
    const l = labels[i];
    if (l >= 0 && isBg[l]) { bgMask[i] = 1; bgArea++; }
  }

  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!bgMask[i] || transparent[i]) continue;
    const o = i * 4;
    sr += img.data[o]; sg += img.data[o + 1]; sb += img.data[o + 2];
    cnt++;
  }
  const bgMean = cnt ? { r: sr / cnt, g: sg / cnt, b: sb / cnt } : null;

  // 天空 / 地面：背景掩膜的连通块，谁占住顶边 / 底边谁就是
  const comp = labelComponents(bgMask, w, h);
  const topCov = new Map(), botCov = new Map();
  for (let x = 0; x < w; x++) {
    const a = comp.labels[x];
    if (a >= 0) topCov.set(a, (topCov.get(a) || 0) + 1);
    const b = comp.labels[(h - 1) * w + x];
    if (b >= 0) botCov.set(b, (botCov.get(b) || 0) + 1);
  }
  const bestBand = (cov) => {
    let id = -1, bestCount = 0;
    for (const [k, c] of cov) if (c > bestCount) { bestCount = c; id = k; }
    return bestCount / w >= (opts.bandCoverage ?? 0.3) ? { id, cover: bestCount / w } : null;
  };
  const skyC = bestBand(topCov);
  const groundC = bestBand(botCov);
  const compRows = (id) => {
    const rows = new Map();
    for (const i of comp.comps[id].pixels) {
      const y = (i / w) | 0;
      rows.set(y, (rows.get(y) || 0) + 1);
    }
    return rows;
  };
  const rowTop = (id, minFrac) => {
    const rows = compRows(id);
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
      if (rows.get(y) >= w * minFrac) return y;
    }
    return comp.comps[id].bbox.y;
  };

  // 一条背景块既顶到上边又顶到下边 = 天空和地面连成一片（渐变、灰调、中间有横向缺口都会这样）
  const presented = frameIds.length > 0 || supportIds.length > 0;   // 装裱/带边的照片：天空地面不成立
  const sameBand = !!(skyC && groundC && skyC.id === groundC.id);
  let horizon = null;
  if (presented) horizon = null;
  else if (sameBand) horizon = findHorizonByRows(bgMask, img, w, h);
  else if (groundC) horizon = rowTop(groundC.id, 0.3);
  else if (skyC) horizon = comp.comps[skyC.id].bbox.y + comp.comps[skyC.id].bbox.h;

  // 区间统计：同一个背景块按行切成上/下两段，各自算面积与颜色
  const bandStats = (id, from, to, cover) => {
    let r = 0, g = 0, b = 0, k = 0, area = 0;
    for (const i of comp.comps[id].pixels) {
      const y = (i / w) | 0;
      if (y < from || y >= to) continue;
      area++;
      if (transparent[i]) continue;
      const o = i * 4;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2];
      k++;
    }
    if (area === 0 || k === 0) return null;
    return { share: +cover.toFixed(3), areaShare: +(area / n).toFixed(4), color: describeColor(r / k, g / k, b / k) };
  };

  let sky = null, ground = null;
  if (presented) { /* 上面那套是给风景/场景图用的，装裱照片不适用 */ }
  else if (sameBand) {
    if (horizon != null) {
      sky = bandStats(skyC.id, 0, horizon, skyC.cover);
      ground = bandStats(skyC.id, horizon, h, groundC.cover);
    } else {
      sky = bandStats(skyC.id, 0, h, skyC.cover);
    }
  } else {
    if (skyC) sky = bandStats(skyC.id, 0, h, skyC.cover);
    if (groundC) ground = bandStats(groundC.id, 0, h, groundC.cover);
  }
  if (sky) sky.bottomY = horizon != null ? horizon - 1 : comp.comps[skyC.id].bbox.y + comp.comps[skyC.id].bbox.h;
  if (ground) ground.topY = horizon != null ? horizon : comp.comps[groundC.id].bbox.y;

  return {
    mask: bgMask,
    areaShare: +(bgArea / n).toFixed(4),
    isTransparent: transparentShare > 0.03,
    transparentShare: +transparentShare.toFixed(4),
    color: bgMean ? describeColor(bgMean.r, bgMean.g, bgMean.b) : null,
    luma: bgMean ? (0.2126 * bgMean.r + 0.7152 * bgMean.g + 0.0722 * bgMean.b) / 255 : 0.5,
    sky,
    ground,
    horizon,
    seedCount: seeds.length,
    regionCount: regions.filter((r) => isBg[r.id]).length,
    frame: presented,
    frameRegions: frameIds.length,
    supportRegions: supportIds.length,
  };
}

/* ----------------------------------------------------- 形态学 + 连通块 */

/** 方形结构元的膨胀（两趟一维最大值滤波）。 */
function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1;
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function erode(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = d[i] ? 0 : 1;
  return out;
}

/** 4 连通块标记，返回 { labels, comps }。 */
export function labelComponents(mask, w, h) {
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const comps = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = comps.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    const pixels = [];
    let minX = w, minY = h, maxX = -1, maxY = -1;
    while (sp > 0) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[i - 1] && labels[i - 1] === -1) { labels[i - 1] = id; stack[sp++] = i - 1; }
      if (x + 1 < w && mask[i + 1] && labels[i + 1] === -1) { labels[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && labels[i - w] === -1) { labels[i - w] = id; stack[sp++] = i - w; }
      if (y + 1 < h && mask[i + w] && labels[i + w] === -1) { labels[i + w] = id; stack[sp++] = i + w; }
    }
    comps.push({ id, pixels, area: pixels.length, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } });
  }
  return { labels, comps };
}

/* ------------------------------------------------------------ 元素特征 */

function paletteOfPixels(pixels, img, count = 5) {
  const map = new Map();
  const step = Math.max(1, Math.floor(pixels.length / 4000));
  for (let k = 0; k < pixels.length; k += step) {
    const o = pixels[k] * 4;
    if (img.data[o + 3] < TRANSPARENT_ALPHA) continue;
    const key = ((img.data[o] >> 3) << 10) | ((img.data[o + 1] >> 3) << 5) | (img.data[o + 2] >> 3);
    const e = map.get(key);
    if (e) { e.n++; e.r += img.data[o]; e.g += img.data[o + 1]; e.b += img.data[o + 2]; }
    else map.set(key, { n: 1, r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] });
  }
  const total = [...map.values()].reduce((s, e) => s + e.n, 0) || 1;
  return [...map.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((e) => ({ ...describeColor(e.r / e.n, e.g / e.n, e.b / e.n), share: +(e.n / total).toFixed(3) }));
}

function symmetryOf(pixels, bbox, w) {
  const bw = bbox.w, bh = bbox.h;
  const set = new Set(pixels);
  let both = 0, either = 0;
  for (const i of pixels) {
    const x = i % w, y = (i / w) | 0;
    const mx = bbox.x + (bbox.x + bw - 1 - x);
    const j = y * w + mx;
    either++;
    if (set.has(j)) both++;
  }
  return either === 0 ? 0 : both / either;
}


function pixelStats(pixels, img) {
  let r = 0, g = 0, b = 0, l = 0;
  for (const i of pixels) {
    const o = i * 4;
    r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2];
    l += (0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]) / 255;
  }
  const k = pixels.length || 1;
  return { color: describeColor(r / k, g / k, b / k), luma: l / k };
}

/** 越靠下、越大 → 越近；三层：far / midground / near。 */
function assignDepth(elements, h) {
  if (elements.length === 0) return;
  const maxArea = Math.max(...elements.map((e) => e.area));
  for (const e of elements) {
    const score = e.bottom * 0.68 + (e.area / maxArea) * 0.32;
    e.layer = score >= 0.66 ? "near" : score >= 0.42 ? "midground" : "far";
    e.depthScore = +score.toFixed(3);
  }
}

/* -------------------------------------------------------- 部件 / 物体分组 */

/** 前景部件：颜色一致、面积够大的区域（大部分像素属于背景的块直接丢掉）。 */
export function collectParts(img, seg, bg, edge, opts = {}) {
  const n = img.width * img.height;
  const minArea = Math.max(16, n * (opts.partMinShare ?? 0.0012));
  const parts = [];
  for (const r of seg.regions) {
    if (r.area < minArea) continue;
    let bgCount = 0;
    for (const i of r.pixels) if (bg.mask[i]) bgCount++;
    const bgShare = bgCount / r.pixels.length;
    if (bgShare >= 0.6) continue;
    parts.push({
      id: parts.length,
      regionId: r.id,
      area: r.area,
      bbox: r.bbox,
      fill: +(r.area / (r.bbox.w * r.bbox.h)).toFixed(3),
      edgeDensity: +densityOf(r.pixels, edge.edge).toFixed(3),
      meanRgb: { r: r.mean.r, g: r.mean.g, b: r.mean.b },
      bgShare: +bgShare.toFixed(3),
      pixels: r.pixels,
    });
  }
  return parts;
}

function bboxGap(a, b) {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
}

/** 两个包围盒的重叠面积占较小盒子的比例（>=0.35 基本就是同一个物体了）。 */
function bboxOverlapShare(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const small = Math.min(a.w * a.h, b.w * b.h);
  return small > 0 ? (ix * iy) / small : 0;
}

function bboxUnion(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** 组的面积加权主色。 */
function groupMeanRgb(g) {
  let r = 0, gg = 0, b = 0, sum = 0;
  for (const p of g.parts) {
    r += p.meanRgb.r * p.area; gg += p.meanRgb.g * p.area; b += p.meanRgb.b * p.area;
    sum += p.area;
  }
  return sum ? { r: r / sum, g: gg / sum, b: b / sum } : { r: 0, g: 0, b: 0 };
}

/** 颜色亲和：同色 1.0，色相连贯 0.8，其余 0.15（不相干的颜色不并）。 */
function groupAffinity(a, b) {
  const A = groupMeanRgb(a), B = groupMeanRgb(b);
  const d = colorDist(A.r, A.g, A.b, B.r, B.g, B.b);
  if (d <= 18) return 1;
  if (d <= 60 && hueContinuous(A, B, d)) return 0.8;
  return 0.15;
}

/** 两个区间重叠长度（不重叠为 0）。 */
function overlapLen(a0, al, b0, bl) {
  return Math.max(0, Math.min(a0 + al, b0 + bl) - Math.max(a0, b0));
}

/**
 * 细节吸附：小部件（头、腿、树干、配饰）如果和某个更大的组「贴在一起 + 对齐得好」，
 * 就并进去。颜色不参与判断——头和躯干色差很大，但它们本来就是一个人。
 * 对齐要够强（重叠 >= 0.7 个较小边），否则山体会把旁边的小东西全吞掉。
 */
export function attachDetails(groups, w, h, opts = {}) {
  const n = w * h;
  const maxGap = Math.max(2, Math.min(w, h) * (opts.attachGapShare ?? 0.02));
  const dead = new Set();
  const order = groups.map((_, i) => i).sort((i, j) => groups[i].area - groups[j].area);
  for (const gi of order) {
    if (dead.has(gi)) continue;
    const g = groups[gi];
    let best = -1, bestScore = 0;
    for (let hj = 0; hj < groups.length; hj++) {
      if (hj === gi || dead.has(hj)) continue;
      const host = groups[hj];
      if (host.area <= g.area) continue;
      if (g.area > host.area * 0.6) continue;
      // 宽扁的「条带」（山脊、地平线、远景）不当宿主：往它身上挂等于把主体并进背景
      if (host.bbox.w / Math.max(1, host.bbox.h) > 2.2) continue;
      const gap = bboxGap(g.bbox, host.bbox);
      if (gap > maxGap) continue;
      const ox = overlapLen(g.bbox.x, g.bbox.w, host.bbox.x, host.bbox.w);
      const oy = overlapLen(g.bbox.y, g.bbox.h, host.bbox.y, host.bbox.h);
      const aligned = ox >= Math.min(g.bbox.w, host.bbox.w) * 0.7 || oy >= Math.min(g.bbox.h, host.bbox.h) * 0.7;
      if (!aligned) continue;
      const box = bboxUnion(g.bbox, host.bbox);
      if ((g.area + host.area) / (box.w * box.h) < 0.3) continue;
      if (g.area + host.area > n * (opts.attachMaxShare ?? 0.45)) continue;
      const score = groupAffinity(g, host) * 2 - Math.min(gap, 8) * 0.05;
      if (score > bestScore) { bestScore = score; best = hj; }
    }
    if (best >= 0 && bestScore >= 0.25) {
      const host = groups[best];
      host.parts = host.parts.concat(g.parts);
      host.area += g.area;
      host.bbox = bboxUnion(host.bbox, g.bbox);
      dead.add(gi);
    }
  }
  return groups.filter((_, i) => !dead.has(i));
}

/**
 * 把挨得够近、拼起来仍然紧实的部件并成一个物体（最近的一对先并）。
 * 约束：缝隙 <= maxGap、并集面积不超过整图 legitShare、并集填充率 >= minFill。
 * 宽扁的部件（山脊、水面）不会并进竖长的物体里，因为并集填充率会掉下来。
 */
export function groupParts(parts, w, h, opts = {}) {
  const n = w * h;
  const maxGap = Math.max(2, Math.min(w, h) * (opts.maxGapShare ?? 0.02));
  const maxArea = n * (opts.groupMaxShare ?? 0.16);
  const minFill = opts.groupMinFill ?? 0.3;
  const groups = parts.map((p) => ({ parts: [p], bbox: { ...p.bbox }, area: p.area }));
  for (;;) {
    let bi = -1, bj = -1, bestGap = Infinity, bestBox = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const gi = groups[i], gj = groups[j];
        const aff = groupAffinity(gi, gj);
        const ov = bboxOverlapShare(gi.bbox, gj.bbox);
        // 异色也能并的唯一理由：包围盒强重叠（同一个物体的不同部件，比如身体的蓝和纱丽的黄）。
        // 但宽扁的条带（山脊、地平线）与塞进去的小块不算——否则角色脑袋会被塞进山体。
        const aspectA = gi.bbox.w / Math.max(1, gi.bbox.h), aspectB = gj.bbox.w / Math.max(1, gj.bbox.h);
        const sizeRatio = Math.min(gi.area, gj.area) / Math.max(1, Math.max(gi.area, gj.area));
        const overlapOk = ov >= 0.35 && aspectA <= 2.2 && aspectB <= 2.2 && sizeRatio >= 0.15;
        if (aff < 0.7 && !overlapOk) continue;
        const g = bboxGap(gi.bbox, gj.bbox);
        if (g > maxGap || g >= bestGap) continue;
        const area = gi.area + gj.area;
        const cap = overlapOk ? n * (opts.overlapMaxShare ?? 0.34) : aff >= 1 ? n * (opts.sameColorMaxShare ?? 0.34) : maxArea;
        if (area > cap) continue;
        const box = bboxUnion(gi.bbox, gj.bbox);
        if (area / (box.w * box.h) < minFill) continue;
        bi = i; bj = j; bestGap = g; bestBox = box;
      }
    }
    if (bi < 0) break;
    const a = groups[bi], b = groups[bj];
    a.parts = a.parts.concat(b.parts);
    a.area += b.area;
    a.bbox = bestBox;
    groups.splice(bj, 1);
  }
  return groups;
}

/** 4 邻域边界像素数（用集合判断，不建整图掩膜）。 */
function perimeterOfSet(pixels, w, h) {
  const set = new Set(pixels);
  let per = 0;
  for (const i of pixels) {
    const x = i % w, y = (i / w) | 0;
    if (x === 0 || !set.has(i - 1)) per++;
    if (x === w - 1 || !set.has(i + 1)) per++;
    if (y === 0 || !set.has(i - w)) per++;
    if (y === h - 1 || !set.has(i + w)) per++;
  }
  return per;
}

/** 把分组算成物体：几何 + 颜色 + 角色（角色是推断出来的，不是语义识别）。 */
export function buildObjects(img, groups, bg, edge, opts = {}) {
  const { width: w, height: h } = img;
  const n = w * h;
  const horizonY = bg.horizon ?? (bg.ground ? bg.ground.topY : Math.round(h * 0.7));
  const objects = groups.map((g) => {
    const all = [];
    for (const p of g.parts) for (const i of p.pixels) all.push(i);
    const fgPixels = all.filter((i) => !bg.mask[i]);
    const use = fgPixels.length >= 8 ? fgPixels : all;
    const stats = pixelStats(use, img);
    const bbox = g.bbox;
    const area = use.length;
    const per = perimeterOfSet(use, w, h);
    const cx = (bbox.x + bbox.w / 2) / w;
    const cy = (bbox.y + bbox.h / 2) / h;
    const bottom = (bbox.y + bbox.h) / h;
    const aspect = bbox.h > 0 ? bbox.w / bbox.h : 1;
    const contrast = Math.abs(stats.luma - bg.luma);
    const fill = area / (bbox.w * bbox.h);
    const edgeDensity = densityOf(use, edge.edge);
    const distCenter = Math.hypot(cx - 0.5, cy - 0.5) / 0.7071;
    const saliency = Math.pow(area / n, 0.55) * (0.45 + contrast * 1.4) * (1 - 0.45 * distCenter) * (0.6 + 0.4 * Math.min(1, edgeDensity * 3));
    return {
      index: 0,
      area,
      areaShare: +(area / n).toFixed(4),
      bbox,
      cx: +cx.toFixed(4), cy: +cy.toFixed(4), bottom: +bottom.toFixed(4),
      aspect: +aspect.toFixed(3),
      fill: +fill.toFixed(3),
      compactness: per > 0 ? +((4 * Math.PI * area) / (per * per)).toFixed(3) : 0,
      symmetry: +symmetryOf(use, bbox, w).toFixed(3),
      edgeDensity: +edgeDensity.toFixed(3),
      contrast: +contrast.toFixed(3),
      saliency: +saliency.toFixed(4),
      meanRgb: stats.color.rgb ? { r: stats.color.rgb[0], g: stats.color.rgb[1], b: stats.color.rgb[2] } : { r: 0, g: 0, b: 0 },
      meanColor: stats.color,
      palette: paletteOfPixels(use, img, 4),
      touches: {
        top: bbox.y <= 1,
        bottom: bbox.y + bbox.h >= h - 1,
        left: bbox.x <= 1,
        right: bbox.x + bbox.w >= w - 1,
      },
      onGround: (bbox.y + bbox.h) >= horizonY - h * 0.12,
      partCount: g.parts.length,
      partIds: g.parts.map((p) => p.id),
      role: "prop",
      isFocal: false,
      layer: "midground",
      pixels: use,
    };
  });
  objects.sort((a, b) => b.area - a.area);
  objects.forEach((o, i) => { o.index = i; });
  assignObjectRoles(objects, { w, h, bg, horizonY });
  assignDepth(objects, h);
  return objects;
}

/**
 * 角色推断：只看几何与颜色。
 *   text       矮、横向成排、内部边缘密（多行字被闭运算连成一条带）
 *   silhouette 宽扁的大块（山脊、水面、地平线后的远景）
 *   character  竖长、靠近中线、落在地平线附近或以下
 *   accent     小而鲜艳/极亮、和背景对比强（光球、火花、宝石）
 *   prop       其余前景主体
 */
function assignObjectRoles(objects, ctx) {
  const { w, h, bg, horizonY } = ctx;
  for (const o of objects) {
    const ar = o.areaShare;
    const bias = Math.abs(o.cx - 0.5);
    if (o.aspect >= 1.8 && ar < 0.03 && o.edgeDensity >= 0.1 && o.bbox.h <= h * 0.16) o.role = "text";
    else if (ar >= 0.03 && o.bbox.w >= o.bbox.h * 1.6) o.role = "silhouette";
    else if (o.bbox.h >= o.bbox.w * 1.15 && bias <= 0.32 && ar >= 0.002 && o.onGround) o.role = "character";
    else if (ar < 0.012 && (o.meanColor.sat > 0.45 || o.meanColor.val > 0.8) && o.contrast > 0.28) o.role = "accent";
    else o.role = "prop";
  }
  const chars = objects.filter((o) => o.role === "character");
  const pool = chars.length ? chars : objects.filter((o) => o.role !== "text" && o.role !== "silhouette");
  let focal = null;
  for (const o of pool) if (!focal || o.saliency > focal.saliency) focal = o;
  if (focal) focal.isFocal = true;
}

/** 对外输出时去掉像素数组，只留描述。 */
function publicPart(p) {
  return {
    id: p.id,
    regionId: p.regionId,
    area: p.area,
    bbox: p.bbox,
    fill: p.fill,
    edgeDensity: p.edgeDensity,
    meanColor: describeColor(p.meanRgb.r, p.meanRgb.g, p.meanRgb.b),
    bgShare: p.bgShare,
  };
}
/* ------------------------------------------------------------ 构图指标 */

export function measureComposition(img, seg, bg, elements, edge, opts = {}) {
  const { width: w, height: h } = img;
  const n = w * h;
  const luma = lumaOf(img);
  let fgPixels = 0;
  for (let i = 0; i < n; i++) if (!bg.mask[i]) fgPixels++;
  const fgShare = fgPixels / n;

  // 三分法：元素中心落在三分线交点附近（±9%）就算命中
  const thirdsX = [1 / 3, 2 / 3], thirdsY = [1 / 3, 2 / 3];
  const hitThirds = elements.filter((e) => thirdsX.some((tx) => Math.abs(e.cx - tx) < 0.09) && thirdsY.some((ty) => Math.abs(e.cy - ty) < 0.09));
  const hitThirdsPartial = elements.filter((e) => (thirdsX.some((tx) => Math.abs(e.cx - tx) < 0.09) && !thirdsY.some((ty) => Math.abs(e.cy - ty) < 0.09)) || (!thirdsX.some((tx) => Math.abs(e.cx - tx) < 0.09) && thirdsY.some((ty) => Math.abs(e.cy - ty) < 0.09)));

  // 左右 / 上下平衡（按亮度加权的前景质心）
  let sx = 0, sy = 0, sw = 0;
  for (const e of elements) {
    const weight = e.area * (0.4 + e.contrast);
    sx += e.cx * weight; sy += e.cy * weight; sw += weight;
  }
  const centroid = sw > 0 ? { x: sx / sw, y: sy / sw } : { x: 0.5, y: 0.5 };

  // 对称：镜像亮度的相关性
  let num = 0, den1 = 0, den2 = 0;
  const step = Math.max(1, Math.floor(n / 250000));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x, j = y * w + (w - 1 - x);
      const a = luma[i], b = luma[j];
      num += a * b; den1 += a * a; den2 += b * b;
    }
  }
  const symmetry = den1 > 0 && den2 > 0 ? num / Math.sqrt(den1 * den2) : 0;

  // 三分格密度
  const cells = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const e of elements) {
    const gx = Math.min(2, Math.floor(e.cx * 3)), gy = Math.min(2, Math.floor(e.cy * 3));
    cells[gy * 3 + gx] += e.areaShare;
  }
  const cellSum = cells.reduce((s, v) => s + v, 0) || 1;

  // 光向：前景亮度的左右 / 上下对比
  let leftL = 0, leftN = 0, rightL = 0, rightN = 0, topL = 0, topN = 0, bottomL = 0, bottomN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bg.mask[i]) continue;
      const v = luma[i];
      if (x < w / 2) { leftL += v; leftN++; } else { rightL += v; rightN++; }
      if (y < h / 2) { topL += v; topN++; } else { bottomL += v; bottomN++; }
    }
  }
  const leftAvg = leftN ? leftL / leftN : 0, rightAvg = rightN ? rightL / rightN : 0;
  const topAvg = topN ? topL / topN : 0, bottomAvg = bottomN ? bottomL / bottomN : 0;

  // 地平线：天空/地面分界
  let horizon = null;
  if (bg.horizon != null) horizon = { y: +(bg.horizon / h).toFixed(3), kind: bg.sky && bg.ground ? "sky-ground" : "ground-line" };
  else if (bg.sky && bg.ground) horizon = { y: +(((bg.sky.bottomY + bg.ground.topY) / 2) / h).toFixed(3), kind: "sky-ground" };
  else if (bg.ground) horizon = { y: +(bg.ground.topY / h).toFixed(3), kind: "ground-line" };
  else if (bg.sky) horizon = { y: +(bg.sky.bottomY / h).toFixed(3), kind: "sky-line" };

  let edgePixels = 0;
  for (let i = 0; i < n; i++) if (edge.edge[i]) edgePixels++;
  const edgeDensity = edgePixels / n;
  const lumaArr = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20000))) lumaArr.push(luma[i]);
  lumaArr.sort((a, b) => a - b);
  const pct = (p) => lumaArr.length ? lumaArr[Math.min(lumaArr.length - 1, Math.max(0, Math.round((lumaArr.length - 1) * p)))] : 0;
  const p5 = pct(0.05), p95 = pct(0.95);

  return {
    aspect: +(w / h).toFixed(3),
    orientation: w > h * 1.15 ? "landscape" : h > w * 1.15 ? "portrait" : "square",
    fgShare: +fgShare.toFixed(4),
    negativeSpace: +(1 - fgShare).toFixed(4),
    thirdsHits: hitThirds.map((e) => e.index),
    thirdsPartial: hitThirdsPartial.map((e) => e.index),
    centroid: { x: +centroid.x.toFixed(3), y: +centroid.y.toFixed(3) },
    centerBias: +Math.hypot(centroid.x - 0.5, centroid.y - 0.5).toFixed(3),
    symmetry: +Math.max(0, symmetry).toFixed(3),
    horizon,
    densityMap: cells.map((v) => +(v / cellSum).toFixed(3)),
    light: {
      left: +leftAvg.toFixed(3), right: +rightAvg.toFixed(3),
      top: +topAvg.toFixed(3), bottom: +bottomAvg.toFixed(3),
      horizontal: +(rightAvg - leftAvg).toFixed(3),
      vertical: +(bottomAvg - topAvg).toFixed(3),
    },
    contrastRatio: +(p95 - p5).toFixed(3),
    lumaMedian: +pct(0.5).toFixed(3),
    edgeDensity: +edgeDensity.toFixed(3),
    edgeThreshold: edge.threshold,
  };
}

/* ------------------------------------------------------- 图片类型判定 */

/** 左右 / 上下边缘的平均色差：很小说明这张图是「四方连续」的贴图。 */
export function seamScore(img) {
  const { width: w, height: h } = img;
  let dx = 0, dy = 0;
  for (let y = 0; y < h; y++) {
    const o = (y * w) * 4, p = (y * w + w - 1) * 4;
    dx += (Math.abs(img.data[o] - img.data[p]) + Math.abs(img.data[o + 1] - img.data[p + 1]) + Math.abs(img.data[o + 2] - img.data[p + 2])) / 3;
  }
  for (let x = 0; x < w; x++) {
    const o = x * 4, p = ((h - 1) * w + x) * 4;
    dy += (Math.abs(img.data[o] - img.data[p]) + Math.abs(img.data[o + 1] - img.data[p + 1]) + Math.abs(img.data[o + 2] - img.data[p + 2])) / 3;
  }
  return { horizontal: +(dx / h).toFixed(2), vertical: +(dy / w).toFixed(2) };
}

/**
 * 图片类型（只回答「这是哪种参考图」，不猜内容）：
 *   framed-artwork 装裱过的画作/照片（外面有留白或画框）
 *   texture        满幅纹理、没有背景（贴图、地面、壁纸）
 *   sprite-sheet   大量的、大小相近的小元素分布在纯色背景上
 *   scene          场景图（有背景 + 前景主体）
 */
export function detectKind(img, analysis) {
  const { objects, background, edgeDensity, art } = analysis;
  const n = img.width * img.height;
  const seam = seamScore(img);
  const tileable = seam.horizontal <= 14 && seam.vertical <= 14 && Math.min(seam.horizontal, seam.vertical) <= 8;
  const areas = objects.map((o) => o.areaShare).sort((a, b) => a - b);
  const median = areas.length ? areas[areas.length >> 1] : 0;
  const small = objects.filter((o) => o.areaShare <= 0.06).length;
  const rows = countRows(objects, img.height);

  let kind = "scene";
  if (background.frame) kind = "framed-artwork";
  else if (background.areaShare < 0.06 && (tileable || edgeDensity >= 0.12)) kind = "texture";
  else if (background.areaShare >= 0.45 && objects.length >= 5 && small >= objects.length * 0.6 && median <= 0.02 && areas[areas.length - 1] <= 0.08) kind = "sprite-sheet";
  else if (tileable && background.areaShare < 0.2) kind = "texture";
  return { kind, tileable, seam, sheet: kind === "sprite-sheet" ? { rows, count: objects.length, medianArea: +median.toFixed(4) } : null, art: !!art };
}

function countRows(objects, h) {
  if (!objects.length) return 0;
  const ys = objects.map((o) => o.cy).sort((a, b) => a - b);
  const gapMin = 0.06;
  let rows = 1;
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > gapMin) rows++;
  return rows;
}

/* --------------------------------------------------------------- 主入口 */

/**
 * 分析一张参考图。
 * opts: { maxSide, colors, minAreaShare, mergeThreshold }
 */
export function analyseImage(img, opts = {}) {
  const source = { width: img.width, height: img.height };
  const art = detectPixelArt(img, opts);
  let analysis, scale;
  if (art.isPixelArt && art.scale > 1) {
    analysis = downscaleByBlock(img, art.scale);
    scale = 1 / art.scale;
  } else {
    const fit = fitLongSide(img, opts.maxSide ?? MAX_ANALYSIS_SIDE);
    analysis = fit.image;
    scale = fit.scale;
  }
  const { width: w, height: h } = analysis;
  const n = w * h;
  const luma = lumaOf(analysis);
  const edge = buildEdgeMap(analysis, luma);

  // 分割调色板：像素画用精确色，照片用 40 色 median-cut 采样
  let segPalette;
  if (art.isPixelArt && art.scale === 1 && art.uniqueColors <= 64) {
    const seen = new Map();
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (analysis.data[o + 3] < TRANSPARENT_ALPHA) continue;
      const key = (analysis.data[o] << 16) | (analysis.data[o + 1] << 8) | analysis.data[o + 2];
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    segPalette = [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 64)
      .map(([key]) => ({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, w: 1 }));
  } else {
    const stride = Math.max(1, Math.floor(n / 24000));
    const samples = [];
    for (let i = 0; i < n; i += stride) {
      const o = i * 4;
      if (analysis.data[o + 3] < TRANSPARENT_ALPHA) continue;
      samples.push({ r: analysis.data[o], g: analysis.data[o + 1], b: analysis.data[o + 2], w: 1 });
    }
    segPalette = medianCut(samples, opts.segColors ?? 40);
  }
  const indexMap = buildIndexMap(analysis, segPalette);
  const seg = segmentRegions(analysis, indexMap, edge, { mergeThreshold: opts.mergeThreshold ?? 13, maxRegions: 320, debug: !!opts.debug });
  const bg = classifyBackground(analysis, seg, edge, opts);
  const parts = collectParts(analysis, seg, bg, edge, opts);
  const groups = attachDetails(groupParts(parts, w, h, opts), w, h, opts);
  const objects = buildObjects(analysis, groups, bg, edge, opts);
  const composition = measureComposition(analysis, seg, bg, objects, edge, opts);

  // 前景像素数：直接按背景掩膜数，不受物体分组影响
  let fgPixels = 0;
  for (let i = 0; i < n; i++) if (!bg.mask[i]) fgPixels++;

  // 报告用调色板：物体主色打底（比逐区域更贴近“这图在讲什么”）
  const palette = [];
  const partSamples = parts.filter((p) => p.area >= n * 0.0008);
  if (art.isPixelArt) {
    for (const p of [...partSamples].sort((a, b) => b.area - a.area).slice(0, 12)) {
      palette.push({ ...describeColor(p.meanRgb.r, p.meanRgb.g, p.meanRgb.b), share: +(p.area / n).toFixed(4), from: "region" });
    }
  } else {
    const samples = partSamples.map((p) => ({ r: p.meanRgb.r, g: p.meanRgb.g, b: p.meanRgb.b, w: p.area }));
    const cut = medianCut(samples.length >= 4 ? samples : [{ r: 128, g: 128, b: 128, w: 1 }], opts.colors ?? 12);
    const totalW = cut.reduce((s, c) => s + c.w, 0) || 1;
    for (const c of cut) palette.push({ ...describeColor(c.r, c.g, c.b), share: +(c.w / totalW).toFixed(3), from: "cluster" });
  }
  if (bg.color) palette.push({ ...bg.color, share: +bg.areaShare.toFixed(3), from: "background" });

  // 色卡去重：median-cut 偶尔会切出两个几乎一样的颜色（距离 < 10），并进前一个，别占两格
  const merged = [];
  for (const p of palette) {
    const dup = merged.find((q) => colorDist(q.rgb[0], q.rgb[1], q.rgb[2], p.rgb[0], p.rgb[1], p.rgb[2]) < 10 && q.from === p.from);
    if (dup) dup.share = +(dup.share + p.share).toFixed(4);
    else merged.push(p);
  }
  palette.length = 0;
  palette.push(...merged.sort((a, b) => (a.from === "background") - (b.from === "background") || b.share - a.share));

  // 图片类型：装裱照片 / 贴图 / 精灵表 / 场景；精灵表把小的东西叫 sprite 而不是 text
  const kindInfo = detectKind(analysis, { objects, background: bg, edgeDensity: composition.edgeDensity, art: !!art.isPixelArt });
  if (kindInfo.kind === "sprite-sheet") {
    for (const o of objects) if (o.areaShare <= 0.06) o.role = "sprite";
  }

  let satSum = 0, valSum = 0;
  for (const o of objects) { satSum += o.meanColor.sat; valSum += o.meanColor.val; }

  return {
    source,
    analysis: { width: w, height: h },
    scale,
    art,
    edge,
    luma,
    analysisImage: analysis,
    palette,
    regions: seg.regions.length,
    kind: kindInfo.kind,
    tileable: kindInfo.tileable,
    seam: kindInfo.seam,
    sheet: kindInfo.sheet,
    background: bg,
    parts: parts.map(publicPart),
    elements: objects.map(publicObject),
    composition,
    foreground: { share: +(fgPixels / n).toFixed(4), pixels: fgPixels },
    stats: {
      objects: objects.length,
      parts: parts.length,
      meanSaturation: objects.length ? +(satSum / objects.length).toFixed(3) : 0,
      meanValue: objects.length ? +(valSum / objects.length).toFixed(3) : 0,
    },
  };
}

/** 对外输出时去掉物体内部用的像素数组。 */
function publicObject(o) {
  const { pixels, ...rest } = o;
  return rest;
}
