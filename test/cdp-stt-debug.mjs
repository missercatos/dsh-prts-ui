#!/usr/bin/env node
/** Stepwise STT debug: logs each pipeline stage to see where it stalls. */
import { readFileSync } from 'node:fs'
const PORT = process.env.CDP_PORT || '9230'
const b64 = readFileSync('/tmp/speech16k.b64', 'utf8').trim()
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
const page = list.find((t) => t.type === 'page') || list[0]
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
    return
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value !== undefined ? a.value : (a.description || '')).join(' ')
    console.log('RENDERER:', text)
  }
}
await new Promise((r) => ws.onopen = r)
await call('Runtime.enable')
const t0 = Date.now()
const r = await call('Runtime.evaluate', {
  expression: `(async () => {
    const log = (...a) => console.log('[stt]', ...a);
    try {
      log('stage: decode wav');
      const bin = atob(${JSON.stringify(b64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ac = new AudioContext();
      const buf = await ac.decodeAudioData(bytes.buffer);
      const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
      const src = off.createBufferSource();
      src.buffer = buf; src.connect(off.destination); src.start();
      const rendered = await off.startRendering();
      const pcm = rendered.getChannelData(0);
      log('stage: pcm ready', pcm.length, 'samples');
      log('stage: loading pipeline (model download on first run)');
      const pipe = await window.PRTS.stt.getPipe();
      log('stage: pipeline ready, running');
      const out = await pipe(pcm, { language: 'en', task: 'transcribe', chunk_length_s: 30, return_timestamps: false });
      const text = Array.isArray(out) ? out.map(o => o.text || '').join(' ') : (out.text || '');
      log('stage: done ->', text);
      return { text };
    } catch (e) {
      log('stage: ERROR ->', e && e.message, e && e.stack ? e.stack.split('\\n')[1] : '');
      return { err: e && e.message };
    }
  })()`,
  awaitPromise: true,
  returnByValue: true,
})
console.log('RESULT', JSON.stringify(r.result && r.result.value), ((Date.now() - t0) / 1000).toFixed(1) + 's')
ws.close(); process.exit(0)
