/* Everything persistent lives in localStorage — no backend, no accounts. */
import { LS, CFG } from './config.js';

const read = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { return false; } // private mode / quota
};

/* ---- search history ---- */
export const getHistory = () => read(LS.HISTORY, []);

export function pushHistory(entry) {
  const list = getHistory();
  // Same spot within ~11m counts as a revisit: move it to the top instead of duplicating.
  const near = (a, b) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
  const deduped = list.filter(e => !near(e, entry));
  deduped.unshift({ ...entry, ts: Date.now() });
  write(LS.HISTORY, deduped.slice(0, CFG.MAX_HISTORY));
  return getHistory();
}

export function removeHistory(ts) {
  write(LS.HISTORY, getHistory().filter(e => e.ts !== ts));
  return getHistory();
}
export const clearHistory = () => { write(LS.HISTORY, []); return []; };

/* ---- pinned palettes ---- */
export const getPinned = () => read(LS.PINNED, []);
export function togglePin(item) {
  const list = getPinned();
  const i = list.findIndex(p => p.id === item.id);
  if (i >= 0) list.splice(i, 1); else list.unshift(item);
  write(LS.PINNED, list.slice(0, 100));
  return getPinned();
}
export const isPinned = id => getPinned().some(p => p.id === id);

/* ---- settings + optional Google key ---- */
export const getSettings = () => read(LS.SETTINGS, { useGoogle: false, highRes: true });
export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(LS.SETTINGS, next);
  return next;
}
export const getGoogleKey = () => { try { return localStorage.getItem(LS.GKEY) || ''; } catch { return ''; } };
export function setGoogleKey(k) {
  try { k ? localStorage.setItem(LS.GKEY, k.trim()) : localStorage.removeItem(LS.GKEY); } catch {}
  return getGoogleKey();
}

export function exportAll() {
  return JSON.stringify({ history: getHistory(), pinned: getPinned(), settings: getSettings() }, null, 2);
}
