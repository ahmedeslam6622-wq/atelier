/* Atelier — player.js
 * Replays a plan on a white canvas as if an artist were drawing it live.
 * - Incremental rendering: finished strokes live on cached layers, only the stroke in
 *   progress is drawn per frame. Scrubbing backwards re-renders from the layer cache.
 * - Guide / construction layers fade out when the plan says so, like erasing them.
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});
  const clamp = A.clamp;
  const BASE = 0.026, PER = 1 / 1900, STEP_GAP = 0.9, FADE = 1.2;
  const LAYER_ORDER = ['guide', 'construct', 'main'];

  function makeGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const g = c.getContext('2d'), id = g.createImageData(192, 192);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 232 + Math.random() * 23;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  /** Draw one stroke (optionally only the first `upto` fraction of its length). Returns the tip. */
  function paintStroke(ctx, st, W, H, upto, alphaMul) {
    const s = st.s, p = s.p, u = W / 1000;
    ctx.globalAlpha = s.a * (alphaMul == null ? 1 : alphaMul);
    ctx.strokeStyle = s.c;
    ctx.lineWidth = Math.max(0.55, s.w * u);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p[0] * W, p[1] * H);
    let tip = [p[0] * W, p[1] * H];
    if (upto == null || upto >= 1) {
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * W, p[i + 1] * H);
      tip = [p[p.length - 2] * W, p[p.length - 1] * H];
    } else {
      const target = upto * st.L;
      for (let i = 2, k = 1; i < p.length; i += 2, k++) {
        if (st.cum[k] <= target) { ctx.lineTo(p[i] * W, p[i + 1] * H); tip = [p[i] * W, p[i + 1] * H]; continue; }
        const seg = st.cum[k] - st.cum[k - 1], f = seg > 0 ? (target - st.cum[k - 1]) / seg : 0;
        const x = (p[i - 2] + (p[i] - p[i - 2]) * f) * W, y = (p[i - 1] + (p[i + 1] - p[i - 1]) * f) * H;
        ctx.lineTo(x, y); tip = [x, y];
        break;
      }
    }
    ctx.stroke();
    return tip;
  }
  A.paintStroke = paintStroke;

  function drawTool(ctx, x, y, W, mode, color) {
    const u = Math.max(0.6, W / 900);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.translate(x, y);
    ctx.rotate(-0.72);
    ctx.scale(u, u);
    ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 7 * u; ctx.shadowOffsetY = 3 * u;
    if (mode === 'paint') {
      ctx.fillStyle = color || '#444';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(10, -6, 24, -5); ctx.lineTo(24, 5); ctx.quadraticCurveTo(10, 6, 0, 0); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#c9ccd1'; ctx.fillRect(24, -5.5, 14, 11);
      ctx.fillStyle = '#8d5a34'; ctx.beginPath(); ctx.moveTo(38, -4.5); ctx.lineTo(96, -3); ctx.lineTo(96, 3); ctx.lineTo(38, 4.5); ctx.fill();
    } else {
      ctx.fillStyle = '#e9c897'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(15, -5); ctx.lineTo(15, 5); ctx.closePath(); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#35353a'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4.5, -1.7); ctx.lineTo(4.5, 1.7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffc93c'; ctx.fillRect(15, -5, 62, 10);
      ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(15, 1.5, 62, 3.5);
      ctx.fillStyle = '#c9ccd1'; ctx.fillRect(77, -5, 7, 10);
      ctx.fillStyle = '#ff8fa3'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(84, -5, 11, 10, 3) : ctx.rect(84, -5, 11, 10); ctx.fill();
    }
    ctx.restore();
  }

  A.Player = class Player {
    constructor(canvas) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.layers = {};
      for (const l of LAYER_ORDER) this.layers[l] = document.createElement('canvas');
      this.grain = makeGrain();
      this.speed = 1; this.time = 0; this.T = 0; this.playing = false;
      this.keepGuides = false; this.showTool = true;
      this.strokes = []; this.steps = []; this.fadeAt = {};
      this.drawn = 0; this.curStep = -1; this.mode = 'sketch';
      this.W = 0; this.H = 0; this.L = {};
      this.listeners = {};
      this._tick = this._tick.bind(this);
    }
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, a, b) { (this.listeners[ev] || []).forEach((f) => f(a, b)); }

    /** Build the timeline for a plan + mode. */
    load(plan, mode) {
      this.plan = plan; this.mode = mode; this.aspect = plan.aspect;
      this.steps = plan.modes[mode].steps; this.strokes = []; this.fadeAt = {};
      let t = 0;
      this.steps.forEach((step, si) => {
        step.t0 = t;
        const slow = step.id === 's1' ? 2.4 : 1;
        for (const s of step.strokes) {
          const p = s.p, cum = new Float32Array(p.length / 2);
          for (let i = 2, k = 1; i < p.length; i += 2, k++) {
            cum[k] = cum[k - 1] + Math.hypot((p[i] - p[i - 2]) * W_REF, ((p[i + 1] - p[i - 1]) * W_REF) / plan.aspect);
          }
          const L = cum[cum.length - 1], dur = (BASE + L * PER) * slow;
          this.strokes.push({ s, si, t0: t, t1: t + dur, cum, L });
          t += dur + 0.004;
        }
        step.t1 = t;
        for (const l of step.fade || []) if (this.fadeAt[l] === undefined) this.fadeAt[l] = t + 0.15;
        t += STEP_GAP;
      });
      this.T = t; this.time = 0; this.drawn = 0; this.curStep = -1; this.playing = false;
      this._resetLayers(); this._sync(true);
    }

    resize(cssW, cssH, dpr) {
      this.dpr = dpr || 1;
      this.W = Math.max(2, Math.round(cssW * this.dpr)); this.H = Math.max(2, Math.round(cssH * this.dpr));
      for (const c of [this.cv, ...LAYER_ORDER.map((l) => this.layers[l])]) { c.width = this.W; c.height = this.H; }
      this.drawn = 0; this._sync(true);
    }

    _resetLayers() {
      for (const l of LAYER_ORDER) { const c = this.layers[l]; c.getContext('2d').clearRect(0, 0, c.width, c.height); }
      this.drawn = 0;
    }
    _countAt(t) {
      let lo = 0, hi = this.strokes.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (this.strokes[m].t1 <= t) lo = m + 1; else hi = m; }
      return lo;
    }
    _stepAt(t) {
      let i = 0;
      for (let k = 0; k < this.steps.length; k++) if (this.steps[k].t0 <= t) i = k;
      return i;
    }
    _alpha(l) {
      if (l === 'main' || this.keepGuides) return 1;
      const fa = this.fadeAt[l];
      return fa === undefined ? 1 : clamp(1 - (this.time - fa) / FADE, 0, 1);
    }
    _commit(idx) {
      if (!this.W) return;
      if (idx < this.drawn) this._resetLayers();
      for (let k = this.drawn; k < idx; k++) {
        const st = this.strokes[k], c = this.layers[st.s.l];
        paintStroke(c.getContext('2d'), st, this.W, this.H, 1);
      }
      this.drawn = idx;
    }

    _sync(force) {
      if (!this.W || !this.strokes.length) { this.render(); return; }
      const idx = this._countAt(this.time);
      this._commit(idx);
      const si = this._stepAt(this.time);
      this.render();
      this.emit('tick', this.time / this.T, this.time);
      if (si !== this.curStep || force) { this.curStep = si; this.emit('step', si, this.steps[si]); }
    }

    render(withTool) {
      const ctx = this.ctx, W = this.W, H = this.H;
      if (!W) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      for (const l of LAYER_ORDER) {
        const a = this._alpha(l);
        if (a > 0.01) { ctx.globalAlpha = a; ctx.drawImage(this.layers[l], 0, 0); }
      }
      ctx.globalAlpha = 1;
      let tip = null, col = null;
      const cur = this.strokes[this.drawn];
      if (cur && this.time > cur.t0 && this.time < cur.t1) {
        tip = paintStroke(ctx, cur, W, H, (this.time - cur.t0) / (cur.t1 - cur.t0));
        col = cur.s.c;
      } else if (this.drawn > 0 && this.playing) {
        const last = this.strokes[this.drawn - 1], p = last.s.p;
        tip = [p[p.length - 2] * W, p[p.length - 1] * H]; col = last.s.c;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.5;
      ctx.fillStyle = ctx.createPattern(this.grain, 'repeat'); ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (tip && this.showTool && withTool !== false && this.playing) drawTool(ctx, tip[0], tip[1], W, this.mode, col);
    }

    /* ---- transport ---- */
    _tick(ts) {
      if (!this.playing) return;
      const dt = Math.min(0.1, (ts - this.last) / 1000);
      this.last = ts;
      this.time = Math.min(this.T, this.time + dt * this.speed);
      this._sync();
      if (this.time >= this.T) { this.playing = false; this.emit('state', false); this.emit('end'); this.render(); return; }
      this.raf = requestAnimationFrame(this._tick);
    }
    play() {
      if (!this.strokes.length) return;
      if (this.time >= this.T - 0.01) this.time = 0;
      this.playing = true; this.last = performance.now();
      cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this._tick);
      this.emit('state', true);
    }
    pause() { this.playing = false; cancelAnimationFrame(this.raf); this.emit('state', false); this.render(); }
    toggle() { this.playing ? this.pause() : this.play(); }
    seek(t) { this.time = clamp(t, 0, this.T); this._sync(); }
    seekFrac(f) { this.seek(f * this.T); }
    gotoStep(i, atEnd) {
      i = clamp(i, 0, this.steps.length - 1);
      this.seek(atEnd ? this.steps[i].t1 : this.steps[i].t0 - 0.0001 + 0.0002);
    }
    setSpeed(v) { this.speed = v; }
    setKeepGuides(v) { this.keepGuides = !!v; this._sync(); }

    /** High-resolution PNG-ready canvas of the drawing as it stands now (no pencil cursor). */
    exportCanvas(width) {
      const W = width || 2000, H = Math.round(W / this.aspect);
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      const idx = this._countAt(this.time);
      for (const l of LAYER_ORDER) {
        const a = this._alpha(l); if (a <= 0.01) continue;
        const lc = document.createElement('canvas'); lc.width = W; lc.height = H;
        const lg = lc.getContext('2d');
        for (let k = 0; k < idx; k++) if (this.strokes[k].s.l === l) paintStroke(lg, this.strokes[k], W, H, 1);
        g.globalAlpha = a; g.drawImage(lc, 0, 0);
      }
      return out;
    }

    /** Record the whole drawing as a time-lapse video. Resolves with a Blob (or null if unsupported). */
    async record(speed, onProgress) {
      if (!this.cv.captureStream || typeof MediaRecorder === 'undefined') return null;
      const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime) return null;
      const prevSpeed = this.speed;
      this.pause(); this.seek(0); this.setSpeed(speed || 4);
      const rec = new MediaRecorder(this.cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6e6 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime.split(';')[0] })); });
      const onTick = (f) => onProgress && onProgress(f);
      this.on('tick', onTick);
      rec.start(250);
      await new Promise((res) => { const h = () => res(); this.on('end', h); this.play(); });
      await new Promise((r) => setTimeout(r, 600));
      rec.stop();
      this.listeners.tick = (this.listeners.tick || []).filter((f) => f !== onTick);
      this.setSpeed(prevSpeed);
      return done;
    }
  };
  const W_REF = 1000;
})(typeof window !== 'undefined' ? window : globalThis);
