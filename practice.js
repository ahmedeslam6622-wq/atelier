/* Atelier — practice.js
 * "Draw along": the player's current step is shown as a blue ghost guide (earlier steps
 * faintly) and the student draws on top with pointer/pen/touch. "Check my step" compares
 * the student's ink with the step's strokes (tolerant overlap score) and says where the
 * guide is still uncovered.
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});
  const clamp = A.clamp;

  function boxBlur(src, w, h, r) { return A.blur(src, w, h, r); }

  A.Practice = class Practice {
    constructor(o) {
      this.paper = o.paper; this.player = o.player;
      this.ghost = o.ghost; this.inkAll = o.inkAll; this.inkStep = o.inkStep;
      this.ghost.style.zIndex = 1; this.inkAll.style.zIndex = 2; this.inkStep.style.zIndex = 3;
      this.tool = 'pen'; this.active = false; this.stack = []; this.step = 0;
      this.W = 0; this.H = 0; this.drawing = null;
      const c = this.inkStep;
      c.addEventListener('pointerdown', (e) => this._down(e));
      c.addEventListener('pointermove', (e) => this._move(e));
      const up = (e) => this._up(e);
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    }
    get all() { return [this.ghost, this.inkAll, this.inkStep]; }

    start(step) {
      this.active = true;
      this.player.cv.style.visibility = 'hidden';
      for (const c of this.all) c.hidden = false;
      this.paper.style.background = '#fff';
      this.resize(this.paper.clientWidth, this.paper.clientHeight, this.player.dpr || 1);
      this.setStep(step || 0, true);
    }
    stop() {
      this.active = false;
      this.player.cv.style.visibility = '';
      for (const c of this.all) c.hidden = true;
    }
    resize(cssW, cssH, dpr) {
      if (!this.active) return;
      const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
      if (W === this.W && H === this.H) return;
      // keep the ink when the layout changes
      const keep = [this.inkAll, this.inkStep].map((c) => {
        if (!c.width) return null;
        const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; t.getContext('2d').drawImage(c, 0, 0); return t;
      });
      this.W = W; this.H = H; this.dpr = dpr;
      for (const c of this.all) { c.width = W; c.height = H; }
      [this.inkAll, this.inkStep].forEach((c, i) => { if (keep[i]) c.getContext('2d').drawImage(keep[i], 0, 0, W, H); });
      this.stack = [];
      this.drawGhost();
    }

    setStep(i, first) {
      if (!first && i !== this.step) this.commit();
      this.step = clamp(i, 0, this.player.steps.length - 1);
      this.drawGhost();
    }
    commit() {
      this.inkAll.getContext('2d').drawImage(this.inkStep, 0, 0);
      this.inkStep.getContext('2d').clearRect(0, 0, this.W, this.H);
      this.stack = [];
    }
    drawGhost() {
      const g = this.ghost.getContext('2d'), W = this.W, H = this.H, steps = this.player.steps;
      g.clearRect(0, 0, W, H);
      if (!steps.length) return;
      const paint = this.player.mode === 'paint';
      for (let si = 0; si < this.step; si++) {
        for (const s of steps[si].strokes) if (s.l === 'main') A.paintStroke(g, { s }, W, H, 1, 0.28);
      }
      const accent = '#0a84ff';
      for (const s of steps[this.step].strokes) {
        const c = paint ? s : { p: s.p, w: Math.max(s.w, 1.6), c: accent, a: s.l === 'guide' ? 0.75 : 0.55, l: s.l };
        A.paintStroke(g, { s: c }, W, H, 1, paint ? 0.45 : 1);
      }
      g.globalAlpha = 1;
    }

    /* ---- drawing ---- */
    setTool(t) { this.tool = t; }
    _pos(e) { const r = this.inkStep.getBoundingClientRect(); return [(e.clientX - r.left) * (this.W / r.width), (e.clientY - r.top) * (this.H / r.height)]; }
    _down(e) {
      if (!this.active) return;
      e.preventDefault();
      this.inkStep.setPointerCapture(e.pointerId);
      const g = this.inkStep.getContext('2d');
      this.stack.push(g.getImageData(0, 0, this.W, this.H));
      if (this.stack.length > 25) this.stack.shift();
      const p = this._pos(e);
      this.drawing = { last: p, mid: p, id: e.pointerId };
      this._dot(g, p, e.pressure);
    }
    _style(g, pressure) {
      const u = Math.max(1, this.W / 700);
      if (this.tool === 'eraser') { g.globalCompositeOperation = 'destination-out'; g.lineWidth = 22 * u; g.globalAlpha = 1; }
      else {
        g.globalCompositeOperation = 'source-over'; g.strokeStyle = g.fillStyle = '#26262b';
        g.globalAlpha = 0.82; g.lineWidth = u * (1.2 + (pressure > 0 && pressure < 1 ? pressure : 0.5) * 1.8);
      }
      g.lineCap = g.lineJoin = 'round';
    }
    _dot(g, p, pr) {
      this._style(g, pr);
      g.beginPath(); g.arc(p[0], p[1], g.lineWidth / 2, 0, Math.PI * 2); g.fill();
    }
    _move(e) {
      const d = this.drawing;
      if (!d || e.pointerId !== d.id) return;
      e.preventDefault();
      const g = this.inkStep.getContext('2d');
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        const p = this._pos(ev), mid = [(d.last[0] + p[0]) / 2, (d.last[1] + p[1]) / 2];
        this._style(g, ev.pressure);
        g.beginPath(); g.moveTo(d.mid[0], d.mid[1]); g.quadraticCurveTo(d.last[0], d.last[1], mid[0], mid[1]); g.stroke();
        d.last = p; d.mid = mid;
      }
    }
    _up(e) {
      if (!this.drawing) return;
      const g = this.inkStep.getContext('2d');
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      this.drawing = null;
    }
    undo() { const s = this.stack.pop(); if (s) this.inkStep.getContext('2d').putImageData(s, 0, 0); return !!s; }
    clearStep() {
      const g = this.inkStep.getContext('2d');
      this.stack.push(g.getImageData(0, 0, this.W, this.H));
      g.clearRect(0, 0, this.W, this.H);
    }

    /** Tolerant overlap score of the student's ink vs. the current step's strokes. */
    check() {
      const w = 120, h = Math.max(8, Math.round(w / (this.W / this.H)));
      const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      const t = mk(), tg = t.getContext('2d'); tg.fillStyle = '#fff'; tg.fillRect(0, 0, w, h);
      for (const s of this.player.steps[this.step].strokes) {
        if (s.l === 'main' && s.c === '#ffffff') continue;
        A.paintStroke(tg, { s: { p: s.p, w: Math.max(s.w, 7), c: '#000', a: 1 } }, w, h, 1, 1);
      }
      const u = mk(), ug = u.getContext('2d'); ug.drawImage(this.inkStep, 0, 0, w, h);
      const T = new Float32Array(w * h), I = new Float32Array(w * h);
      const td = tg.getImageData(0, 0, w, h).data, ud = ug.getImageData(0, 0, w, h).data;
      let ti = 0, ii = 0;
      for (let i = 0; i < w * h; i++) { T[i] = (255 - td[i * 4]) / 255; I[i] = Math.min(1, ud[i * 4 + 3] / 255 * 3); ti += T[i]; ii += I[i]; }
      if (ii < 3) return { score: 0, msg: 'Draw something on the page first, then check.' };
      const k = 4, Tn = boxBlur(T, w, h, 3), In = boxBlur(I, w, h, 3);
      let pr = 0, rc = 0, miss = new Float32Array(9);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        pr += I[i] * Math.min(1, Tn[i] * k);
        const cov = Math.min(1, In[i] * k);
        rc += T[i] * cov;
        miss[Math.min(2, (y / h * 3) | 0) * 3 + Math.min(2, (x / w * 3) | 0)] += T[i] * (1 - cov);
      }
      const P = pr / ii, R = ti > 0 ? rc / ti : 1, F = P + R > 0 ? (2 * P * R) / (P + R) : 0;
      const score = Math.round(clamp(F, 0, 1) * 100);
      let worst = 0; for (let i = 1; i < 9; i++) if (miss[i] > miss[worst]) worst = i;
      const totalMiss = miss.reduce((a, b) => a + b, 0);
      const vn = ['top', 'middle', 'bottom'][(worst / 3) | 0], hn = ['left', 'centre', 'right'][worst % 3];
      const where = vn === 'middle' && hn === 'centre' ? 'the middle' : vn === 'middle' ? `the ${hn} side` : hn === 'centre' ? `the ${vn} area` : `the ${vn}-${hn}`;
      const tier = score >= 85 ? 'Excellent — very close to the guide.' : score >= 65 ? 'Nice work — a solid match.' : score >= 40 ? 'Getting there.' : 'Compare with the blue guide and give it another go.';
      const tip = totalMiss > ti * 0.2 && score < 85 ? ` The guide is least covered in ${where}.` : '';
      return { score, msg: `${score}% match. ${tier}${tip}` };
    }
  };
})(window);
