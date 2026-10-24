/* Atelier — coach.js
 * Optional "AI coach" using the Google Gemini API. The on-device engine already produces a
 * complete lesson; with your own Gemini key the photo is also sent to Google, which writes tips
 * that mention what is actually in the picture. The key stays in this browser. Without a key
 * nothing here runs.
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});
  const MODEL = 'gemini-flash-latest'; // Google's rolling alias; editable in settings

  function toJpegBase64(canvas, maxSide) {
    const sc = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * sc); c.height = Math.round(canvas.height * sc);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  }

  A.coach = {
    hasKey() { return !!A.pref.get('apiKey', ''); },
    enabled() { return this.hasKey() && A.pref.get('coachOn', true); },

    /** Returns { subject, composition, watch_out[], steps:{id:tip} } or throws. */
    async consult(photoCanvas, plan, mode) {
      const key = A.pref.get('apiKey', '');
      if (!key) throw new Error('No API key');
      // both lessons at once, so switching Sketch <-> Paint later needs no second request
      const steps = ['sketch', 'paint'].flatMap((m) => plan.modes[m].steps.map((s) => ({ id: s.id, mode: m, title: s.title, tool: s.tool })));
      const ins = plan.insights;
      const prompt =
        `You are a warm, precise drawing teacher. A student uploaded this reference photo and will draw it either as a pencil sketch or as a painting, ` +
        `following one of these two step lists in order:\n${JSON.stringify(steps)}\n\n` +
        `Computer-vision facts already measured: ${ins.summary} Value split: ${ins.values.dark}% dark, ${ins.values.mid}% mid, ${ins.values.light}% light.\n\n` +
        `Reply with ONLY a JSON object (no markdown) of this shape:\n` +
        `{"subject":"one short sentence naming what is in the photo","composition":"one sentence of composition advice","watch_out":["2-3 common mistakes for THIS subject"],"steps":{"<step id>":"1-2 sentence tip that refers to the actual content of the photo and the step's technique"}}\n` +
        `Include every step id. Be concrete (name shapes, objects, where they sit), no fluff.`;
      const model = A.pref.get('model', MODEL) || MODEL;
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: 'image/jpeg', data: toJpegBase64(photoCanvas, 900) } },
            { text: prompt },
          ] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2400, temperature: 0.7 },
        }),
      });
      if (!res.ok) {
        let msg = res.status + '';
        try { msg = (await res.json()).error.message || msg; } catch (e) { /* ignore */ }
        throw new Error(msg);
      }
      const data = await res.json();
      const text = ((data.candidates && data.candidates[0] && data.candidates[0].content.parts) || []).map((x) => x.text || '').join('');
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Unreadable coach reply');
      const out = JSON.parse(m[0]);
      if (!out.steps || typeof out.steps !== 'object') throw new Error('Coach reply had no steps');
      return out;
    },

    /** Merge the coach's text into a plan (keeps the local text as a fallback). */
    apply(plan, coach) {
      plan.coach = { subject: coach.subject || '', composition: coach.composition || '', watch_out: Array.isArray(coach.watch_out) ? coach.watch_out : [] };
      for (const mode of ['sketch', 'paint']) {
        for (const st of plan.modes[mode].steps) {
          const t = coach.steps && coach.steps[st.id];
          if (typeof t === 'string' && t.trim()) { st.tipLocal = st.tipLocal || st.tip; st.tip = t.trim(); st.ai = true; }
        }
      }
    },
  };
})(window);
