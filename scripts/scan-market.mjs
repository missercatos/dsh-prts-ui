#!/usr/bin/env node
/**
 * PRTS plugin-market scanner: discovers real dsh plugins from GitHub and npm,
 * filters to genuine ones (a `dsh` field in package.json is the marker), and
 * writes web/market.json for the in-app market.
 *
 *   node scripts/scan-market.mjs
 *
 * Best-effort: rate limits and missing repos are skipped, never fatal.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pkgRoot } from '../src/root.js'

const UA = { 'User-Agent': 'dsh-prts-ui-market-scanner', Accept: 'application/vnd.github+json' }
const GITHUB_QUERIES = [
  'deepseek harness plugin',
  'dsh plugin deepseek',
  'dsh-plugin',
  'deepseek-harness in:name,description',
  'topic:dsh-plugin',
]
const NPM_QUERIES = ['keywords:dsh-plugin', 'keywords:deepseek-harness', 'scope:deepseek-ai dsh']

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
const get = async (url, headers = {}) => {
  const res = await Promise.race([fetch(url, { headers }), timeout(20000)])
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

async function githubCandidates() {
  const seen = new Set()
  const out = []
  for (const q of GITHUB_QUERIES) {
    try {
      const j = await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=12`)
      for (const it of j.items || []) {
        if (seen.has(it.full_name)) continue
        seen.add(it.full_name)
        out.push({ full_name: it.full_name, desc: it.description || '', html_url: it.html_url, stars: it.stargazers_count })
      }
    } catch (e) { /* rate-limited or down */ }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return out
}

async function isDshPluginRepo(fullName) {
  for (const branch of ['HEAD', 'main', 'master']) {
    try {
      const res = await Promise.race([fetch(`https://raw.githubusercontent.com/${fullName}/${branch}/package.json`, { headers: UA }), timeout(15000)])
      if (!res.ok) continue
      const pkg = await res.json()
      return pkg
    } catch (e) { /* next branch */ }
  }
  return null
}

async function scanGitHub() {
  const cands = await githubCandidates()
  const out = []
  for (const c of cands) {
    const pkg = await isDshPluginRepo(c.full_name)
    if (pkg && pkg.dsh && typeof pkg.dsh === 'object') {
      out.push({
        name: pkg.name || c.full_name.split('/')[1],
        displayName: (pkg.name || c.full_name).replace(/^dsh-/, ''),
        description: pkg.description || c.desc,
        source: 'github',
        repo: c.html_url,
        pkg: pkg.name || null,
      })
    }
    await new Promise((r) => setTimeout(r, 600))
  }
  return out
}

async function scanNpm() {
  const seen = new Set()
  const out = []
  for (const q of NPM_QUERIES) {
    try {
      const j = await get(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`)
      for (const obj of j.objects || []) {
        const p = obj.package
        if (!p || seen.has(p.name)) continue
        seen.add(p.name)
        const hasDshField = p.links && p.links.repository
        // npm search metadata has no package.json `dsh` field; accept names that
        // are clearly dsh-related and reachable.
        if (/dsh|deepseek[- ]harness/i.test(`${p.name} ${p.description || ''} ${(p.keywords || []).join(' ')}`)) {
          out.push({
            name: p.name,
            displayName: p.name,
            description: p.description || '',
            source: 'npm',
            pkg: p.name,
            repo: p.links && p.links.repository ? p.links.repository : null,
          })
        }
      }
    } catch (e) { /* skip */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return out
}

const gh = await scanGitHub()
const npm = await scanNpm()

// Merge, dedupe by pkg/repo, keep the known-good three first.
const KNOWN = [
  { pkg: '@liustack/modlens', name: 'ModLens', displayName: 'ModLens', source: 'npm', description: 'Vision for text-only LLMs via Antigravity CLI.' },
  { pkg: 'dsh-cost-meter', name: 'dsh-cost-meter', displayName: 'Cost Meter', source: 'npm', description: 'Per-session cost, daily totals and official price sync.' },
  { pkg: 'dsh-better-sidebar', name: 'dsh-better-sidebar', displayName: 'Better Sidebar', source: 'npm', description: 'VSCode-like sidebar (explorer / editor / terminal / git).' },
]
const map = new Map()
for (const p of [...KNOWN, ...gh, ...npm]) {
  const key = p.pkg || p.repo
  if (!key || map.has(key)) continue
  map.set(key, p)
}
const plugins = [...map.values()]

const out = { generatedAt: new Date().toISOString(), plugins }
writeFileSync(join(pkgRoot, 'web', 'market.json'), JSON.stringify(out, null, 2))
console.log(`market.json: ${plugins.length} plugins`)
for (const p of plugins) console.log(' -', p.source, p.pkg || p.repo, '::', (p.description || '').slice(0, 70))
