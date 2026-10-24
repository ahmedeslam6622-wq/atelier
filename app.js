/* Atelier — app.js : screens and flow (home -> analysing -> studio). */
(function () {
  'use strict';
  const A = window.Atelier, $ = A.$, $$ = A.$$;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wide = () => matchMedia('(min-width: 960px)').matches;
  const LEVEL_HINT = {
    easy: 'Easy: fewer, bigger steps. Good for beginners and quick studies.',
    standard: 'Balanced: about a dozen steps with shading and details.',
    detailed: 'Detailed: finer shading and many more strokes, for patient artists.',
  };

  const S = {
    level: A.pref.get('level', 'standard'), mode: 'sketch', photo: null, rgba: null, name: '',
    plans: {}, plan: null, coachData: null, coachBusy: false, practice: false, voice: false, id: null, busy: false,
  };
  let player, practice, sheet, thumbs = [], typer = 0;

  /* ---------- views ---------- */
  function show(id) {
    for (const v of $$('.view')) {
      if (v.id === id) { v.hidden = false; v.classList.add('entering'); requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove('entering'))); }
      else if (!v.hidden) { v.classList.add('leaving'); setTimeout(() => { v.hidden = true; v.classList.remove('leaving'); }, 320); }
    }
  }

  /* ---------- photo in ---------- */
  async function toCanvas(src) {
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const sc = Math.min(1, 1280 / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(w0 * sc)); c.height = Math.max(8, Math.round(h0 * sc));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    }
  }
  async function openFile(file, name) {
    if (!file || S.busy) return;
    if (file.type && !file.type.startsWith('image/')) return A.toast('That is not an image file.');
    try {
      const src = await decode(file);
      await begin(await toCanvas(src), name || (file.name || 'Photo').replace(/\.[^.]+$/, ''), null);
    } catch (e) { A.toast('Could not read that image. Try a JPG or PNG.'); }
  }
  const openSample = () => begin(A.sampleScene(), 'Sample scene', null);

  /* ---------- analyse ---------- */
  async function begin(canvas, name, id) {
    S.busy = true; S.photo = canvas; S.name = name; S.id = id; S.plans = {}; S.coachData = null; S.practice = false;
    S.rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const an = $('#anCanvas'), sc = Math.min(1, 700 / canvas.width);
    an.width = Math.round(canvas.width * sc); an.height = Math.round(canvas.height * sc);
    an.getContext('2d').drawImage(canvas, 0, 0, an.width, an.height);
    $('#anFrame').style.setProperty('--scan-h', Math.round(an.height * (Math.min(78 * innerWidth / 100, 360) / an.width) - 90) + 'px');
    $('#anBar').style.width = '0%'; $('#anTitle').textContent = 'Studying your photo';
    show('analyzing');
    const t0 = performance.now();
    try {
      const plan = await A.analyze(S.rgba.data, S.rgba.width, S.rgba.height, {
        level: S.level,
        onProgress: (p, label) => { $('#anBar').style.width = Math.round(p * 100) + '%'; $('#anSub').textContent = label; },
      });
      S.plans[S.level] = plan; S.plan = plan;
      const i = plan.insights;
      $('#anTitle').textContent = 'Lesson ready';
      $('#anSub').textContent = `${i.complexity} ${i.orientation} · ${i.contrast} contrast · ${plan.modes.sketch.steps.length} steps`;
      await wait(Math.max(500, 1500 - (performance.now() - t0)));
      enterStudio();
      consultCoach();
    } catch (e) {
      console.error(e); A.toast('Analysis failed. Try another photo.'); show('home');
    }
    S.busy = false;
  }

  async function replan(level) {
    S.level = level; A.pref.set('level', level);
    if (!S.plans[level]) {
      A.toast('Re-analysing…', 1200);
      S.plans[level] = await A.analyze(S.rgba.data, S.rgba.width, S.rgba.height, { level });
      if (S.coachData) A.coach.apply(S.plans[level], S.coachData);
    }
    S.plan = S.plans[level];
    const keep = Math.max(0, player.curStep);
    loadPlan(keep);
  }

  /* ---------- AI coach ---------- */
  async function consultCoach() {
    if (!A.coach.enabled() || S.coachData || S.coachBusy) return;
    S.coachBusy = true; $('#coachBtn').style.opacity = '.5';
    try {
      const data = await A.coach.consult(S.photo, S.plan, S.mode);
      S.coachData = data;
      for (const p of Object.values(S.plans)) A.coach.apply(p, data);
      renderInsights(); renderSteps(); onStep(player.curStep, player.steps[player.curStep], true);
      A.toast('AI coach tips added');
    } catch (e) { A.toast('AI coach: ' + (e.message || 'failed').slice(0, 80), 3600); }
    S.coachBusy = false; $('#coachBtn').style.opacity = '';
  }

  /* ---------- studio ---------- */
  function enterStudio() {
    $('#barTitle').textContent = S.name;
    $('#optGuides').checked = false;
    S.mode = 'sketch'; modeSeg.set('sketch', true); levelSeg2.set(S.level, true);
    show('studio');
    requestAnimationFrame(() => { layout(); loadPlan(0); player.setSpeed(1); setSpeedLabel(); sheet.snap('peek', true); setTimeout(() => player.play(), 450); });
    drawPip();
  }

  function loadPlan(stepIdx) {
    player.load(S.plan, S.mode);
    layout();
    renderTicks(); renderInsights(); renderSteps(); buildThumbs();
    if (stepIdx > 0) player.gotoStep(Math.min(stepIdx, player.steps.length - 1));
    if (S.practice) practice.setStep(Math.min(stepIdx, player.steps.length - 1), true);
    updateMeta();
  }

  function layout() {
    if (!S.plan) return;
    const stage = $('#stage'), capH = 148;
    const peek = sheet.metrics();
    document.documentElement.style.setProperty('--peek', (wide() ? 0 : peek) + 'px');
    document.documentElement.style.setProperty('--sheet-h', (innerHeight - 64) + 'px');
    sheet.enabled = !wide();
    if (wide()) sheet.setY(0); else if (!sheet.drag) sheet.metrics(), sheet.setY(sheet.d[sheet.state]);
    stage.style.paddingBottom = capH + 'px';
    const r = stage.getBoundingClientRect();
    const aw = r.width - 28, ah = r.height - capH - 12, asp = S.plan.aspect;
    let w = aw, h = w / asp;
    if (h > ah) { h = ah; w = h * asp; }
    w = Math.max(120, Math.floor(w)); h = Math.max(90, Math.floor(h));
    const paper = $('#paper'); paper.style.width = w + 'px'; paper.style.height = h + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    player.resize(w, h, dpr);
    if (practice && S.practice) practice.resize(w, h, dpr);
    const pc = $('#pipCanvas'); if (S.photo) { pc.width = 320; pc.height = Math.round(320 / asp); pc.getContext('2d').drawImage(S.photo, 0, 0, pc.width, pc.height); }
  }

  function drawPip() { const pc = $('#pipCanvas'), asp = S.photo.width / S.photo.height; pc.width = 360; pc.height = Math.round(360 / asp); pc.getContext('2d').drawImage(S.photo, 0, 0, pc.width, pc.height); }

  /* ---------- caption (live narration) ---------- */
  function typeText(el, text) {
    clearInterval(typer);
    if (reduce()) { el.textContent = text; return; }
    let i = 0; el.textContent = '';
    typer = setInterval(() => { i = Math.min(text.length, i + 2); el.textContent = text.slice(0, i); if (i >= text.length) clearInterval(typer); }, 14);
  }
  function onStep(i, step, silent) {
    if (!step) return;
    const n = player.steps.length;
    $('#capStep').textContent = `STEP ${i + 1} OF ${n}`;
    $('#capTool').textContent = step.tool ? '· ' + step.tool : '';
    $('#capTitle').textContent = step.title;
    $('#capAi').hidden = !step.ai;
    const tip = $('#capTip'); tip.classList.remove('score');
    typeText(tip, step.tip || '');
    const cap = $('#caption'); cap.classList.remove('swap'); void cap.offsetWidth; if (!silent) cap.classList.add('swap');
    $$('.step').forEach((el, k) => { el.classList.toggle('active', k === i); el.classList.toggle('done', k < i); });
    const act = $('.step.active'); if (act && sheet.state === 'full') act.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateMeta();
    if (S.voice && 'speechSynthesis' in window && (player.playing || S.practice)) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(step.title + '. ' + (step.tip || '')); u.rate = 1.05; speechSynthesis.speak(u); }
  }
  function updateMeta() {
    const i = Math.max(0, player.curStep), n = player.steps.length;
    $('#metaStep').textContent = `Step ${i + 1} of ${n}`;
    const f = player.T ? player.time / player.T : 0;
    $('#metaPct').textContent = Math.round(f * 100) + '%';
    const sc = $('#scrub'); sc.value = Math.round(f * 1000); sc.style.setProperty('--p', (f * 100).toFixed(1) + '%');
  }
  function renderTicks() {
    const t = $('#ticks'); t.innerHTML = '';
    player.steps.forEach((s, i) => { if (i) { const el = document.createElement('i'); el.style.left = (s.t0 / player.T) * 100 + '%'; t.appendChild(el); } });
  }

  /* ---------- sheet content ---------- */
  function renderInsights() {
    const p = S.plan, i = p.insights, el = $('#insights');
    const mats = S.mode === 'sketch'
      ? '<b>You will need:</b> 2H, HB, 2B and 4B pencils, a kneaded eraser, smooth paper.'
      : `<b>You will need:</b> a flat brush, a round brush, a rigger, and paint in ${i.palette.slice(0, 4).map((c) => c.name).join(', ')} plus white.`;
    const coach = p.coach
      ? `<div class="coach-box"><b>${esc(p.coach.subject)}</b>${esc(p.coach.composition)}${p.coach.watch_out.length ? '<ul>' + p.coach.watch_out.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul>' : ''}</div>`
      : `<button class="btn text small" id="coachAdd" data-press>${A.coach.hasKey() ? 'Ask the AI coach' : 'Add an AI coach for subject-specific tips'}</button>`;
    el.innerHTML = `
      <div class="chips"><span class="chip">${i.orientation} ${i.aspect}</span><span class="chip">${i.tone}</span><span class="chip">${i.contrast} contrast</span><span class="chip">${i.complexity}</span></div>
      <div class="sum">${esc(i.summary)}</div>
      <div class="vbar"><i style="width:${i.values.dark}%;background:#2c2c2e"></i><i style="width:${i.values.mid}%;background:#8e8e93"></i><i style="width:${i.values.light}%;background:#e5e5ea"></i></div>
      <div class="vleg"><span>Darks ${i.values.dark}%</span><span>Mids ${i.values.mid}%</span><span>Lights ${i.values.light}%</span></div>
      <div class="swatches">${i.palette.slice(0, 5).map((c) => `<span class="sw"><i style="background:${c.hex}"></i>${c.name} ${c.pct}%</span>`).join('')}</div>
      <div class="mats">${mats}</div>${coach}`;
    const add = $('#coachAdd'); if (add) add.onclick = () => (A.coach.hasKey() ? (A.pref.set('coachOn', true), consultCoach()) : openModal());
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderSteps() {
    const box = $('#steps'); box.innerHTML = '';
    player.steps.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'step'; b.dataset.press = ''; b.setAttribute('data-press', '');
      b.innerHTML = `<span class="ph"></span><span><div class="st-t">${i + 1}. ${esc(s.title)}</div><div class="st-s">${esc(s.tool || '')}</div></span><span class="st-n">${s.strokes.length}</span>`;
      b.onclick = () => {
        A.buzz();
        if (S.practice) { practice.setStep(i); onStep(i, player.steps[i]); player.gotoStep(i); return; }
        player.gotoStep(i); player.play(); sheet.snap('peek');
      };
      box.appendChild(b);
    });
    thumbs.forEach((c, i) => { const ph = $$('.step .ph')[i]; if (ph && c) ph.replaceWith(c); });
    onStepClasses();
  }
  function onStepClasses() { $$('.step').forEach((el, k) => { el.classList.toggle('active', k === player.curStep); el.classList.toggle('done', k < player.curStep); }); }

  let thumbToken = 0;
  async function buildThumbs() {
    const tok = ++thumbToken, W = 152, H = Math.round(W / S.plan.aspect);
    thumbs = [];
    const layers = { guide: null, construct: null, main: null };
    for (const k in layers) { const c = document.createElement('canvas'); c.width = W; c.height = H; layers[k] = c; }
    const faded = new Set();
    for (let si = 0; si < player.steps.length; si++) {
      await wait(0); if (tok !== thumbToken) return;
      const st = player.steps[si];
      for (const s of st.strokes) A.paintStroke(layers[s.l].getContext('2d'), { s }, W, H, 1);
      for (const f of st.fade || []) faded.add(f);
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      for (const k of ['guide', 'construct', 'main']) if (!faded.has(k)) g.drawImage(layers[k], 0, 0);
      thumbs[si] = out;
      const ph = $$('.step')[si]; if (ph) { const old = ph.firstElementChild; if (old && old !== out) old.replaceWith(out); }
    }
  }

  /* ---------- transport wiring ---------- */
  const SPEEDS = [0.5, 1, 2, 4, 8, 16];
  const setSpeedLabel = () => { $('#speedBtn').textContent = player.speed + '×'; };
  function setPlayIcon(on) { const b = $('#playBtn'); A.setIcon(b.firstElementChild, on ? 'pause' : 'play'); b.setAttribute('aria-label', on ? 'Pause' : 'Play'); }

  function exitPractice() {
    if (!S.practice) return;
    S.practice = false; practice.stop(); $('#practiceTop').classList.remove('active');
    $('#tools').hidden = true; $('#practiceDock').hidden = true; $('#transport').hidden = false;
    $('#practiceBtn').lastChild.textContent = 'Draw along (practice mode)';
    player.seek(player.time);
  }
  function enterPractice() {
    player.pause(); S.practice = true; $('#practiceTop').classList.add('active');
    $('#tools').hidden = false; $('#practiceDock').hidden = false; $('#transport').hidden = true;
    $('#practiceBtn').lastChild.textContent = 'Back to watching';
    layout(); practice.start(Math.max(0, player.curStep));
    onStep(practice.step, player.steps[practice.step]);
    sheet.snap('peek');
    A.toast('Draw over the blue guide, then tap “Check my step”', 3200);
  }

  /* ---------- export / save ---------- */
  async function deliver(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Atelier' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function savePng() {
    const src = S.practice ? mergePractice() : player.exportCanvas(2000);
    src.toBlob((b) => b && deliver(b, `atelier-${slug(S.name)}.png`), 'image/png');
  }
  function mergePractice() {
    const c = document.createElement('canvas'); c.width = practice.W; c.height = practice.H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(practice.inkAll, 0, 0); g.drawImage(practice.inkStep, 0, 0); return c;
  }
  const slug = (s) => (s || 'drawing').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drawing';
  async function saveVideo() {
    if (S.practice) exitPractice();
    A.toast('Recording the time-lapse… keep this screen open', 4000);
    const blob = await player.record(6, (f) => { $('#metaPct').textContent = Math.round(f * 100) + '%'; });
    if (!blob) return A.toast('Video recording is not supported in this browser.');
    await deliver(blob, `atelier-${slug(S.name)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
    player.seek(player.T); setPlayIcon(false);
  }
  async function saveLesson() {
    const photo = await new Promise((r) => S.photo.toBlob(r, 'image/jpeg', 0.88));
    const th = document.createElement('canvas'); th.width = 256; th.height = Math.round(256 / S.plan.aspect); th.getContext('2d').drawImage(S.photo, 0, 0, th.width, th.height);
    S.id = S.id || A.uid();
    const ok = await A.projects.put({ id: S.id, name: S.name, photo, thumb: th.toDataURL('image/jpeg', 0.7), level: S.level });
    A.toast(ok ? 'Lesson saved to Recent' : 'Could not save on this device'); renderRecent();
  }

  /* ---------- recent ---------- */
  async function renderRecent() {
    const list = await A.projects.list(), box = $('#recent');
    $('#recentWrap').hidden = !list.length; box.innerHTML = '';
    for (const p of list) {
      const b = document.createElement('button'); b.className = 'rc'; b.setAttribute('data-press', '');
      b.innerHTML = `<div class="rc-img" style="background-image:url(${p.thumb})"></div><div class="rc-name">${esc(p.name)}</div>`;
      let held = false, timer = 0;
      b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(async () => { held = true; if (confirm(`Delete “${p.name}” from Recent?`)) { await A.projects.remove(p.id); renderRecent(); } }, 650); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => b.addEventListener(t, () => clearTimeout(timer)));
      b.onclick = async () => { if (held) return; S.level = p.level || S.level; levelSeg.set(S.level, true); const bmp = await decode(p.photo); begin(await toCanvas(bmp), p.name, p.id); };
      box.appendChild(b);
    }
  }

  /* ---------- modal ---------- */
  function openModal() { $('#keyInput').value = A.pref.get('apiKey', ''); $('#coachOn').checked = A.pref.get('coachOn', true); $('#modelInput').value = A.pref.get('model', ''); $('#modal').hidden = false; }
  const closeModal = () => { $('#modal').hidden = true; };

  /* ---------- init ---------- */
  let levelSeg, levelSeg2, modeSeg;
  function init() {
    A.hydrateIcons(document); A.initPress();
    $('.logo').innerHTML = A.LOGO; $('#dropArt').innerHTML = A.DROPART; $('#dropArt').style.color = 'var(--label)';
    player = new A.Player($('#cv'));
    practice = new A.Practice({ paper: $('#paper'), player, ghost: $('#ghost'), inkAll: $('#inkAll'), inkStep: $('#inkStep') });
    sheet = new A.Sheet($('#sheet'), $('#sheetHead'), $('#sheetBody'), () => {});

    levelSeg = A.Seg($('#levelSeg'), (v) => { S.level = v; A.pref.set('level', v); $('#levelHint').textContent = LEVEL_HINT[v]; });
    levelSeg.set(S.level, true); $('#levelHint').textContent = LEVEL_HINT[S.level];
    levelSeg2 = A.Seg($('#levelSeg2'), (v) => replan(v));
    modeSeg = A.Seg($('#modeSeg'), (v) => { S.mode = v; if (S.practice) exitPractice(); player.setSpeed(v === 'paint' ? 4 : 1); setSpeedLabel(); loadPlan(0); player.seek(0); player.play(); });

    /* home inputs */
    $('#pickBtn').onclick = () => $('#file').click(); $('#camBtn').onclick = () => $('#fileCam').click(); $('#sampleBtn').onclick = openSample;
    $('#file').onchange = (e) => { openFile(e.target.files[0]); e.target.value = ''; };
    $('#fileCam').onchange = (e) => { openFile(e.target.files[0], 'Camera photo'); e.target.value = ''; };
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }));
    window.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });
    window.addEventListener('paste', (e) => { const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/')); if (it) openFile(it.getAsFile(), 'Pasted image'); });

    /* studio controls */
    $('#backBtn').onclick = () => { player.pause(); exitPractice(); speechSynthesis && speechSynthesis.cancel(); show('home'); renderRecent(); };
    $('#playBtn').onclick = () => { if (S.practice) return; player.toggle(); };
    $('#prevBtn').onclick = () => { const i = player.curStep; (player.time - player.steps[i].t0 > 1.5 || i === 0) ? player.gotoStep(i) : player.gotoStep(i - 1); };
    $('#nextBtn').onclick = () => player.gotoStep(player.curStep + 1);
    $('#speedBtn').onclick = () => { const k = SPEEDS.indexOf(player.speed); player.setSpeed(SPEEDS[(k + 1) % SPEEDS.length]); setSpeedLabel(); };
    const sc = $('#scrub'); let was = false;
    sc.addEventListener('pointerdown', () => { was = player.playing; player.pause(); });
    sc.addEventListener('input', () => player.seekFrac(sc.value / 1000));
    ['pointerup', 'pointercancel'].forEach((t) => sc.addEventListener(t, () => { if (was) player.play(); was = false; }));
    $('#caption').addEventListener('click', () => $('#caption').classList.toggle('open'));
    $('#refBtn').onclick = () => { const p = $('#pip'); p.hidden = !p.hidden; };
    $('#coachBtn').onclick = () => (A.coach.hasKey() && A.pref.get('coachOn', true) ? (S.coachData ? A.toast('AI coach tips are already on') : consultCoach()) : openModal());
    $('#practiceBtn').onclick = $('#practiceTop').onclick = () => (S.practice ? exitPractice() : enterPractice());
    $('#optGuides').onchange = (e) => player.setKeepGuides(e.target.checked);
    $('#optTool').onchange = (e) => { player.showTool = e.target.checked; player.render(); };
    $('#optVoice').onchange = (e) => { S.voice = e.target.checked; if (!S.voice && 'speechSynthesis' in window) speechSynthesis.cancel(); };
    $('#savePng').onclick = savePng; $('#saveVideo').onclick = saveVideo; $('#saveLesson').onclick = saveLesson;

    /* practice tools */
    $$('[data-tool]').forEach((b) => b.onclick = () => { practice.setTool(b.dataset.tool); $$('[data-tool]').forEach((x) => x.classList.toggle('active', x === b)); });
    $('#undoBtn').onclick = () => practice.undo(); $('#clearBtn').onclick = () => practice.clearStep();
    $('#pCheck').onclick = () => { const r = practice.check(); const t = $('#capTip'); clearInterval(typer); t.textContent = r.msg; t.classList.add('score'); $('#caption').classList.add('open'); A.buzz(r.score >= 65 ? 14 : 6); };
    $('#pPrev').onclick = () => { practice.setStep(practice.step - 1); onStep(practice.step, player.steps[practice.step]); player.gotoStep(practice.step); };
    $('#pNext').onclick = () => { practice.setStep(practice.step + 1); onStep(practice.step, player.steps[practice.step]); player.gotoStep(practice.step); };

    /* PiP: direct manipulation, springs home to the nearest corner */
    const pip = $('#pip'); let pd = null;
    pip.addEventListener('pointerdown', (e) => { const r = pip.getBoundingClientRect(); pd = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, m: false }; pip.setPointerCapture(e.pointerId); });
    pip.addEventListener('pointermove', (e) => { if (!pd) return; const dx = e.clientX - pd.x, dy = e.clientY - pd.y; if (!pd.m && Math.hypot(dx, dy) < 5) return; pd.m = true; const sr = $('#stage').getBoundingClientRect(); pip.style.transition = 'none'; pip.style.right = 'auto'; pip.style.left = pd.l - sr.left + dx + 'px'; pip.style.top = pd.t - sr.top + dy + 'px'; });
    pip.addEventListener('pointerup', () => {
      if (!pd) return; const moved = pd.m; pd = null;
      if (!moved) { pip.classList.toggle('big'); return; }
      const sr = $('#stage').getBoundingClientRect(), r = pip.getBoundingClientRect();
      const left = r.left + r.width / 2 < sr.left + sr.width / 2, top = r.top + r.height / 2 < sr.top + sr.height / 2;
      pip.style.transition = 'left .5s cubic-bezier(.34,1.5,.64,1), top .5s cubic-bezier(.34,1.5,.64,1)';
      pip.style.left = left ? '14px' : sr.width - r.width - 14 + 'px'; pip.style.top = top ? '14px' : sr.height - r.height - 160 + 'px';
    });

    /* modal */
    $('#settingsBtn').onclick = openModal; $('#mClose').onclick = closeModal; $('#scrim').onclick = closeModal;
    $('#keySave').onclick = () => { A.pref.set('apiKey', $('#keyInput').value.trim()); A.pref.set('coachOn', $('#coachOn').checked); A.pref.set('model', $('#modelInput').value.trim()); closeModal(); A.toast('Saved'); if (S.plan) { renderInsights(); consultCoach(); } };
    $('#keyClear').onclick = () => { A.pref.del('apiKey'); $('#keyInput').value = ''; S.coachData = null; A.toast('Key removed'); };

    /* player events */
    player.on('step', onStep).on('tick', updateMeta).on('state', setPlayIcon);
    player.on('step', () => onStepClasses());
    window.addEventListener('resize', () => { clearTimeout(init.rt); init.rt = setTimeout(layout, 80); });
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input')) return;
      if (e.code === 'Space' && !$('#studio').hidden && !S.practice) { e.preventDefault(); player.toggle(); }
      if (e.code === 'ArrowRight') $('#nextBtn').click(); if (e.code === 'ArrowLeft') $('#prevBtn').click();
    });
    renderRecent();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.__atelier = { S, openSample }; // handy for debugging / tests
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
