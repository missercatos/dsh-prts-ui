/**
 * PRTS particle engine — a dependency-free Canvas-2D port of the Arknights
 * official-site point-cloud system (10k particles, SPREAD mode, mouse
 * parallax). Models are sampled from offscreen text/logo renders. Monochrome
 * only: particles take the current theme ink color.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  function sampleFromCanvas(scratch, ctx, cw, ch, maxPoints, step) {
    ctx.drawImage(scratch, 0, 0);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const pts = [];
    for (let y = 0; y < ch; y += step) {
      for (let x = 0; x < cw; x += step) {
        const a = data[(y * cw + x) * 4 + 3];
        if (a > 128) {
          pts.push({
            x: (x / cw) * 2 - 1,
            y: -((y / ch) * 2 - 1),
            a: 0.35 + 0.65 * Math.random(),
          });
          if (pts.length >= maxPoints) return pts;
        }
      }
    }
    return pts;
  }

  function create(canvas, opts) {
    opts = opts || {};
    const N = opts.count || 3200;
    // Faster particle *motion* — the effect timeline is unaffected.
    const speedRange = (opts.speedRange || [0.018, 0.05]).map((v) => v * 1.5);
    const ctx = canvas.getContext('2d');
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d');
    const mouse = { x: 0, y: 0, active: false };
    const state = {
      running: false,
      ink: getInk(),
      scale: 1,
      drift: opts.drift !== false,
    };

    let W = 0, H = 0, CX = 0, CY = 0;
    let model = null;      // [{x,y,a}]
    let modelCenter = { x: 0, y: 0 };
    let pxMap = null;      // {cw,ch,cx0,cy0,scale} source->screen mapping
    let particles = [];
    let raf = 0;
    let t0 = 0;
    const t = () => (performance.now() - t0) / 1000;

    function getInk() {
      const s = getComputedStyle(document.documentElement);
      return s.getPropertyValue('--prts-ink').trim() || '#FAFAFA';
    }

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      CX = W / 2; CY = H / 2;
      // Fullscreen / window resize should extend the view, not zoom the
      // content: keep the model (it re-centres at a fixed size) and re-flow
      // the ambient field so the larger canvas gets filled.
      if (!model && particles.length) {
        for (const p of particles) {
          p.x = (Math.random() - 0.5) * W * 1.4;
          p.y = (Math.random() - 0.5) * H * 1.4;
        }
      }
    }

    function spawn() {
      const P0 = Math.max(N, 600);
      particles = new Array(P0).fill(0).map(() => ({
        x: (Math.random() - 0.5) * W * 1.4,
        y: (Math.random() - 0.5) * H * 1.4,
        z: 0.4 + 0.6 * Math.random(),
        a: 0,
        speed: speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]),
        target: -1,
        tx: 0, ty: 0, ta: 0,
        drift: { x: (Math.random() - 0.5) * 0.6, y: (Math.random() - 0.5) * 0.6 },
      }));
    }

    function assignTargets(m, target) {
      model = m || null;
      // Map the sampled content (source pixels) into the requested screen box,
      // preserving aspect and centring it — decoupled from the scratch canvas
      // dimensions so a wide model renders wide, a square model renders square.
      pxMap = null;
      if (model) {
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (const pt of model) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
        modelCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        const cw = scratch.width || 1, ch = scratch.height || 1;
        // Source-pixel content box (model y points up; source y grows down).
        const wPx = ((maxX - minX) / 2) * cw;
        const hPx = ((maxY - minY) / 2) * ch;
        const cx0 = ((minX + maxX + 2) / 4) * cw;
        const cy0 = ((2 - minY - maxY) / 4) * ch;
        const tw = target ? target.w : Math.min(CX, CY) * 1.4;
        const th = target ? target.h : Math.min(CX, CY) * 1.4;
        pxMap = {
          cw, ch, cx0, cy0,
          scale: Math.min(wPx > 0 ? tw / wPx : 1, hPx > 0 ? th / hPx : 1),
        };
      }
      // Re-target: each particle picks a random model point (or goes free).
      for (const p of particles) {
        if (model) {
          p.target = Math.floor(Math.random() * model.length);
          p.speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
        } else {
          p.target = -1;
          p.ta = 0.06;
        }
      }
    }

    function drawModelText(text, fontPx, maxPoints) {
      const pad = 40;
      const maxW = Math.max(64, Math.floor(W - pad * 2));
      scratch.width = maxW;
      scratch.height = Math.max(48, Math.floor(fontPx * 1.6));
      sctx.clearRect(0, 0, scratch.width, scratch.height);
      sctx.fillStyle = '#fff';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      // Shrink the font until the whole phrase fits (avoids clipping).
      let size = fontPx;
      while (size > 16) {
        sctx.font = '600 ' + size + 'px ' + getFontStack();
        if (sctx.measureText(text).width <= maxW) break;
        size -= 4;
      }
      scratch.height = Math.max(48, Math.floor(size * 1.6));
      sctx.font = '600 ' + size + 'px ' + getFontStack();
      sctx.fillText(text, scratch.width / 2, scratch.height / 2);
      return sampleFromCanvas(scratch, sctx, scratch.width, scratch.height, maxPoints, Math.max(2, Math.round(size / 44)));
    }

    function drawModelIntro(maxPoints) {
      // Two-line intro wordmark: tracked-out "welcome to" above an italic PRTS.
      // Wide and short so the phrase reads clearly at a glance.
      const cw = 760, ch = 300;
      scratch.width = cw; scratch.height = ch;
      sctx.clearRect(0, 0, cw, ch);
      sctx.fillStyle = '#fff';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.font = '600 44px ' + getFontStack();
      if ('letterSpacing' in sctx) sctx.letterSpacing = '8px';
      sctx.fillText('welcome to', cw / 2, 92);
      if ('letterSpacing' in sctx) sctx.letterSpacing = '0px';
      sctx.font = 'italic 700 148px ' + getFontStack();
      sctx.fillText('PRTS', cw / 2, 208);
      return sampleFromCanvas(scratch, sctx, cw, ch, maxPoints, 4);
    }

    function drawModelPp(maxPoints) {
      // PRTS / DeepSeek harness banner (matches pp.png): a thin top rule, a
      // large upright PRTS wordmark, a small italic DeepSeek caption, a
      // horizontal bar, and "harness" beneath it.
      const cw = 700, ch = 400;
      scratch.width = cw; scratch.height = ch;
      sctx.clearRect(0, 0, cw, ch);
      sctx.fillStyle = '#fff'; sctx.strokeStyle = '#fff';
      sctx.textAlign = 'center';
      sctx.textBaseline = 'alphabetic';
      sctx.fillRect(132, 24, 436, 6);            // top rule
      sctx.font = '700 ' + Math.floor(176) + 'px ' + getFontStack();
      sctx.fillText('PRTS', cw / 2, 196);         // large PRTS
      sctx.font = 'italic 700 ' + Math.floor(58) + 'px ' + getFontStack();
      sctx.fillText('DeepSeek', cw / 2, 262);     // caption (above the bar)
      sctx.fillRect(132, 284, 436, 7);            // bar
      sctx.fillText('harness', cw / 2, 344);      // second line (below the bar)
      return sampleFromCanvas(scratch, sctx, cw, ch, maxPoints, 4);
    }

    function drawModelMark(scale, maxPoints) {
      // Square diamond mark (the packaged icon): white rhombus outline, italic
      // P/R/T/S in the four corners, and a small italic "dsh" wordmark with an
      // accent rule beneath it (the wordmark is 0.5× the corner letters).
      const s = scale || 1;
      const cw = Math.floor(480 * s);
      const ch = cw;
      scratch.width = cw; scratch.height = ch;
      sctx.clearRect(0, 0, cw, ch);
      sctx.strokeStyle = '#fff'; sctx.fillStyle = '#fff';
      sctx.lineWidth = Math.max(2, 10 * s);
      sctx.lineJoin = 'round';
      const cx = cw / 2, cy = ch / 2;
      const half = Math.floor(222 * s);
      sctx.beginPath();
      sctx.moveTo(cx, cy - half);
      sctx.lineTo(cx + half, cy);
      sctx.lineTo(cx, cy + half);
      sctx.lineTo(cx - half, cy);
      sctx.closePath();
      sctx.stroke();
      const q = Math.floor(half * 0.44);
      const cornerPx = Math.floor(104 * s);
      sctx.font = 'italic 700 ' + cornerPx + 'px ' + getFontStack();
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      sctx.fillText('P', cx - q, cy - q);
      sctx.fillText('R', cx + q, cy - q);
      sctx.fillText('T', cx - q, cy + q);
      sctx.fillText('S', cx + q, cy + q);
      // Centre wordmark: "dsh" above its accent rule, at half the corner size.
      sctx.font = 'italic 700 ' + Math.floor(cornerPx * 0.5) + 'px ' + getFontStack();
      sctx.textBaseline = 'alphabetic';
      const wy = cy + Math.floor(30 * s);
      sctx.fillText('dsh', cx, wy);
      sctx.lineWidth = Math.max(2, 3 * s);
      sctx.beginPath();
      sctx.moveTo(cx - Math.floor(56 * s), wy + Math.floor(11 * s));
      sctx.lineTo(cx + Math.floor(56 * s), wy + Math.floor(11 * s));
      sctx.stroke();
      return sampleFromCanvas(scratch, sctx, cw, ch, maxPoints, Math.max(2, Math.round(2.6 * s)));
    }

    function getFontStack() {
      const s = getComputedStyle(document.documentElement);
      return s.getPropertyValue('--prts-font').trim() || 'sans-serif';
    }

    function step() {
      const dt = t();
      const par = mouse.active ? 0.035 : 0.012;
      const mx = (mouse.x - CX) * par;
      const my = (mouse.y - CY) * par;
      for (const p of particles) {
        let tx, ty, ta;
        if (model && p.target >= 0) {
          const pt = model[p.target];
          // Source pixel -> screen, unflipped, scaled to the target box.
          if (pxMap) {
            const sx = ((pt.x + 1) / 2) * pxMap.cw;
            const sy = ((1 - pt.y) / 2) * pxMap.ch;
            tx = CX + (sx - pxMap.cx0) * pxMap.scale + mx;
            ty = CY + (sy - pxMap.cy0) * pxMap.scale + my;
          } else {
            tx = CX + (pt.x - modelCenter.x) * CX * 0.7 + mx;
            ty = CY - (pt.y - modelCenter.y) * CY * 0.7 + my;
          }
          ta = pt.a;
        } else {
          tx = p.x + p.drift.x * 24 * dt * (state.drift ? 1 : 0) + mx * 0.6;
          ty = p.y + p.drift.y * 24 * dt * (state.drift ? 1 : 0) + my * 0.6;
          ta = 0.05;
        }
        const s = p.speed;
        p.x += (tx - p.x) * s;
        p.y += (ty - p.y) * s;
        p.a += (ta - p.a) * Math.min(1, s * 2.2);
      }
    }

    function frame() {
      if (!state.running) return;
      t0 = performance.now();
      ctx.clearRect(0, 0, W, H);
      step();
      ctx.fillStyle = state.ink;
      for (const p of particles) {
        if (p.a <= 0.008) continue;
        ctx.globalAlpha = p.a;
        const size = p.z * 1.6;
        ctx.fillRect(p.x, p.y, Math.max(1, size), Math.max(1, size));
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    const api = {
      get model() { return model; },
      scatter() { assignTargets(null); return api; },
      showText(text, fontPx, maxPoints) {
        assignTargets(drawModelText(text, fontPx, maxPoints || 8000), { w: CX * 1.4, h: CY * 0.6 });
        return api;
      },
      showIntro(maxPoints) {
        // Wide and short wordmark. Fixed cap so fullscreen extends the view
        // rather than zooming the shape; small windows shrink to fit.
        assignTargets(drawModelIntro(maxPoints || 9000), {
          w: Math.min(720, CX * 1.6),
          h: Math.min(170, CY * 0.4),
        });
        return api;
      },
      showPp(maxPoints) {
        // PRTS / DEEPSEEK banner, fixed cap.
        assignTargets(drawModelPp(maxPoints || 11000), {
          w: Math.min(880, CX * 1.8),
          h: Math.min(280, CY * 0.55),
        });
        return api;
      },
      showMark(scale, maxPoints) {
        // Square diamond mark, fixed cap.
        const side = Math.min(300, 0.65 * Math.min(CX, CY));
        assignTargets(drawModelMark(scale || 1, maxPoints || 9000), { w: side * 2, h: side * 2 });
        return api;
      },
      onMouse(x, y) {
        mouse.x = x; mouse.y = y; mouse.active = true;
      },
      clearMouse() { mouse.active = false; },
      refreshInk() { state.ink = getInk(); return api; },
      start() {
        if (state.running) return api;
        state.running = true;
        t0 = performance.now();
        resize();
        if (!particles.length) spawn();
        raf = requestAnimationFrame(frame);
        return api;
      },
      stop() {
        state.running = false;
        cancelAnimationFrame(raf);
        ctx.clearRect(0, 0, W, H);
        return api;
      },
      resize,
    };

    resize();
    spawn();
    return api;
  }

  P.particles = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
