/**
 * PRTS speech engine — the recognition backend behind voice input.
 *
 * Two backends, best available wins:
 *   - web-speech: the browser's built-in SpeechRecognition (Chrome/Edge).
 *   - whisper: transformers.js + whisper-tiny quantized ONNX, downloaded on
 *     first use from CN-reachable mirrors (npmmirror for the engine files,
 *     hf-mirror for the model). Works fully offline afterwards (per-origin
 *     cache) and inside the Electron window, where web-speech is unavailable.
 *
 * Engine files resolve through the Electron bridge (`prts:sttFile`) or, when
 * the page is served from a dsh origin, the `/prts/stt/*` plugin routes.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const S = P.stt = {
    backend: 'none',        // 'web-speech' | 'whisper' | 'none'
    loading: false,
    ready: false,
  };

  let pipePromise = null;
  let transformersMod = null;

  /* ---------- engine file access ---------- */

  function fileUrlBase() {
    try {
      if (typeof window !== 'undefined' && window.location && /^https?:$/.test(window.location.protocol)) {
        return window.location.origin;
      }
    } catch (e) { /* file:// in Electron */ }
    return null;
  }

  const inElectron = () => !!(typeof window !== 'undefined' && window.prts && window.prts.bridge && window.prts.bridge.dsh)

  async function sttJsText() {
    const base = fileUrlBase();
    const url = inElectron() ? base + '/assets/transformers.min.js' : base + '/prts/stt/transformers.min.js';
    if (base) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    }
    throw new Error('no stt file source');
  }

  /** Where the ort wasm/mjs live. Both builds serve them over http(s) so the
   *  glue .mjs loads through import() and the wasm through plain fetch. */
  function wasmBase() {
    const base = fileUrlBase();
    if (!base) throw new Error('no stt file source');
    return inElectron() ? base + '/assets/' : base + '/prts/stt/assets/';
  }

  /** The whisper model id — a plain name resolved against the page origin:
   *  the Electron loopback server serves /whisper-tiny/*, and the dsh-origin
   *  plugin serves the same path for the browser build. */
  function modelBase() {
    return 'whisper-tiny';
  }

  /* ---------- whisper pipeline ---------- */

  async function loadTransformers() {
    if (transformersMod) return transformersMod;
    S.loading = true;
    try {
      const base = fileUrlBase();
      let url = null;
      if (base) {
        // Import directly from the http URL: the module's publicPath then
        // resolves correctly for the ort chunks (blob imports break it).
        url = inElectron() ? base + '/assets/transformers.min.js' : base + '/prts/stt/transformers.min.js';
        transformersMod = await import(/* webpackIgnore: true */ url);
      } else {
        const js = await sttJsText();
        url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
        transformersMod = await import(/* webpackIgnore: true */ url);
      }
      if (!transformersMod || !transformersMod.pipeline || !transformersMod.env) throw new Error('transformers module shape unexpected');
      return transformersMod;
    } finally {
      S.loading = false;
    }
  }

  async function getPipe() {
    if (!pipePromise) {
      pipePromise = (async () => {
        const mod = await loadTransformers();
        // Local-model loading: model id "whisper-tiny" + localModelPath "/"
        // resolves to "/whisper-tiny/<file>" on the page origin — served by
        // the Electron loopback server (or the /whisper-tiny plugin route).
        mod.env.allowLocalModels = true;
        mod.env.localModelPath = '/';
        mod.env.backends.onnx.wasm.wasmPaths = wasmBase();
        mod.env.backends.onnx.wasm.numThreads = 2;
        mod.env.allowRemoteModels = false;
        const pipe = await mod.pipeline('automatic-speech-recognition', modelBase(), { quantized: true });
        S.ready = true;
        return pipe;
      })();
      pipePromise.catch((e) => { console.log('[stt] pipe error', e && e.message); pipePromise = null; S.ready = false; });
    }
    return pipePromise;
  }

  /** Transcribe 16 kHz mono Float32 PCM. language: 'zh' | 'en' | undefined. */
  async function transcribe(pcm, language) {
    const pipe = await getPipe();
    const opts = { task: 'transcribe', chunk_length_s: 30, return_timestamps: false };
    if (language) opts.language = language;
    const out = await pipe(pcm, opts);
    const text = Array.isArray(out) ? out.map((o) => o && o.text || '').join(' ').trim() : ((out && out.text) || '');
    return text;
  }

  S.transcribe = transcribe;
  S.getPipe = getPipe;
})(typeof globalThis !== 'undefined' ? globalThis : this);
