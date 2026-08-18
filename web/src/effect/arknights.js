/**
 * PRTS particle EFFECT — a 1:1 port of the Arknights reference engine
 * (/home/a/arknights-particle): THREE.js point-cloud text, SPREAD mode where
 * the cursor scatters the particles away, and smooth in-place morphing
 * between models. Works in the Electron splash AND inside the dsh-web skin
 * (the same effect keeps running until the app is fully rendered).
 */
(function (G) {
  'use strict'
  if (G.__PRTS_INTRO_READY || !G.THREE) return
  G.__PRTS_INTRO_READY = true
  const THREE = G.THREE

  /* ---------- 61fps render queue ---------- */
  const RAF61 = (() => {
    const queue = []
    let rafId = NaN, lastUpdated = NaN
    function update(e) {
      if (!lastUpdated || e - lastUpdated > 1000 / 61) {
        lastUpdated = e
        for (const fn of queue) fn(e)
      }
      rafId = requestAnimationFrame(update)
    }
    requestAnimationFrame(update)
    return {
      add(fn) { if (queue.indexOf(fn) < 0) queue.push(fn) },
      remove(fn) { const i = queue.indexOf(fn); if (i >= 0) queue.splice(i, 1) },
    }
  })()

  /* ---------- stage ---------- */
  class Stage {
    constructor(canvas) {
      this.canvas = canvas
      this.scene = new THREE.Scene()
      this.camera = new THREE.PerspectiveCamera()
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true })
      this.fitViewport = () => {
        const width = canvas.clientWidth, height = canvas.clientHeight
        const rw = Math.round(width * (window.devicePixelRatio || 1))
        const rh = Math.round(height * (window.devicePixelRatio || 1))
        if (canvas.width !== rw || canvas.height !== rh) {
          this.renderer.setSize(rw, rh, false)
          this.camera.near = 110
          this.camera.far = 1000
          this.camera.aspect = width / height
          this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / 2 / 160))
          this.camera.updateProjectionMatrix()
          this.camera.position.set(0, 0, 160)
          this.camera.lookAt(0, 0, 0)
        }
      }
      this.update = () => { this.fitViewport(); this.renderer.render(this.scene, this.camera) }
      RAF61.add(this.update)
    }
    stop() { RAF61.remove(this.update) }
  }

  /* ---------- mouse (world coords, y flipped, centred) ---------- */
  const Mouse = {
    x: 0, y: 0, interactive: false,
    move(e) {
      Mouse.interactive = true
      const t = ('targetTouches' in e) ? e.targetTouches[0] : e
      Mouse.x = t.clientX - 0.5 * window.innerWidth
      Mouse.y = 0.5 * window.innerHeight - t.clientY
    },
    reset() { Mouse.interactive = false; Mouse.x = 0; Mouse.y = 0 },
  }

  /* ---------- model / particles ---------- */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t
    }
    return arr
  }
  function parseModel(data, anchor) {
    anchor = anchor || [0.5, 0.5]
    const cx = anchor[0], cy = anchor[1]
    const pts = (data.points || []).map((p) => [
      p[0] - cx * data.size.width,
      cy * data.size.height - p[1],
      0, 1, 1, 1, p[2] === undefined ? 1 : p[2],
    ])
    return {
      count: pts.length,
      size: data.size,
      points: [],
      shuffle() { this.points = shuffle(pts).flat(); return this },
      disappear() {
        this.shuffle()
        for (let k = 0; k < this.points.length; k++) {
          const m = k % 7
          if (m === 0 || m === 1) this.points[k] = this.points[k] + 100 * (Math.random() - 0.5)
          else if (m > 2 && m < 6) this.points[k] = 0.5
          else if (m === 6) this.points[k] = -0.5
        }
        return this
      },
    }
  }
  const MODEL_MODES = { FIXED: 0, GATHER: 1, SPREAD: 2 }
  class Particle {
    constructor(pointIdx, speed, point, color) {
      this.pointIdx = pointIdx
      this.point = point
      this.x = point[0]; this.y = point[1]; this.z = point[2]
      this.color = color
      this.r = color[0]; this.g = color[1]; this.b = color[2]; this.a = color[3]
      this.speed = speed
    }
  }
  /* the reference motion: reset interpolation (1/speed) + mouse force.
   * SPREAD mode pushes particles AWAY from the cursor (force -100). */
  function move(particle, model, transform, force) {
    if (!model) return
    const s = 1 / particle.speed
    if (particle.pointIdx >= model.count) {
      particle.a += (-1 - particle.a) * s
      particle.color.set([particle.r, particle.g, particle.b, particle.a])
      return
    }
    const idx = particle.pointIdx * 7
    const tx = model.points[idx], ty = model.points[idx + 1], tz = model.points[idx + 2]
    const tr = model.points[idx + 3], tg = model.points[idx + 4], tb = model.points[idx + 5], ta = model.points[idx + 6]
    const g = Mouse.interactive ? Mouse.x - particle.x : 0
    const m = Mouse.interactive ? Mouse.y - particle.y : 0
    const f = Math.sqrt(g * g + m * m)
    const v = 1 / ((1 + f) * (1 + f))
    particle.x += (transform.sc * tx + transform.x - particle.x) * s + force * g * v
    particle.y += (transform.sc * ty + transform.y - particle.y) * s + force * m * v
    particle.z += (tz - particle.z) * s
    particle.point.set([particle.x, particle.y, particle.z])
    particle.r += (tr - particle.r) * s
    particle.g += (tg - particle.g) * s
    particle.b += (tb - particle.b) * s
    particle.a += (ta - particle.a) * s
    particle.color.set([particle.r, particle.g, particle.b, particle.a])
  }
  const modeFns = {
    [MODEL_MODES.FIXED]: (e, t, i) => move(e, t, i, 0),
    [MODEL_MODES.GATHER]: (e, t, i) => move(e, t, i, 40),
    [MODEL_MODES.SPREAD]: (e, t, i) => move(e, t, i, -100),
  }

  const VERT_SHADER = `
  attribute vec4 color;
  varying vec4 vColor;
  uniform float uPointSize;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
    gl_Position = projectionMatrix * mvPosition;
  }`
  const FRAG_SHADER = `
  uniform sampler2D uTexture;
  varying vec4 vColor;
  void main() {
    gl_FragColor = vColor * texture2D(uTexture, gl_PointCoord);
  }`
  const PARTICLE_TEXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA/ElEQVQ4jaWTUWqDQBRFTyOMdCtpltV/wYWoHw10KULsLkT9EtyDHzooU+5gQlps0ObA+ODNu5fnzBtWOAIJUAPDsqold1wTXDHABzAnSeLqunbDMPhVVZVTTnvAJ/C6Jr5EUeTmeXZ/ob04jmX0tWhunCXeimqXbj1vwDRN02YD1Uoj7QF4T9M0CILg0fn8QLXSSKt8rQPbizTSvgDjOI7GGLO5A2GtJQJDiomquDSvtRnlkFs4+9mPfnI6gLGQpbPew7c7bBpQHhbcj1nftPSaxTrnA5fAxdGWMiM2OS7ASnE2z9IbrTaTfN7A2LYdG9MB2FbyAQ+nM2nOObf5euxk+6fKAcMzVb6X8D1ce6kAAAAASUVORK5CYII='

  /* ---------- APS particle system ---------- */
  class APS {
    constructor(canvas, opts) {
      opts = opts || {}
      const particleNum = opts.particleNum || 10000
      const speedRange = opts.speedRange || [20, 30]
      this.mode = MODEL_MODES.SPREAD
      this.transform = { x: 0, y: 0, sc: 1, pointSize: 3 }
      this.getUpdatedTransform = () => ({})
      this.updateTransform = () => {
        const t = this.getUpdatedTransform() || {}
        if (t.x != null) this.transform.x = t.x
        if (t.y != null) this.transform.y = t.y
        if (t.sc != null) this.transform.sc = t.sc
        if (t.pointSize != null) this.uPointSize.value = t.pointSize
      }
      this.update = () => {
        this.updateTransform()
        for (const p of this.particles) modeFns[this.mode](p, this.model, this.transform)
        this.aPosition.needsUpdate = true
        this.aColor.needsUpdate = true
      }
      const pos = new Float32Array(3 * particleNum)
      const col = new Float32Array(4 * particleNum)
      this.particles = new Array(particleNum).fill(0).map((_, n) => {
        const l = (0.5 - Math.random()) * canvas.width
        const A = (0.5 - Math.random()) * canvas.height
        pos.set([l, A, (0.5 - Math.random()) * 500], 3 * n)
        col.set([1, 1, 1, -1], 4 * n)
        return new Particle(n, speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]),
          pos.subarray(3 * n, 3 * n + 3), col.subarray(4 * n, 4 * n + 4))
      })
      this.model = { count: 0, points: [], size: { width: canvas.width, height: canvas.height } }
      this.aPosition = new THREE.BufferAttribute(pos, 3)
      this.aColor = new THREE.BufferAttribute(col, 4)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', this.aPosition)
      geo.setAttribute('color', this.aColor)
      this.uPointSize = { value: 1 }
      const tex = new THREE.TextureLoader().load(PARTICLE_TEXTURE)
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTexture: { value: tex }, uPointSize: this.uPointSize },
        vertexShader: VERT_SHADER,
        fragmentShader: FRAG_SHADER,
        transparent: true,
        depthTest: false,
      })
      this.points = new THREE.Points(geo, mat)
      RAF61.add(this.update)
    }
    setStage(s) { this.stage = s; if (this.points && s) s.scene.add(this.points); return this }
    setMode(m) { this.mode = m; return this }
    setModel(m) { this.model = m; return this }
    appear() { if (this.model && this.model.shuffle) this.model.shuffle(); return this }
    setTransform(fn) { this.getUpdatedTransform = fn; return this }
    stop() { RAF61.remove(this.update) }
  }

  /* ---------- model builders (text / PRTS mark, sampled at runtime) ---------- */
  function modelFromCanvas(draw, w, h, step) {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const o = c.getContext('2d', { willReadFrequently: true })
    draw(o, w, h)
    const d = o.getImageData(0, 0, w, h).data
    const points = []
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const a = d[(y * w + x) * 4 + 3]
        if (a > 128) points.push([x, y, a / 255])
      }
    }
    return parseModel({ points, size: { width: w, height: h } }).shuffle()
  }
  function modelText(text, sizePx) {
    const font = '700 ' + sizePx + 'px sans-serif'
    const w = Math.max(400, text.length * sizePx * 0.62 + 80)
    const h = sizePx * 2
    return modelFromCanvas((o, cw, ch) => {
      o.fillStyle = '#FAFAFA'
      o.font = font
      o.textAlign = 'center'
      o.textBaseline = 'middle'
      o.fillText(text, cw / 2, ch / 2)
    }, Math.ceil(w), Math.ceil(h), 2)
  }
  function modelMark(scale) {
    // the PRTS mark (prts.png): diamond outline, italic P/R/T/S corners,
    // "dsh" wordmark and its accent rule.
    const s = 340
    const w = Math.round(s * (scale || 1)), h = Math.round(s * (scale || 1))
    return modelFromCanvas((o, cw, ch) => {
      o.fillStyle = '#FAFAFA'
      o.strokeStyle = '#FAFAFA'
      const cx = cw / 2, cy = ch / 2, half = cw * 0.38
      o.lineWidth = Math.max(3, cw * 0.012)
      o.lineJoin = 'round'
      o.beginPath()
      o.moveTo(cx, cy - half); o.lineTo(cx + half, cy); o.lineTo(cx, cy + half); o.lineTo(cx - half, cy)
      o.closePath(); o.stroke()
      o.textAlign = 'center'; o.textBaseline = 'middle'
      const corner = Math.round(cw * 0.16)
      o.font = 'italic 700 ' + corner + 'px sans-serif'
      const off = half * 0.72
      o.fillText('P', cx - off, cy - off)
      o.fillText('R', cx + off, cy - off)
      o.fillText('T', cx - off, cy + off)
      o.fillText('S', cx + off, cy + off)
      o.font = 'italic 700 ' + Math.round(cw * 0.08) + 'px sans-serif'
      o.textBaseline = 'alphabetic'
      o.fillText('dsh', cx, cy + cw * 0.05)
      o.fillRect(cx - cw * 0.09, cy + cw * 0.08, cw * 0.18, Math.max(2, cw * 0.008))
    }, w, h, 2)
  }

  /* ---------- public intro driver ---------- */
  function create(canvas, opts) {
    opts = opts || {}
    const stage = new Stage(canvas)
    const aps = new APS(canvas, { particleNum: opts.particleNum || 10000, speedRange: opts.speedRange || [20, 30] }).setStage(stage)
    aps.setTransform(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (h >= w) return { x: 0, y: 0.15 * h, sc: 1, pointSize: 2 }
      return { x: 0, y: 0, sc: 1.1, pointSize: 2.2 }
    })
    aps.setMode(MODEL_MODES.SPREAD)
    const api = {
      showText(text, sizePx) { aps.setModel(modelText(text, sizePx)).appear(); return api },
      showMark(scale) { aps.setModel(modelMark(scale)).appear(); return api },
      stop() { aps.stop(); stage.stop() },
      onPointerMove(e) { Mouse.move(e) },
      onPointerLeave() { Mouse.reset() },
    }
    return api
  }

  G.PRTS_INTRO = { create, MODEL_MODES }
})(typeof globalThis !== 'undefined' ? globalThis : this)
