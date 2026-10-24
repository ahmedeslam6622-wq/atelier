/* Atelier — ui.js
 * UI building blocks: icons, press feedback, segmented controls, toast, the spring-physics
 * bottom sheet and the procedural sample scene.
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});
  const $ = (s, r) => (r || document).querySelector(s);
  A.$ = $; A.$$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- icons (24px grid, 1.8 stroke, SF-Symbols-like) ---------- */
  const P = (d) => `<path d="${d}"/>`;
  const ICONS = {
    back: P('M15 5l-7 7 7 7'),
    photo: '<rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="9.6" r="1.6"/>' + P('M4 18l5-5 4 4 3-3 4 4'),
    camera: P('M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z') + '<circle cx="12" cy="13" r="3.6"/>',
    play: '<path fill="currentColor" stroke="none" d="M8 5.2v13.6a1 1 0 001.5.86l11-6.8a1 1 0 000-1.72l-11-6.8A1 1 0 008 5.2z"/>',
    pause: '<rect fill="currentColor" stroke="none" x="6.5" y="5" width="4.2" height="14" rx="1.4"/><rect fill="currentColor" stroke="none" x="13.3" y="5" width="4.2" height="14" rx="1.4"/>',
    next: '<path fill="currentColor" stroke="none" d="M5.5 6.3v11.4a.9.9 0 001.4.74l8-5.7a.9.9 0 000-1.48l-8-5.7a.9.9 0 00-1.4.74z"/>' + P('M18.5 6v12'),
    prev: '<path fill="currentColor" stroke="none" d="M18.5 6.3v11.4a.9.9 0 01-1.4.74l-8-5.7a.9.9 0 010-1.48l8-5.7a.9.9 0 011.4.74z"/>' + P('M5.5 6v12'),
    sparkles: P('M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z') + P('M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'),
    pencil: P('M4 20l1-4.2L16.3 4.5a2.1 2.1 0 013 3L7.9 18.8z') + P('M14.6 6.2l3.2 3.2'),
    eraser: P('M9 19.5h10.5') + P('M5.2 14.8l8.6-8.6a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8l-6.2 6.3H8.4z') + P('M8.6 11.4l5.2 5.2'),
    undo: P('M9 6L4.5 11 9 16') + P('M5 11h9a4.5 4.5 0 010 9h-4'),
    trash: P('M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3'),
    check: P('M5 12.5l4.5 4.5L19 7.5'),
    hand: P('M3 17c3-1 4-8 7-8s2.5 6 5.500 6S18 9 21 8'),
    download: P('M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14'),
    film: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path fill="currentColor" stroke="none" d="M10.2 9.4v5.2a.5.5 0 00.76.43l4.1-2.6a.5.5 0 000-.86l-4.1-2.6a.5.5 0 00-.76.43z"/>',
    folder: P('M3 7.5A2.5 2.5 0 015.5 5H9l2 2h7.500A2.500 2.500 0 0121 9.500v7a2.500 2.500 0 01-2.500 2.500h-13A2.500 2.500 0 013 16.500z'),
    lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/>' + P('M8 11V8a4 4 0 018 0v3'),
  };
  A.icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  A.hydrateIcons = (r) => A.$$('[data-icon]', r).forEach((el) => { el.innerHTML = A.icon(el.dataset.icon); });
  A.setIcon = (el, n) => { el.dataset.icon = n; el.innerHTML = A.icon(n); };

  A.LOGO = `<svg viewBox="0 0 76 76"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb457"/><stop offset=".55" stop-color="#ff5e7e"/><stop offset="1" stop-color="#7a5cff"/></linearGradient></defs><rect width="76" height="76" fill="url(#lg)"/><path d="M14 54c9-1 12-18 22-18s9 12 18 12c4 0 7-3 9-6" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="1 7"/><g transform="rotate(38 38 38)"><rect x="33" y="10" width="10" height="38" rx="2.5" fill="#fff"/><path d="M33 48h10l-5 11z" fill="#ffe3bf"/><path d="M36 55.500h4L38 59z" fill="#35353a"/><rect x="33" y="10" width="10" height="7" rx="2.5" fill="#ffc0cf"/></g></svg>`;
  A.DROPART = `<svg viewBox="0 0 150 92"><rect x="4" y="12" width="64" height="50" rx="9" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/><circle cx="22" cy="28" r="5" fill="currentColor" fill-opacity=".35"/><path d="M8 56l18-16 14 12 12-10 14 14" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M72 36h18m-6-6l6 6-6 6" transform="translate(2 0)" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="104" y="28" width="42" height="56" rx="7" fill="#fff" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/><path d="M112 66c6-12 10 4 16-8s8-2 12-10" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 5.500"/></svg>`;

  /* ---------- press feedback: acts on touch-down, not on release ---------- */
  A.initPress = function () {
    let cur = null;
    const off = () => { if (cur) { cur.classList.remove('pressed'); cur = null; } };
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest && e.target.closest('[data-press]');
      if (el && !el.disabled) { cur = el; el.classList.add('pressed'); }
    }, { passive: true });
    ['pointerup', 'pointercancel', 'dragstart', 'scroll'].forEach((t) => document.addEventListener(t, off, { passive: true, capture: true }));
  };

  /* ---------- segmented control with a sliding thumb ---------- */
  A.Seg = function (el, onChange) {
    const btns = A.$$('button', el);
    el.style.setProperty('--n', btns.length);
    const api = {
      el,
      get value() { return el.dataset.value; },
      set(v, silent) {
        el.dataset.value = v;
        el.style.setProperty('--i', Math.max(0, btns.findIndex((b) => b.dataset.v === v)));
        btns.forEach((b) => b.setAttribute('aria-selected', b.dataset.v === v));
        if (!silent && onChange) onChange(v);
      },
    };
    btns.forEach((b) => b.addEventListener('click', () => { if (b.dataset.v !== api.value) api.set(b.dataset.v); }));
    api.set(el.dataset.value, true);
    return api;
  };

  /* ---------- toast ---------- */
  let tt = 0;
  A.toast = function (msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, ms || 2600);
  };
  A.buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms || 8); } catch (e) { /* ignore */ } };

  /* ---------- bottom sheet: 1:1 finger tracking, spring settle, interruptible ---------- */
  A.Sheet = class Sheet {
    constructor(el, head, body, onState) {
      this.el = el; this.head = head; this.body = body; this.onState = onState;
      this.y = 0; this.raf = 0; this.drag = null; this.state = 'peek'; this.enabled = true;
      head.addEventListener('pointerdown', (e) => this.down(e, head));
      head.addEventListener('pointermove', (e) => this.move(e));
      head.addEventListener('pointerup', (e) => this.up(e));
      head.addEventListener('pointercancel', (e) => this.up(e));
      body.addEventListener('pointerdown', (e) => { if (this.state !== 'full') this.down(e, body); });
      body.addEventListener('pointermove', (e) => this.move(e));
      body.addEventListener('pointerup', (e) => this.up(e));
      body.addEventListener('pointercancel', (e) => this.up(e));
    }
    metrics() {
      const H = this.el.offsetHeight;
      this.peekH = this.head.offsetHeight + 2;
      this.d = { peek: Math.max(0, H - this.peekH), half: Math.round(H * 0.46), full: 0 };
      return this.peekH;
    }
    setY(y) { this.y = y; this.el.style.setProperty('--y', y.toFixed(1) + 'px'); }
    setState(s) {
      this.state = s;
      this.el.classList.toggle('full', s === 'full');
      this.body.style.touchAction = s === 'full' ? 'pan-y' : 'none';
      if (this.onState) this.onState(s);
    }
    snap(name, instant) {
      if (!this.enabled) return;
      this.metrics();
      if (instant || reduce()) { cancelAnimationFrame(this.raf); this.setY(this.d[name]); this.setState(name); return; }
      this.animate(this.d[name], 0, name);
    }
    down(e, from) {
      if (!this.enabled) return;
      if (from === this.head && e.target.closest('button, input, .seg') && !e.target.closest('.grab')) return;
      cancelAnimationFrame(this.raf); // interruptible: catch it mid-flight
      this.metrics();
      this.drag = { id: e.pointerId, y0: e.clientY, p0: this.y, moved: false, s: [[performance.now(), e.clientY]], from };
    }
    move(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y0;
      if (!d.moved) { if (Math.abs(dy) < 5) return; d.moved = true; try { d.from.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } }
      let y = d.p0 + dy;
      if (y < 0) y *= 0.22; else if (y > this.d.peek) y = this.d.peek + (y - this.d.peek) * 0.22; // rubber band
      this.setY(y);
      d.s.push([performance.now(), e.clientY]); if (d.s.length > 6) d.s.shift();
    }
    up(e) {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      if (!d.moved) { if (e.target.closest && e.target.closest('.grab')) this.snap(this.state === 'peek' ? 'half' : 'peek'); return; }
      const a = d.s[0], b = d.s[d.s.length - 1], v = b[0] > a[0] ? ((b[1] - a[1]) / (b[0] - a[0])) * 1000 : 0; // px/s
      const proj = this.y + v * 0.2;
      let best = 'peek', bd = Infinity;
      for (const k of ['full', 'half', 'peek']) { const dd = Math.abs(this.d[k] - proj); if (dd < bd) { bd = dd; best = k; } }
      if (reduce()) { this.setY(this.d[best]); this.setState(best); } else this.animate(this.d[best], v, best);
    }
    animate(target, v0, name) {
      cancelAnimationFrame(this.raf);
      let y = this.y, v = v0 || 0, last = performance.now();
      const k = 520, c = 2 * 0.86 * Math.sqrt(k); // slightly under-damped: a little life, no wobble
      const step = (now) => {
        let dt = Math.min(0.032, (now - last) / 1000); last = now;
        for (let i = 0; i < 2; i++) { const a = -k * (y - target) - c * v; v += a * (dt / 2); y += v * (dt / 2); }
        this.setY(y);
        if (Math.abs(y - target) < 0.35 && Math.abs(v) < 6) { this.setY(target); this.setState(name); return; }
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
  };

  /* ---------- procedural sample scene (so the app can be tried without a photo) ---------- */
  A.sampleScene = function () {
    const W = 960, H = 720, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, '#2b3a67'); sky.addColorStop(0.45, '#c9707a'); sky.addColorStop(0.8, '#f6a65a'); sky.addColorStop(1, '#ffd68a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const sx = W * 0.66, sy = H * 0.5;
    const glow = g.createRadialGradient(sx, sy, 10, sx, sy, 280);
    glow.addColorStop(0, 'rgba(255,244,200,.95)'); glow.addColorStop(0.25, 'rgba(255,214,140,.5)'); glow.addColorStop(1, 'rgba(255,170,100,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff3cf'; g.beginPath(); g.arc(sx, sy, 44, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,225,200,.35)';
    for (const [x, y, w, h] of [[160, 120, 190, 22], [230, 148, 150, 16], [560, 90, 230, 20], [640, 118, 150, 14]]) { g.beginPath(); g.ellipse(x, y, w / 2, h / 2, 0, 0, 7); g.fill(); }
    const ridge = (y0, amp, col, seed) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, y0 + amp * (Math.sin(x * 0.006 + seed) * 0.5 + Math.sin(x * 0.017 + seed * 2) * 0.3 + Math.sin(x * 0.041 + seed * 3) * 0.2));
      g.lineTo(W, H); g.fill();
    };
    ridge(H * 0.5, 70, '#7a5f8c', 1); ridge(H * 0.56, 62, '#4f4272', 2.4); ridge(H * 0.62, 38, '#2c2749', 4.1);
    const lake = g.createLinearGradient(0, H * 0.64, 0, H);
    lake.addColorStop(0, '#f3a56e'); lake.addColorStop(0.35, '#8a5b7c'); lake.addColorStop(1, '#1f1d38');
    g.fillStyle = lake; g.fillRect(0, H * 0.64, W, H * 0.36);
    for (let i = 0; i < 16; i++) { const y = H * 0.66 + i * 17, w = 130 - i * 6; g.fillStyle = `rgba(255,236,190,${0.5 - i * 0.03})`; g.fillRect(sx - w / 2 + Math.sin(i * 1.7) * 14, y, w, 4); }
    g.fillStyle = '#14121f';
    g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.78); g.quadraticCurveTo(220, H * 0.74, 360, H * 0.9); g.lineTo(430, H); g.fill();
    const pine = (x, y, s) => { for (let k = 0; k < 4; k++) { const w = (60 - k * 11) * s, t = y - k * 46 * s; g.beginPath(); g.moveTo(x - w, t); g.lineTo(x, t - 64 * s); g.lineTo(x + w, t); g.fill(); } g.fillRect(x - 5 * s, y, 10 * s, 26 * s); };
    pine(90, H * 0.9, 1.25); pine(190, H * 0.88, 0.95); pine(40, H * 0.97, 0.85);
    g.strokeStyle = '#2a2140'; g.lineWidth = 3; g.lineCap = 'round';
    for (const [x, y, s] of [[480, 170, 1], [530, 150, 0.8], [585, 190, 0.7]]) { g.beginPath(); g.moveTo(x - 14 * s, y + 4 * s); g.quadraticCurveTo(x - 6 * s, y - 8 * s, x, y); g.quadraticCurveTo(x + 6 * s, y - 8 * s, x + 14 * s, y + 4 * s); g.stroke(); }
    return c;
  };
})(window);
