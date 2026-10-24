/* Atelier — engine-core.js
 * Pure image-processing primitives. No DOM, no canvas: they work on typed arrays,
 * so the same code runs in the browser and in Node (for testing).
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  A.clamp = clamp;

  /** Box-downsample RGBA into float planes (alpha composited on white). */
  A.prepare = function (rgba, sw, sh, maxSide) {
    const sc = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(8, Math.round(sw * sc));
    const h = Math.max(8, Math.round(sh * sc));
    const r = new Float32Array(w * h), g = new Float32Array(w * h), b = new Float32Array(w * h);
    const gray = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor((y * sh) / h);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor((x * sw) / w);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let yy = y0; yy < y1 && yy < sh; yy++) {
          for (let xx = x0; xx < x1 && xx < sw; xx++) {
            const i = (yy * sw + xx) * 4;
            const a = rgba[i + 3] / 255;
            sr += rgba[i] * a + 255 * (1 - a);
            sg += rgba[i + 1] * a + 255 * (1 - a);
            sb += rgba[i + 2] * a + 255 * (1 - a);
            n++;
          }
        }
        const k = y * w + x;
        r[k] = sr / n; g[k] = sg / n; b[k] = sb / n;
        gray[k] = 0.299 * r[k] + 0.587 * g[k] + 0.114 * b[k];
      }
    }
    return { w, h, r, g, b, gray };
  };

  /** Separable box blur with edge clamping. */
  A.blur = function (src, w, h, rad) {
    rad = Math.round(rad);
    if (rad < 1) return Float32Array.from(src);
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const d = 2 * rad + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let k = -rad; k <= rad; k++) acc += src[row + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / d;
        acc += src[row + Math.min(x + rad + 1, w - 1)] - src[row + Math.max(x - rad, 0)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -rad; k <= rad; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / d;
        acc += tmp[Math.min(y + rad + 1, h - 1) * w + x] - tmp[Math.max(y - rad, 0) * w + x];
      }
    }
    return out;
  };

  /** n-1 thresholds that split values into n equally populated bands. */
  A.quantiles = function (vals, n) {
    const s = Float32Array.from(vals).sort();
    const t = [];
    for (let i = 1; i < n; i++) t.push(s[Math.min(s.length - 1, Math.floor((s.length * i) / n))]);
    return t;
  };
  A.percentile = function (vals, p) {
    const s = Float32Array.from(vals).sort();
    return s[clamp(Math.floor(s.length * p), 0, s.length - 1)];
  };

  /** Band index per pixel: 0 = darkest. */
  A.levelMap = function (gray, th) {
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) {
      let l = 0;
      while (l < th.length && gray[i] >= th[l]) l++;
      out[i] = l;
    }
    return out;
  };

  /** Deterministic k-means in RGB. Centres seeded from luminance quantiles. */
  A.kmeans = function (img, k, iters) {
    const n = img.w * img.h;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => img.gray[a] - img.gray[b]);
    const C = [];
    for (let i = 0; i < k; i++) {
      const p = order[Math.floor(((i + 0.5) / k) * n)];
      C.push([img.r[p], img.g[p], img.b[p]]);
    }
    const labels = new Uint8Array(n);
    for (let it = 0; it < (iters || 8); it++) {
      const sum = C.map(() => [0, 0, 0, 0]);
      for (let p = 0; p < n; p++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) {
          const dr = img.r[p] - C[c][0], dg = img.g[p] - C[c][1], db = img.b[p] - C[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = c; }
        }
        labels[p] = best;
        const s = sum[best];
        s[0] += img.r[p]; s[1] += img.g[p]; s[2] += img.b[p]; s[3]++;
      }
      for (let c = 0; c < k; c++) {
        if (sum[c][3] > 0) C[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
      }
    }
    const counts = new Array(k).fill(0);
    for (let p = 0; p < n; p++) counts[labels[p]]++;
    return { labels, centers: C, counts };
  };

  /** 3x3 majority filter on a label map: removes speckle, keeps shapes. */
  A.modeFilter = function (labels, w, h, k, passes) {
    let src = labels;
    for (let ps = 0; ps < (passes || 1); ps++) {
      const out = new Uint8Array(src.length);
      const cnt = new Uint8Array(k);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          cnt.fill(0);
          for (let dy = -1; dy <= 1; dy++) {
            const yy = clamp(y + dy, 0, h - 1);
            for (let dx = -1; dx <= 1; dx++) cnt[src[yy * w + clamp(x + dx, 0, w - 1)]]++;
          }
          let best = src[y * w + x], bc = cnt[best];
          for (let c = 0; c < k; c++) if (cnt[c] > bc) { bc = cnt[c]; best = c; }
          out[y * w + x] = best;
        }
      }
      src = out;
    }
    return src;
  };

  /** Sobel gradient: returns magnitude and quantised direction (0..3). */
  A.sobel = function (gray, w, h) {
    const mag = new Float32Array(w * h), dir = new Uint8Array(w * h);
    const at = (x, y) => gray[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
        const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
        const i = y * w + x;
        mag[i] = Math.hypot(gx, gy);
        let a = (Math.atan2(gy, gx) * 180) / Math.PI;
        if (a < 0) a += 180;
        // 0: horizontal gradient, 1: diag /, 2: vertical gradient, 3: diag \
        dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
      }
    }
    return { mag, dir };
  };

  A.hex = function (r, g, b) {
    const h = (v) => ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2);
    return '#' + h(r) + h(g) + h(b);
  };
})(typeof window !== 'undefined' ? window : globalThis);
