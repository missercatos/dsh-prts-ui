#!/usr/bin/env node
/**
 * PRTS speech-engine file cache.
 *
 * The renderer's whisper backend needs three files that are not bundled:
 *   - transformers.min.js      (from @huggingface/transformers)
 *   - ort-wasm-simd.wasm       (from onnxruntime-web)
 *   - ort-wasm-simd-threaded.wasm
 *
 * This script downloads the npm tarballs from npmmirror (fallback: the
 * official registry — so it works in mainland China without GitHub), extracts
 * the requested file with a minimal tar reader (no tar binary needed) and
 * caches it under ~/.cache/prts/stt/ (PRTS_STT_CACHE overrides).
 *
 * Usage:
 *   node stt-cache.mjs ensure transformers.min.js     -> prints the file path
 *   node stt-cache.mjs ensure ort-wasm-simd.wasm      -> prints the file path
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'

const PKGS = {
  'transformers.min.js': {
    name: '@huggingface/transformers',
    version: '3.7.1',
    path: 'package/dist/transformers.min.js',
  },
  'ort-wasm-simd-threaded.jsep.wasm': {
    name: '@huggingface/transformers',
    version: '3.7.1',
    path: 'package/dist/ort-wasm-simd-threaded.jsep.wasm',
  },
  'ort-wasm-simd-threaded.jsep.mjs': {
    name: '@huggingface/transformers',
    version: '3.7.1',
    path: 'package/dist/ort-wasm-simd-threaded.jsep.mjs',
  },
  'ort.bundle.min.mjs': {
    name: 'onnxruntime-web',
    version: '1.21.0',
    path: 'package/dist/ort.bundle.min.mjs',
  },
}

const CACHE = process.env.PRTS_STT_CACHE || join(process.env.HOME || homedir(), '.cache', 'prts', 'stt')

/* Whisper-tiny model files (quantized ONNX + tokenizer/config), fetched from
 * hf-mirror with the official hub as fallback — cached locally so the voice
 * feature never depends on huggingface.co at run time. */
const MODEL_ID = 'Xenova/whisper-tiny'
const MODEL_FILES = [
  'config.json',
  'preprocessor_config.json',
  'generation_config.json',
  'tokenizer_config.json',
  'tokenizer.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'normalizer.json',
  'vocab.json',
  'merges.txt',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
]
const MODEL_DIR = () => join(CACHE, 'whisper-tiny')

function fetchBuffer(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.indexOf('https:') === 0 ? httpsGet : httpGet
    const req = mod(url, { timeout: 60000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        res.resume()
        if (redirects <= 0) return reject(new Error('too many redirects: ' + url))
        const next = new URL(res.headers.location, url).toString()
        return resolve(fetchBuffer(next, redirects - 1))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)) }
      const chunks = []
      res.on('data', (d) => chunks.push(d))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout: ' + url)))
  })
}

function tarballUrls(pkg) {
  const base = pkg.name.replace('/', '%2f')   // npm registry path-encodes the scope
  return [
    'https://registry.npmmirror.com/' + base + '/-/' + pkg.name.split('/').pop() + '-' + pkg.version + '.tgz',
    'https://registry.npmjs.org/' + base + '/-/' + pkg.name.split('/').pop() + '-' + pkg.version + '.tgz',
  ]
}

/** Minimal ustar reader: returns { name: Buffer } for regular files. */
function untar(buf) {
  const out = new Map()
  let off = 0
  while (off + 512 <= buf.length) {
    const name = buf.slice(off, off + 100).toString('utf8').replace(/\0.*$/, '')
    if (!name) {
      // Two consecutive zero blocks end the archive.
      if (buf.slice(off, off + 1024).every((b) => b === 0)) break
      off += 512
      continue
    }
    const sizeStr = buf.slice(off + 124, off + 136).toString('utf8').replace(/\0.*$/, '').trim()
    const size = parseInt(sizeStr, 8) || 0
    const type = String.fromCharCode(buf[off + 156] || 48)
    const dataStart = off + 512
    if (type === '0' || type === '\0') out.set(name, buf.slice(dataStart, dataStart + size))
    off = dataStart + Math.ceil(size / 512) * 512
  }
  return out
}

async function ensure(file) {
  const meta = PKGS[file]
  if (!meta) throw new Error('unknown stt file: ' + file)
  const dest = join(CACHE, file)
  if (existsSync(dest)) { console.log(dest); return }
  mkdirSync(CACHE, { recursive: true })
  let lastErr = null
  for (const url of tarballUrls(meta)) {
    try {
      const tarball = await fetchBuffer(url)
      const entries = untar(gunzipSync(tarball))
      const data = entries.get(meta.path)
      if (!data) throw new Error('file not found in tarball: ' + meta.path)
      const tmp = dest + '.tmp'
      await new Promise((resolve, reject) => {
        const ws = createWriteStream(tmp)
        ws.on('finish', () => ws.close(resolve))
        ws.on('error', reject)
        ws.end(data)
      })
      renameSync(tmp, dest)
      console.log(dest)
      return
    } catch (e) { lastErr = e }
  }
  throw new Error('could not fetch ' + file + ': ' + (lastErr && lastErr.message))
}

async function ensureModel() {
  const dir = MODEL_DIR()
  mkdirSync(dir, { recursive: true })
  for (const f of MODEL_FILES) {
    const name = f.split('/').pop()
    const dest = join(dir, name)
    if (existsSync(dest) && (statSync(dest).size || 0) > 100) continue
    let lastErr = null
    for (const host of ['https://hf-mirror.com', 'https://huggingface.co']) {
      try {
        const data = await fetchBuffer(host + '/' + MODEL_ID + '/resolve/main/' + f)
        const tmp = dest + '.tmp'
        await new Promise((resolve, reject) => {
          const ws = createWriteStream(tmp)
          ws.on('finish', () => ws.close(resolve))
          ws.on('error', reject)
          ws.end(data)
        })
        renameSync(tmp, dest)
        lastErr = null
        break
      } catch (e) { lastErr = e }
    }
    if (lastErr) throw new Error('model file failed ' + f + ': ' + (lastErr && lastErr.message))
  }
  console.log(dir)
}

async function ensureModelFile(name) {
  if (!MODEL_FILES.some((f) => f.split('/').pop() === name)) throw new Error('unknown model file: ' + name)
  await ensureModel()
  console.log(join(MODEL_DIR(), name))
}

const [cmd, file] = process.argv.slice(2)
if (cmd === 'ensure-model') {
  ensureModel().catch((e) => { console.error('stt-cache: ' + e.message); process.exit(1) })
} else if (cmd === 'model-file' && file) {
  ensureModelFile(file).catch((e) => { console.error('stt-cache: ' + e.message); process.exit(1) })
} else if (cmd === 'ensure' && file) {
  ensure(file).catch((e) => { console.error('stt-cache: ' + e.message); process.exit(1) })
} else {
  console.error('usage: node stt-cache.mjs <ensure <engine-file>|ensure-model|model-file <name>>')
  process.exit(2)
}
