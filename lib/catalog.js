// dsh-anim-pack / lib/catalog.js
//
// Pure, host-free logic over the bundled 341-style prompt library:
// load the catalog, search it, read one prompt, export a style's files.
//
// No cordis / DSH imports here on purpose: tools/verify.mjs exercises this
// file directly with plain node, so the search / show / export behaviour can
// be proven without booting the host.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'

/** Where the catalog lives inside a library root. */
export const CATALOG_REL = join('assets', 'catalog.json')

/** Clamp a requested page size into something a tool call can afford to print. */
export function clampLimit(value, fallback = 20, max = 200) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

/** Casefold once, the same way for haystack and needle (Chinese is unaffected). */
function fold(text) {
  return String(text ?? '').toLowerCase()
}

/** Everything a free-text search is allowed to look at for one entry. */
function haystack(entry) {
  return fold([
    entry.id,
    entry.name,
    entry.series,
    entry.category,
    entry.description,
    entry.fit,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
  ].join(' '))
}

/**
 * Load and normalise the catalog of one library root.
 * Entry paths stay relative in the payload and are resolved into absolute
 * `filePath` / `imagePath` fields next to them.
 */
export function loadCatalog(root) {
  const base = resolve(root)
  const catalogPath = join(base, CATALOG_REL)
  let data
  try {
    data = JSON.parse(readFileSync(catalogPath, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read catalog at ${catalogPath}: ${error?.message ?? error}`)
  }
  const entries = (Array.isArray(data.entries) ? data.entries : []).map((entry) => ({
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    filePath: entry.file ? join(base, entry.file) : '',
    imagePath: entry.image ? join(base, entry.image) : '',
  }))
  const series = Array.isArray(data.series) ? data.series : []
  return {
    root: base,
    catalogPath,
    total: Number.isFinite(data.total) ? data.total : entries.length,
    withStill: Number.isFinite(data.with_still) ? data.with_still : entries.filter((e) => e.imagePath).length,
    series,
    entries,
    byId: new Map(entries.map((entry) => [fold(entry.id), entry])),
  }
}

/** Look one style up by id, case-insensitively ("b3" finds "B3"). */
export function getEntry(catalog, id) {
  return catalog.byId.get(fold(String(id ?? '').trim())) ?? null
}

/** One-line summary used by search / random listings. */
export function summarize(entry) {
  return {
    id: entry.id,
    name: entry.name,
    series: entry.series,
    category: entry.category,
    description: entry.description,
    fit: entry.fit,
    tags: entry.tags,
    hasStill: Boolean(entry.imagePath),
  }
}

/**
 * Search entries. Every whitespace-separated term must appear somewhere in the
 * entry; an exact id or name match sorts first. An unknown series yields no
 * rows rather than an error, so a typo never breaks a turn.
 */
export function searchEntries(catalog, { query = '', series = '', limit = 20 } = {}) {
  const wanted = fold(String(series ?? '').trim()).toUpperCase()
  let rows = catalog.entries
  if (wanted) rows = rows.filter((entry) => fold(entry.series).toUpperCase() === wanted)
  const q = fold(query).trim()
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean)
    rows = rows.filter((entry) => {
      const hay = haystack(entry)
      return terms.every((term) => hay.includes(term))
    })
    rows = rows.slice().sort((a, b) => {
      const rank = (entry) => (fold(entry.id) === q ? 0 : fold(entry.name) === q ? 1 : fold(entry.id).startsWith(q) ? 2 : 3)
      return rank(a) - rank(b) || fold(a.id).localeCompare(fold(b.id))
    })
  }
  return rows.slice(0, clampLimit(limit))
}

/** A deterministic-enough random pick (no seed needed; callers just want variety). */
export function randomEntry(catalog, { series = '' } = {}) {
  const wanted = fold(String(series ?? '').trim()).toUpperCase()
  const pool = wanted ? catalog.entries.filter((entry) => fold(entry.series).toUpperCase() === wanted) : catalog.entries
  if (pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Read one entry's Markdown prompt verbatim. */
export function readPrompt(entry) {
  if (!entry?.filePath) throw new Error(`style ${entry?.id ?? '?'} has no prompt file`)
  return readFileSync(entry.filePath, 'utf8')
}

/** Absolute still path, or '' when the style is text-only (148 of 341 are). */
export function stillPath(entry) {
  if (!entry?.imagePath) return ''
  return existsSync(entry.imagePath) ? entry.imagePath : ''
}

/**
 * Copy one style's prompt (and still, when it has one) into `dir`.
 * Refuses to write inside the library itself so an export can never mutate
 * the bundled assets.
 */
export function exportEntry(catalog, entry, dir) {
  const target = resolve(dir)
  const root = catalog.root
  if (target === root || target.startsWith(root + sep)) {
    return { id: entry.id, ok: false, error: `refusing to export inside the library: ${target}` }
  }
  const files = []
  try {
    mkdirSync(target, { recursive: true })
    const promptDest = join(target, basename(entry.filePath))
    copyFileSync(entry.filePath, promptDest)
    files.push(promptDest)
    const still = stillPath(entry)
    if (still) {
      const stillDest = join(target, basename(still))
      copyFileSync(still, stillDest)
      files.push(stillDest)
    }
    return { id: entry.id, ok: true, name: entry.name, dir: target, files }
  } catch (error) {
    return { id: entry.id, ok: false, error: String(error?.message ?? error) }
  }
}
