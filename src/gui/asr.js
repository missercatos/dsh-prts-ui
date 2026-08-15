/**
 * PRTS voice input — mic capture, voice-activity detection and speech
 * recognition. The analyser drives the PRTS-icon line-wave effect from the
 * microphone's real-time level and spectrum. When enabled, recognition
 * auto-starts on sustained human voice and finalizes on silence.
 *
 * Backend: the standard web SpeechRecognition API when present. A community
 * plugin may override it by registering `area: 'asr'` with an `engine`
 * exposing `{ start(), stop(), setLang(lang) }` and `onresult`/`onend`
 * callbacks, mirroring the native object. Without a backend, VAD + the
 * waveform still work; recognition just reports unsupported.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const A = P.asr = {
    state: 'idle',            // idle | listening | speaking | recognizing
    listening: false,
    speaking: false,
    supported: false,
  };

  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let micSource = null;
  let freqData = null;
  let timeData = null;
  let raf = 0;
  let rec = null;
  let recActive = false;
  let pluginEngine = null;

  let onFrame = null;
  let onResult = null;
  let locale = 'en';

  const VAD = {
    speakThreshold: 0.018,   // linear RMS ≈ -35 dBFS
    speakHoldMs: 140,        // sustained speech before 'speaking'
    silenceMs: 750,          // silence before finalizing
    speechBandRatio: 0.22,   // mid-band energy fraction for "voice-like"
    speakSince: 0,
    silenceSince: 0,
    frames: 0,
  };

  function engine() {
    if (pluginEngine) return pluginEngine;
    return (typeof G.SpeechRecognition !== 'undefined' && G.SpeechRecognition) ||
      (typeof G.webkitSpeechRecognition !== 'undefined' && G.webkitSpeechRecognition) || null;
  }

  function adoptPluginEngine() {
    const list = P.plugins ? P.plugins.list('asr') : [];
    const p = list.find((x) => x.engine);
    pluginEngine = p ? p.engine : null;
  }

  /** dB of the current input (≈ -90 … 0). */
  function levelDb() {
    if (!analyser || !timeData) return -90;
    analyser.getByteTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / timeData.length);
    return 20 * Math.log10(rms + 1e-9);
  }

  /** Spectral stats: dominant frequency and voice-band energy ratio. */
  function spectrum() {
    if (!analyser || !freqData) return { dominant: 0, voiceRatio: 0 };
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    const binHz = (analyser.context.sampleRate || 48000) / 2 / n;
    let dominant = 0, domAmp = 0;
    let mid = 0, total = 0;
    for (let i = 0; i < n; i++) {
      const f = i * binHz;
      const a = freqData[i] / 255;
      total += a;
      if (f >= 120 && f <= 4000) mid += a;
      if (a > domAmp) { domAmp = a; dominant = f; }
    }
    return { dominant, voiceRatio: total > 0 ? mid / total : 0 };
  }

  /** Logarithmically-spaced bar heights (0…1) for the waveform effect. */
  function bars(count) {
    count = count || 14;
    if (!analyser || !freqData) return new Array(count).fill(0);
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    const out = [];
    for (let b = 0; b < count; b++) {
      const lo = Math.floor(Math.pow(b / count, 1.6) * n);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((b + 1) / count, 1.6) * n));
      let m = 0;
      for (let i = lo; i < hi && i < n; i++) m = Math.max(m, freqData[i] / 255);
      out.push(m);
    }
    return out;
  }

  function tick() {
    if (!A.listening) return;
    const db = levelDb();
    const sp = spectrum();
    const rms = Math.pow(10, db / 20);
    const now = performance.now();

    const voice = rms > VAD.speakThreshold && sp.voiceRatio > VAD.speechBandRatio;
    if (voice) {
      if (!VAD.speakSince) VAD.speakSince = now;
      VAD.silenceSince = 0;
      if (now - VAD.speakSince >= VAD.speakHoldMs) {
        A.speaking = true;
        if (A.state !== 'recognizing') A.state = 'speaking';
      }
    } else {
      VAD.speakSince = 0;
      if (A.speaking) {
        if (!VAD.silenceSince) VAD.silenceSince = now;
        if (now - VAD.silenceSince >= VAD.silenceMs) {
          A.speaking = false;
          if (A.state !== 'recognizing') A.state = 'listening';
        }
      }
    }
    VAD.frames++;

    // Auto-start recognition on sustained voice.
    if (A.speaking && A.state === 'speaking' && !recActive && rec) {
      startRecognition();
    }
    // Auto-finalize after silence while recognizing.
    if (recActive && A.state === 'recognizing' && !A.speaking && VAD.silenceSince && now - VAD.silenceSince >= VAD.silenceMs) {
      finalizeRecognition();
    }

    if (onFrame) {
      onFrame({ db, dominant: sp.dominant, voiceRatio: sp.voiceRatio, bars: bars(), speaking: A.speaking, listening: A.listening, state: A.state });
    }
    raf = requestAnimationFrame(tick);
  }

  /* ---------- recognition ---------- */
  function startRecognition() {
    if (recActive) return;
    try {
      recActive = true;
      A.state = 'recognizing';
      rec.lang = locale === 'zh' ? 'zh-CN' : 'en-US';
      if (rec.onresult !== undefined) rec.onresult = handleResult;
      if (rec.onend !== undefined) rec.onend = handleEnd;
      if (rec.onerror !== undefined) rec.onerror = handleError;
      rec.start();
    } catch (e) {
      recActive = false;
      A.state = A.speaking ? 'speaking' : 'listening';
    }
  }
  function handleResult(ev) {
    let text = '';
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) text += r[0].transcript;
    }
    if (text && onResult) onResult(text.trim());
  }
  function handleEnd() {
    recActive = false;
    if (A.listening) A.state = A.speaking ? 'speaking' : 'listening';
  }
  function handleError(ev) {
    recActive = false;
    A.state = A.speaking ? 'speaking' : 'listening';
    if (onErrorCb) onErrorCb(ev && ev.error);
  }
  let onErrorCb = null;
  function finalizeRecognition() {
    if (!recActive) return;
    try { rec.stop(); } catch (e) { /* already stopped */ }
    handleEnd();
  }

  /* ---------- lifecycle ---------- */
  function buildGraph() {
    audioCtx = new (G.AudioContext || G.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
    micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(analyser);
  }

  A.setLocale = function (l) { locale = l === 'zh' ? 'zh' : 'en'; };

  A.onFrame = function (fn) { onFrame = fn; };
  A.onResult = function (fn) { onResult = fn; };
  A.onError = function (fn) { onErrorCb = fn; };

  A.start = async function () {
    if (A.listening) return 'ok';
    adoptPluginEngine();
    A.supported = !!engine();
    if (!G.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (onErrorCb) onErrorCb('unsupported');
      return 'unsupported';
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      if (onErrorCb) onErrorCb('not-allowed');
      return 'not-allowed';
    }
    try {
      buildGraph();
    } catch (e) {
      stop();
      if (onErrorCb) onErrorCb('unsupported');
      return 'unsupported';
    }
    A.listening = true;
    A.state = 'listening';
    VAD.speakSince = 0; VAD.silenceSince = 0; A.speaking = false;
    if (engine()) {
      const Ctor = engine();
      try { rec = new Ctor(); } catch (e) { rec = null; }
    }
    raf = requestAnimationFrame(tick);
    return 'ok';
  };

  A.stop = function () {
    if (!A.listening) return;
    if (recActive) { try { rec.stop(); } catch (e) { /* noop */ } }
    recActive = false;
    rec = null;
    A.listening = false;
    A.speaking = false;
    A.state = 'idle';
    cancelAnimationFrame(raf);
    try { if (micSource) micSource.disconnect(); } catch (e) { /* noop */ }
    try { if (micStream) micStream.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ }
    try { if (audioCtx && audioCtx.state !== 'closed') audioCtx.close(); } catch (e) { /* noop */ }
    micSource = null; micStream = null; audioCtx = null; analyser = null;
    if (onFrame) onFrame({ db: -90, dominant: 0, voiceRatio: 0, bars: [], speaking: false, listening: false, state: 'idle' });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
