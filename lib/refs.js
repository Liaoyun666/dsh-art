// lib/refs.js — the second data source: a self-hosted art reference library
// (8.5k public-domain / CC / fan-art reference images, served by a tiny
// read-only JSON API). 地址不写死在代码里：config.refBase → DSH_REF_BASE → 占位地址。 Kept in its own module so the local
// prompt library (catalog.js) and the remote library never get tangled: catalog.js
// is pure and synchronous, this file is I/O and must degrade gracefully when the
// host is unreachable.
//
// Everything here talks plain node: builtins only — fetch, node:fs, node:path —
// because the plugin is loaded from a workspace path with no node_modules.

import { createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * 自建素材库的缺省地址——**占位值**，公开仓库里不放任何人的真实服务器。
 * 真实地址按优先级取：插件配置 config.refBase → 环境变量 DSH_REF_BASE → 这个占位。
 */
export const DEFAULT_REF_BASE =
  (process.env.DSH_REF_BASE ?? '').trim().replace(/\/+$/, '') || 'http://127.0.0.1:8080'

/** How long one API call may take before we call it unreachable. */
export const DEFAULT_TIMEOUT_MS = 20000

/** Hard caps so a tool result can never flood the context. */
export const MAX_SEARCH_LIMIT = 60
export const MAX_RANDOM_COUNT = 12
export const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024

const VARIANTS = ['thumb', 'small', 'large', 'orig']

/** Where downloaded reference images land when the caller does not say. */
export function defaultCacheDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim()
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'cache', 'anim-pack-refs')
}

export function normalizeRefConfig(raw, fallback) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const pick = (key) => (typeof input[key] === 'string' ? input[key].trim() : '')
  const base = (pick('refBase') || (fallback && fallback.base) || DEFAULT_REF_BASE).replace(/\/+$/, '')
  const cacheDir = pick('refCacheDir') || (fallback && fallback.cacheDir) || defaultCacheDir()
  const rawTimeout = Number(input.refTimeoutMs)
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(180000, Math.max(2000, Math.round(rawTimeout)))
    : ((fallback && fallback.timeoutMs) || DEFAULT_TIMEOUT_MS)
  return { base, cacheDir, timeoutMs }
}

/** Build an absolute API URL. Accepts a bare base and a path; never throws on odd input. */
export function refUrl(base, pathname, query) {
  const root = String(base || DEFAULT_REF_BASE).replace(/\/+$/, '')
  const path = '/' + String(pathname || '').replace(/^\/+/, '')
  let url
  try {
    url = new URL(root + path)
  } catch {
    url = new URL(DEFAULT_REF_BASE + path)
  }
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '' ) continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Turn whatever came back into a one-line, human explanation. */
function networkHint(cfg, error) {
  const code = error && (error.cause?.code || error.code)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败'
  if (code === 'ECONNREFUSED') return '连接被拒绝（API 进程没起？）'
  if (code === 'ETIMEDOUT' || (error && error.name === 'TimeoutError')) return '连接超时'
  if (error && error.name === 'AbortError') return '请求超时'
  return String((error && error.message) || error || '未知错误')
}

async function request(cfg, pathname, query) {
  const url = refUrl(cfg.base, pathname, query)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  let response
  try {
    response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
  } catch (error) {
    clearTimeout(timer)
    const kind = networkHint(cfg, error)
    const failure = new Error('连不上美术素材库 \u0060' + cfg.base + '\u0060（' + kind + '）。离线也可以照常用本地 341 条代码动画提示词。')
    failure.network = true // 真的没连上；服务器回了错误码是另一回事
    throw failure
  }
  clearTimeout(timer)
  if (!response.ok) {
    let body = ''
    try {
      body = await response.text()
    } catch {
      /* ignore */
    }
    let detail = body ? body.slice(0, 160) : ''
    let parsed = null
    try {
      parsed = body ? JSON.parse(body) : null
    } catch {
      parsed = null
    }
    if (parsed && (parsed.error || parsed.message)) detail = String(parsed.error || parsed.message)
    const failure = new Error('美术素材库返回 HTTP ' + response.status + (detail ? '：' + detail : '') + '（' + url + '）')
    failure.status = response.status
    failure.network = false
    throw failure
  }
  return response.json()
}

export async function refStats(cfg) {
  return request(cfg, '/api/refs/stats')
}

export async function searchRefs(cfg, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  const query = String(opts.query ?? opts.q ?? '').trim()
  return request(cfg, '/api/refs/search', {
    q: query,
    cat: Array.isArray(opts.category) ? opts.category.join(',') : (opts.category || ''),
    src: Array.isArray(opts.source) ? opts.source.join(',') : (opts.source || ''),
    kind: opts.kind || '',
    cluster: opts.cluster === 0 || opts.cluster ? String(opts.cluster) : '',
    sort: opts.sort || '',
    limit: clampInt(opts.limit, 16, 1, MAX_SEARCH_LIMIT),
    offset: clampInt(opts.offset, 0, 0, 1000000),
  })
}

