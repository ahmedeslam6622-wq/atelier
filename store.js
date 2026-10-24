/* Atelier — store.js
 * Tiny persistence layer. Projects (photo + settings) live in IndexedDB; plans are
 * recomputed from the photo (deterministic, ~200 ms), so nothing derived is stored.
 * Preferences use localStorage; every access is guarded because storage can be
 * unavailable (private windows, blocked site data).
 */
(function (root) {
  'use strict';
  const A = (root.Atelier = root.Atelier || {});

  const pref = {
    get(k, d) { try { const v = localStorage.getItem('atelier.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('atelier.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('atelier.' + k); } catch (e) { /* ignore */ } },
  };
  A.pref = pref;

  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!root.indexedDB) return rej(new Error('no indexedDB'));
      const rq = indexedDB.open('atelier', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('projects', { keyPath: 'id' });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return dbp;
  }
  const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('projects', mode), r = fn(t.objectStore('projects'));
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error);
  }));

  A.projects = {
    async list() { try { const all = (await tx('readonly', (s) => s.getAll())) || []; return all.sort((a, b) => b.updated - a.updated); } catch (e) { return []; } },
    async put(p) { try { p.updated = Date.now(); await tx('readwrite', (s) => s.put(p)); return true; } catch (e) { return false; } },
    async remove(id) { try { await tx('readwrite', (s) => s.delete(id)); return true; } catch (e) { return false; } },
  };
  A.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
})(window);
