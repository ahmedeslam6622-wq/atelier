/* Atelier — engine-plan.js
 * Reads a photo and writes a drawing lesson: insights + an ordered list of steps,
 * each step holding the actual pen strokes an artist would make.
 * Stroke format (normalised 0..1 of the canvas; widths in px of a 1000px-wide canvas):
 *   { p:[x0,y0,x1,y1,...], w, c:'#hex', a:0..1, l:'guide'|'construct'|'main' }
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});
  const clamp = A.clamp;

  const LEVELS = {
    easy:     { levels: 3, maxShapes: 8,  edges: 45,  hs: 3.4, k: 4, ps: 7.5, glaze: 0 },
    standard: { levels: 4, maxShapes: 12, edges: 120, hs: 2.7, k: 6, ps: 5.5, glaze: 4.2 },
    detailed: { levels: 5, maxShapes: 18, edges: 280, hs: 2.1, k: 8, ps: 4.0, glaze: 3.0 },
  };
  A.LEVELS = Object.keys(LEVELS);

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const r4 = (v) => Math.round(v * 10000) / 10000;

  /* ---------- colour helpers ---------- */
  function colorName(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, d = mx - mn;
    if (d < 18) return l > 0.85 ? 'white' : l > 0.6 ? 'light grey' : l > 0.3 ? 'grey' : l > 0.12 ? 'charcoal' : 'black';
    let h;
    if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
    const base = h < 15 || h >= 345 ? 'red' : h < 40 ? 'orange' : h < 65 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'teal' : h < 255 ? 'blue' : h < 290 ? 'violet' : 'pink';
    return (l > 0.7 ? 'light ' : l < 0.28 ? 'deep ' : '') + base;
  }
  const mix = (c, t, k) => [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k];
  const hexOf = (c) => A.hex(c[0], c[1], c[2]);

  /* ---------- insights ---------- */
  function insights(img, km) {
    const { w, h, gray } = img, n = w * h;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += gray[i];
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (gray[i] - mean) * (gray[i] - mean);
    const sd = Math.sqrt(v / n);
    let dk = 0, md = 0, lt = 0;
    for (let i = 0; i < n; i++) { if (gray[i] < 85) dk++; else if (gray[i] < 170) md++; else lt++; }

    // saliency = local contrast, nudged toward the centre
    const loc = A.blur(gray, w, h, Math.max(4, Math.round(w / 18)));
    const sal = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dc = Math.hypot((x / w - 0.5) * 2, (y / h - 0.5) * 2) / 1.42;
      sal[i] = Math.abs(gray[i] - loc[i]) * (1 - 0.45 * dc);
    }
    const sb = A.blur(sal, w, h, 2), thr = A.percentile(sb, 0.85);
    let fx = 0, fy = 0, fw = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = sb[y * w + x];
      if (s >= thr) { fx += x * s; fy += y * s; fw += s; }
    }
    const focal = fw > 0 ? { x: fx / fw / w, y: fy / fw / h } : { x: 0.5, y: 0.5 };

    const { mag } = A.sobel(A.blur(gray, w, h, 1), w, h);
    let strong = 0;
    for (let i = 0; i < n; i++) if (mag[i] > 80) strong++;
    const edgeDensity = strong / n;

    const ratio = w / h;
    const std = [[1, '1:1'], [5 / 4, '5:4'], [4 / 3, '4:3'], [3 / 2, '3:2'], [16 / 9, '16:9'], [4 / 5, '4:5'], [3 / 4, '3:4'], [2 / 3, '2:3'], [9 / 16, '9:16']];
    let ar = null, bd = 1e9;
    for (const [q, nm] of std) { const d = Math.abs(Math.log(ratio / q)); if (d < bd) { bd = d; ar = nm; } }
    if (bd > 0.06) ar = ratio.toFixed(2) + ':1';

    const total = km.counts.reduce((a, b) => a + b, 0);
    const palette = km.centers
      .map((c, i) => ({ hex: hexOf(c), name: colorName(c[0], c[1], c[2]), pct: Math.round((km.counts[i] / total) * 100), rgb: c.map(Math.round) }))
      .filter((p) => p.pct > 0)
      .sort((a, b) => b.pct - a.pct);

    const key = mean > 150 ? 'high-key (bright)' : mean < 90 ? 'low-key (dark and moody)' : 'balanced';
    const contrast = sd > 62 ? 'strong' : sd > 38 ? 'medium' : 'soft';
    const complexity = edgeDensity < 0.05 ? 'simple' : edgeDensity < 0.12 ? 'moderate' : 'complex';
    const hz = focal.x < 0.42 ? 'left' : focal.x > 0.58 ? 'right' : 'centre';
    const vt = focal.y < 0.42 ? 'upper' : focal.y > 0.58 ? 'lower' : 'middle';
    const where = hz === 'centre' && vt === 'middle' ? 'centre' : vt === 'middle' ? `${hz} side` : hz === 'centre' ? `${vt} centre` : `${vt}-${hz}`;
    const orient = ratio > 1.08 ? 'landscape' : ratio < 0.92 ? 'portrait' : 'square';

    return {
      orientation: orient, aspect: ar, ratio, tone: key, contrast, complexity, focal, where,
      values: { dark: Math.round((dk / n) * 100), mid: Math.round((md / n) * 100), light: Math.round((lt / n) * 100) },
      palette, mean: Math.round(mean), edgeDensity,
      summary:
        `A ${complexity} ${orient} (${ar}) with ${contrast} contrast and a ${key} tonal range. ` +
        `The eye is drawn to the ${where} of the frame. Mostly ${palette.slice(0, 2).map((p) => p.name).join(' and ')}.`,
    };
  }

  /* ---------- stroke builders ---------- */
  function mk(img, pts, o, off) {
    const p = [];
    for (const q of pts) p.push(r4(clamp((q[0] + off) / img.w, 0, 1)), r4(clamp((q[1] + off) / img.h, 0, 1)));
    return Object.assign({ p, l: 'main' }, o);
  }

  /** Split hatch runs into short dabs and colour each from a sampler (paint mode). */
  function dabs(img, runs, len, colorFn, o) {
    const out = [];
    for (const r of runs) {
      const L = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);
      const n = Math.max(1, Math.round(L / len));
      for (let i = 0; i < n; i++) {
        const a = i / n, b = (i + 1) / n + 0.02;
        const s = [r[0][0] + (r[1][0] - r[0][0]) * a, r[0][1] + (r[1][1] - r[0][1]) * a];
        const e = [r[0][0] + (r[1][0] - r[0][0]) * Math.min(1, b), r[0][1] + (r[1][1] - r[0][1]) * Math.min(1, b)];
        const mid = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
        out.push(mk(img, [s, e], Object.assign({ c: colorFn(mid) }, o), 0));
      }
    }
    return out;
  }

  const TONE_TITLES = {
    1: ['Add the shading'],
    2: ['Block in the shadows', 'Deepen the darks'],
    3: ['Light tone wash', 'Midtones', 'Darkest darks'],
    4: ['Light tone wash', 'Midtones', 'Core shadows', 'Darkest darks'],
  };

  /* ---------- the planner ---------- */
  /**
   * @param rgba  Uint8ClampedArray RGBA of the photo, sw x sh
   * @param opts  { level:'easy'|'standard'|'detailed', onProgress(pct,label), maxSide }
   */
  A.analyze = async function (rgba, sw, sh, opts) {
    opts = opts || {};
    const cfg = LEVELS[opts.level || 'standard'];
    const prog = opts.onProgress || function () {};
    const rand = rng(1337);
    const img = A.prepare(rgba, sw, sh, opts.maxSide || 200);
    const { w, h } = img, n = w * h;
    const wpx = 1000 / w; // analysis px -> units of a 1000px canvas
    prog(0.08, 'Reading the photo'); await tick();

    let km = A.kmeans(img, cfg.k, 8);
    km.labels = A.modeFilter(km.labels, w, h, cfg.k, 2);
    km.counts = new Array(cfg.k).fill(0);
    for (let i = 0; i < n; i++) km.counts[km.labels[i]]++;
    const info = insights(img, km);
    prog(0.22, 'Finding the focal point and colours'); await tick();

    const g2 = A.blur(img.gray, w, h, 2);
    const g1 = A.blur(img.gray, w, h, 1);
    const th = A.quantiles(g2, cfg.levels);
    let lv = A.levelMap(g2, th);
    lv = A.modeFilter(lv, w, h, cfg.levels, 1);

    const sketch = [], paint = [];
    const pencil = '#2b2b30';

    /* ===== SKETCH ===== */
    // 1 — page set-up: frame, centre lines, thirds, focal mark
    const gc = '#4fa7ff', G = (pts, wd, a) => ({ p: pts.map(r4), w: wd, c: gc, a, l: 'guide' });
    const guides = [
      G([0.02, 0.02, 0.98, 0.02, 0.98, 0.98, 0.02, 0.98, 0.02, 0.02], 1.6, 0.9),
      G([0.5, 0.02, 0.5, 0.98], 1, 0.55), G([0.02, 0.5, 0.98, 0.5], 1, 0.55),
      G([1 / 3, 0.02, 1 / 3, 0.98], 1, 0.4), G([2 / 3, 0.02, 2 / 3, 0.98], 1, 0.4),
      G([0.02, 1 / 3, 0.98, 1 / 3], 1, 0.4), G([0.02, 2 / 3, 0.98, 2 / 3], 1, 0.4),
    ];
    const fxy = info.focal, rr = 0.035, ring = [];
    for (let i = 0; i <= 24; i++) { const t = (i / 24) * Math.PI * 2; ring.push(fxy.x + Math.cos(t) * rr * (h / w), fxy.y + Math.sin(t) * rr); }
    guides.push(G(ring, 1.4, 0.95), G([fxy.x - 0.06 * (h / w), fxy.y, fxy.x + 0.06 * (h / w), fxy.y], 1.2, 0.9), G([fxy.x, fxy.y - 0.06, fxy.x, fxy.y + 0.06], 1.2, 0.9));
    sketch.push({
      id: 's1', title: 'Set up the page', tool: 'Hard pencil (2H) — press very lightly', strokes: guides,
      tip: `Your photo is ${info.orientation} (${info.aspect}). Mark a frame with that ratio, then divide it in thirds. The blue ring marks where the eye lands — the ${info.where} of the frame. Anchor your main subject there.`,
      why: 'Proportions go wrong first. Fixing the frame and the focal point before any detail keeps every later shape in the right place.',
      fade: [],
    });
    prog(0.3, 'Planning the page layout'); await tick();

    // 2 — block in the big shapes
    {
      const big = A.blur(img.gray, w, h, Math.max(3, Math.round(w / 40)));
      const bth = A.quantiles(big, cfg.levels > 3 ? 3 : 2);
      const loops = [];
      for (const t of bth) {
        const mask = new Uint8Array(n);
        for (let i = 0; i < n; i++) mask[i] = big[i] < t ? 1 : 0;
        for (const c of A.contours(mask, w, h)) if (A.polyLen(c.pts) > w / 5 && A.polyArea(c.pts) > n * 0.004) loops.push(c);
      }
      loops.sort((a, b) => A.polyLen(b.pts) - A.polyLen(a.pts)).splice(cfg.maxShapes);
      const strokes = loops.map((c) => {
        const s = A.rdp(c.closed ? c.pts.concat([c.pts[0]]) : c.pts, Math.max(2.2, w / 80));
        return mk(img, s, { w: 1.5, c: '#707078', a: 0.65, l: 'construct' }, 0.5);
      });
      sketch.push({
        id: 's2', title: 'Block in the big shapes', tool: 'HB pencil — straight lines only', strokes,
        tip: 'Squint at the photo until the details melt away. What is left are two or three big dark and light masses. Draw only those, using straight, angular lines — no curves yet.',
        why: 'Seeing a handful of large shapes is far easier than seeing "a face" or "a tree". Everything else hangs off this skeleton.',
        fade: ['guide'],
      });
    }
    prog(0.42, 'Blocking in big shapes'); await tick();

    // 3 — refine the contour (iso-lines at every tonal threshold, each drawn once)
    {
      const strokes = [];
      const minLen = Math.max(14, w / 12);
      for (let t = th.length - 1; t >= 0; t--) {
        const mask = new Uint8Array(n);
        for (let i = 0; i < n; i++) mask[i] = g2[i] < th[t] ? 1 : 0;
        const loops = A.contours(mask, w, h)
          .filter((c) => A.polyLen(c.pts) >= minLen)
          .sort((a, b) => A.polyLen(b.pts) - A.polyLen(a.pts));
        for (const c of loops) {
          const pts = c.closed ? c.pts.concat([c.pts[0]]) : c.pts;
          const s = A.chaikin(A.rdp(pts, 0.9), c.closed, 2);
          strokes.push(mk(img, s, { w: 1.2, c: pencil, a: 0.8, l: 'main' }, 0.5));
        }
      }
      sketch.push({
        id: 's3', title: 'Refine the outlines', tool: 'HB pencil — let the line flow', strokes,
        tip: 'Now round the angles into the real contours. Follow the edges where one tone meets another; these lines are the borders between light and shadow, not outlines of objects.',
        why: 'Drawing tone borders instead of "outlines" is what makes a sketch look three-dimensional rather than like a colouring book.',
        fade: [],
      });
    }
    prog(0.56, 'Tracing the contours'); await tick();

    // 4.. — tonal passes, light to dark
    {
      const angles = [45, -30, 75, 10, -60];
      const passes = cfg.levels - 1;
      const titles = TONE_TITLES[Math.min(4, passes)];
      let order = 0;
      for (let i = passes - 1; i >= 0; i--, order++) {
        const mask = new Uint8Array(n);
        let cnt = 0;
        for (let k = 0; k < n; k++) if (lv[k] <= i) { mask[k] = 1; cnt++; }
        if (cnt < n * 0.01) continue;
        const sp = cfg.hs * (1 + order * 0.08);
        const runs = A.hatch(mask, w, h, { spacing: sp, angle: angles[order % angles.length], minRun: 2.5, jitter: 0.7, rand });
        const strokes = runs.map((r) => mk(img, r, { w: sp * wpx * 0.42, c: order > 1 ? '#1d1d22' : pencil, a: 0.5 + order * 0.1, l: 'main' }, 0));
        const pct = Math.round((cnt / n) * 100);
        const nth = titles[Math.min(order, titles.length - 1)];
        sketch.push({
          id: 's' + (4 + order), title: nth, tool: order < 2 ? '2B pencil — flat side, light pressure' : '4B pencil — build up gradually', strokes,
          tip: `About ${pct}% of the picture is at least this dark. Shade it with parallel strokes in one direction and keep the pressure even. Dark areas get more layers, so you are building the tone, not pressing hard.`,
          why: 'Light-to-dark layering is how artists keep control: you can always go darker, but you can rarely go lighter.',
          fade: order === 0 ? ['construct'] : [],
        });
      }
    }
    prog(0.7, 'Planning the shading'); await tick();

    // details
    {
      const chains = A.edgeChains(g1, w, h, { hiPct: 0.88 }).slice(0, cfg.edges);
      const strokes = chains.map((c, i) => mk(img, c.pts, { w: i < chains.length * 0.25 ? 1.5 : 1.0, c: '#17171a', a: i < chains.length * 0.25 ? 0.85 : 0.65, l: 'main' }, 0.5));
      sketch.push({
        id: 's9', title: 'Details and sharp edges', tool: 'Sharp 2B — rotate the pencil to keep a point', strokes,
        tip: 'Only now add the small stuff: crisp edges, textures, tiny shapes. Keep the sharpest, darkest lines for the places nearest the viewer or the focal point — soft edges recede, hard ones come forward.',
        why: 'Detail is seasoning. Added too early it fights the structure; added last it guides the eye.',
        fade: [],
      });
    }
    prog(0.8, 'Finding the details'); await tick();

    // highlights + accents
    {
      const hiT = A.percentile(g1, 0.93), loT = A.percentile(g1, 0.05);
      const mh = new Uint8Array(n), ml = new Uint8Array(n);
      for (let i = 0; i < n; i++) { if (g1[i] >= hiT) mh[i] = 1; if (g1[i] <= loT) ml[i] = 1; }
      const mlF = A.filterComponents(ml, w, h, 6, n * 0.012), mhF = A.filterComponents(mh, w, h, 6, n * 0.03);
      const dk = A.hatch(mlF, w, h, { spacing: 1.5, angle: 20, minRun: 1.5, jitter: 0.4, rand }).map((r) => mk(img, r, { w: 1.5, c: '#050505', a: 0.8, l: 'main' }, 0));
      const hl = A.hatch(mhF, w, h, { spacing: 1.7, angle: -60, minRun: 1.5, jitter: 0.4, rand }).map((r) => mk(img, r, { w: 1.9, c: '#ffffff', a: 0.92, l: 'main' }, 0));
      sketch.push({
        id: 's10', title: 'Darkest accents and highlights', tool: 'Soft 6B pencil + kneaded eraser', strokes: dk.concat(hl),
        tip: 'Punch in the darkest darks, then lift the brightest highlights with a kneaded eraser (or a white gel pen). Stepping back, the extremes of the tonal range are what make the drawing "pop".',
        why: 'Contrast is the last 10% of effort that gives 40% of the impact.',
        fade: [],
      });
    }

    /* ===== PAINT ===== */
    prog(0.86, 'Mixing the palette'); await tick();
    const sample = (() => {
      const R = A.blur(img.r, w, h, 1), Gc = A.blur(img.g, w, h, 1), B = A.blur(img.b, w, h, 1);
      return (p) => {
        const x = clamp(Math.floor(p[0]), 0, w - 1), y = clamp(Math.floor(p[1]), 0, h - 1), i = y * w + x;
        return [R[i], Gc[i], B[i]];
      };
    })();
    {
      let mr = 0, mg = 0, mb = 0;
      for (let i = 0; i < n; i++) { mr += img.r[i]; mg += img.g[i]; mb += img.b[i]; }
      const ground = mix([mr / n, mg / n, mb / n], [255, 255, 255], 0.6);
      const all = new Uint8Array(n).fill(1);
      const sp = cfg.ps * 1.6;
      const runs = A.hatch(all, w, h, { spacing: sp, angle: 8, minRun: 2, jitter: 1.2, rand });
      paint.push({
        id: 'p1', title: 'Tone the canvas', tool: 'Large flat brush — thin, runny paint', strokes: runs.map((r) => mk(img, r, { w: sp * wpx * 1.5, c: hexOf(ground), a: 0.55, l: 'main' }, 0)),
        tip: 'Cover the white with a thin wash of the photo\'s average colour. A toned ground makes every colour you add glow, and removes the fear of the blank canvas.',
        why: 'Pure white is the hardest value to judge against. A mid-light ground lets you place darks and lights accurately.',
        fade: [],
      });
      const order = km.counts.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
      const groups = [order.slice(0, Math.ceil(order.length / 3)), order.slice(Math.ceil(order.length / 3), Math.ceil((order.length * 2) / 3)), order.slice(Math.ceil((order.length * 2) / 3))];
      const gTitles = [['Large colour masses', 'Largest brush — cover big areas first, ignore detail.'], ['Secondary shapes', 'Medium brush — work wet-into-wet where colours meet.'], ['Small accents', 'Small round brush — the final colour notes.']];
      groups.forEach((grp, gi) => {
        const strokes = [];
        for (const c of grp) {
          const mask = new Uint8Array(n);
          let cnt = 0;
          for (let i = 0; i < n; i++) if (km.labels[i] === c) { mask[i] = 1; cnt++; }
          if (cnt < n * 0.004) continue;
          const spc = cfg.ps * (1 - gi * 0.18);
          const runs2 = A.hatch(mask, w, h, { spacing: spc, angle: 12 - gi * 20, minRun: 2, jitter: 1.0, rand });
          const col = hexOf(km.centers[c]);
          for (const r of runs2) strokes.push(mk(img, r, { w: spc * wpx * 1.7, c: col, a: 0.94, l: 'main' }, 0));
        }
        if (!strokes.length) return;
        paint.push({
          id: 'p' + (2 + gi), title: gTitles[gi][0], tool: gTitles[gi][1], strokes,
          tip: grp.length ? `Mix ${grp.map((c) => colorName(...km.centers[c].map(Math.round))).join(', ')} and fill each shape in turn. Look at the shape, not at what it is.` : '',
          why: 'Painting big-to-small keeps your drawing unified: early mistakes are cheap to fix and later detail lands on solid ground.',
          fade: [],
        });
      });
      if (cfg.glaze) {
        const sg = cfg.glaze;
        const runs3 = A.hatch(all, w, h, { spacing: sg, angle: -25, minRun: 2, jitter: 1.4, rand });
        const strokes = dabs(img, runs3, 6, (m) => hexOf(sample(m)), { w: sg * wpx * 1.5, a: 0.5, l: 'main' });
        paint.push({
          id: 'p5', title: 'Glaze with true colours', tool: 'Soft synthetic brush — short, loose strokes', strokes,
          tip: 'Go over the whole surface with short strokes in the colour you see at each spot. This blends the flat shapes together and recovers the subtle gradients.',
          why: 'Flat colour blocks give structure; glazing gives atmosphere. It is the step that makes a painting feel alive.',
          fade: [],
        });
      }
      const chains = A.edgeChains(g1, w, h, { hiPct: 0.9 }).slice(0, Math.round(cfg.edges * 0.7));
      paint.push({
        id: 'p6', title: 'Details and dark lines', tool: 'Rigger or small round — thin dark paint',
        strokes: chains.map((c) => {
          const mid = c.pts[Math.floor(c.pts.length / 2)];
          return mk(img, c.pts, { w: 1.6, c: hexOf(mix(sample([mid[0], mid[1]]), [20, 15, 25], 0.55)), a: 0.8, l: 'main' }, 0.5);
        }),
        tip: 'Use a darker version of the local colour (never plain black) for the final crisp edges. Vary line weight: thick where things overlap, thin where they recede.',
        why: 'Coloured darks keep the painting luminous; black flattens it.',
        fade: [],
      });
      const hiT = A.percentile(g1, 0.94);
      const mh = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (g1[i] >= hiT) mh[i] = 1;
      const hruns = A.hatch(A.filterComponents(mh, w, h, 6, n * 0.03), w, h, { spacing: 2.6, angle: -50, minRun: 1.5, jitter: 1.4, rand });
      paint.push({
        id: 'p7', title: 'Highlights', tool: 'Small flat brush — thick, creamy paint',
        strokes: dabs(img, hruns, 4, (m) => hexOf(mix(sample(m), [255, 255, 250], 0.65)), { w: 3.2, a: 0.75, l: 'main' }),
        tip: 'Add your lightest, thickest paint last, only where light hits directly. One decisive touch beats five timid ones.',
        why: 'Thick light over thin dark is the oldest trick in painting — it makes light feel like it is coming off the canvas.',
        fade: [],
      });
    }
    prog(1, 'Plan ready');

    const count = (steps) => steps.reduce((s, st) => s + st.strokes.length, 0);
    return {
      v: 1, level: opts.level || 'standard', aspect: img.w / img.h, size: { w: sw, h: sh },
      insights: info, palette: info.palette,
      modes: { sketch: { steps: sketch.filter((s) => s.strokes.length) }, paint: { steps: paint.filter((s) => s.strokes.length) } },
      stats: { sketch: count(sketch), paint: count(paint) },
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