export async function refItem(cfg, id) {
  const itemId = String(id || '').trim()
  if (!itemId) throw new Error('没有给出素材 id')
  let data
  try {
    data = await request(cfg, '/api/refs/item', { id: itemId })
  } catch (error) {
    // 404 不是故障：这条 id 库里确实没有，说清楚该去哪儿找替代
    if (error && error.status === 404) {
      throw new Error('素材库里没有 id 为 ' + itemId + ' 的素材；可以先 anim_ref_search 搜关键词，或 anim_ref_sources 看有哪些分类。')
    }
    throw error
  }
  if (!data || !data.item) throw new Error('素材库里没有 id 为 ' + itemId + ' 的素材')
  return data
}

export async function randomRefs(cfg, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  return request(cfg, '/api/refs/random', {
    cat: Array.isArray(opts.category) ? opts.category.join(',') : (opts.category || ''),
    src: Array.isArray(opts.source) ? opts.source.join(',') : (opts.source || ''),
    kind: opts.kind || '',
    cluster: opts.cluster === 0 || opts.cluster ? String(opts.cluster) : '',
    n: clampInt(opts.count ?? opts.n, 3, 1, MAX_RANDOM_COUNT),
  })
}

/** Filesystem-safe download name: <id>__<slug>__<variant>.<ext> — 可分辨、可重现。 */
export function refFileName(item, variant, url) {
  const id = String((item && item.id) || 'item').replace(/[^0-9A-Za-z._-]+/g, '-')
  const title = String((item && item.title) || '').toLowerCase()
  const slug = title
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  let ext = ''
  try {
    ext = extname(new URL(url).pathname)
  } catch {
    ext = ''
  }
  if (!ext) ext = variant === 'orig' ? '.jpg' : '.webp'
  const parts = [id]
  if (slug) parts.push(slug)
  parts.push(variant || 'orig')
  return parts.join('__').slice(0, 120) + ext
}

/**
 * Download one variant of an item into a directory and return the local path.
 * The path is what a looking tool (read_image) or an importer needs, so this is
 * how "参考图" becomes "真的能看见的图" inside the agent loop.
 */
export async function downloadRef(cfg, item, options) {
  const opts = options !== null && typeof options === 'object' ? options : {}
  if (!item || !item.urls) throw new Error('素材缺图片地址')
  const wanted = VARIANTS.includes(opts.variant) ? opts.variant : 'orig'
  const url = item.urls[wanted] || item.urls.orig || item.urls.large || item.urls.small || item.urls.thumb
  if (!url) throw new Error('这条素材没有任何图片地址')
  const dir = resolve(opts.dir || cfg.cacheDir)
  await mkdir(dir, { recursive: true })
  const target = join(dir, refFileName(item, wanted, url))

  try {
    const existing = await stat(target)
    if (existing.isFile() && existing.size > 0) {
      return { ok: true, cached: true, path: target, bytes: existing.size, variant: wanted, url }
    }
  } catch {
    /* not cached yet */
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(cfg.timeoutMs, 30000))
  let response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch (error) {
    clearTimeout(timer)
    throw new Error('下载图片失败（' + networkHint(cfg, error) + '）：' + url)
  }
  if (!response.ok || !response.body) {
    clearTimeout(timer)
    throw new Error('下载图片失败 HTTP ' + response.status + '：' + url)
  }
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_DOWNLOAD_BYTES) {
    clearTimeout(timer)
    throw new Error('图片过大（' + Math.round(declared / 1048576) + 'MB），超过 40MB 上限：' + url)
  }
  const partial = target + '.part'
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
    const info = await stat(partial)
    const { rename } = await import('node:fs/promises')
    await rename(partial, target)
    clearTimeout(timer)
    return { ok: true, cached: false, path: target, bytes: info.size, variant: wanted, url }
  } catch (error) {
    clearTimeout(timer)
    try {
      await unlink(partial)
    } catch {
      /* ignore */
    }
    throw new Error('下载图片失败（' + networkHint(cfg, error) + '）：' + url)
  }
}

function humanBytes(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + 'GB'
  if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB'
  if (n >= 1024) return Math.round(n / 1024) + 'KB'
  return n + 'B'
}

/** One item rendered as the compact block the tools print. */
export function describeRef(item, extra) {
  const lines = []
  const idx = extra && extra.index ? extra.index + '. ' : ''
  lines.push(idx + (item.id || '(no id)') + ' · ' + (item.title || '（无标题）'))
  const meta = []
  if (item.creator) meta.push(item.creator)
  if (item.date) meta.push(item.date)
  if (item.categoryLabel) meta.push(item.categoryLabel)
  if (item.clusterName) meta.push(item.clusterName)
  if (meta.length > 0) lines.push('   ' + meta.join(' · '))
  const size = []
  if (item.w && item.h) size.push(item.w + '×' + item.h)
  if (item.bytes) size.push(humanBytes(item.bytes))
  if (item.sourceName) size.push(item.sourceName)
  if (item.kind) size.push(item.kind)
  if (size.length > 0) lines.push('   ' + size.join(' · '))
  if (item.license) lines.push('   授权：' + item.license)
  if (item.palette && item.palette.length > 0) lines.push('   主色：' + item.palette.slice(0, 6).join(' '))
  if (item.page) lines.push('   来源页：' + item.page)
  if (item.urls && item.urls.orig) lines.push('   原图：' + item.urls.orig)
  return lines.join('\n')
}

export { VARIANTS, humanBytes }
