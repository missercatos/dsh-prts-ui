#!/usr/bin/env node
/**
 * End-to-end speech-to-text test: injects a synthesized WAV into the PRTS
 * renderer, runs the whisper engine (transformers.js, model fetched from
 * hf-mirror on first use) and checks the transcription.
 */
import { readFileSync } from 'node:fs'

const PORT = process.env.CDP_PORT || '9227'
const b64 = readFileSync('/tmp/speech16k.b64', 'utf8').trim()

const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url)) || list.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
const call = (method, params) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id)
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
  }
}
await new Promise((r) => ws.onopen = r)
await call('Runtime.enable')
const t0 = Date.now()

// Inject the wav and transcribe. The first run downloads whisper-tiny from
// hf-mirror (~65 MB) — the timeout covers it.
const r = await call('Runtime.evaluate', {
  expression: `(async () => {
    const bin = atob(${JSON.stringify(b64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ac = new AudioContext();
    const buf = await ac.decodeAudioData(bytes.buffer);
    // resample to 16k mono
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    const pcm = rendered.getChannelData(0);
    const text = await window.PRTS.stt.transcribe(pcm, 'en');
    return { text };
  })()`,
  awaitPromise: true,
  returnByValue: true,
})
if (r.exceptionDetails) {
  console.log('EXCEPTION', JSON.stringify(r.exceptionDetails).slice(0, 600))
  process.exit(1)
}
console.log('TRANSCRIBED:', JSON.stringify(r.result.value))
console.log('elapsed:', ((Date.now() - t0) / 1000).toFixed(1) + 's')
const text = String((r.result.value && r.result.value.text) || '').toLowerCase()
const okText = /hello|world|test/.test(text)
console.log(okText ? 'STT OK' : 'STT UNEXPECTED OUTPUT')
ws.close()
process.exit(okText ? 0 : 1)
