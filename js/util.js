export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function roundTo(v, res) {
  const r = Math.round(v / res) * res;
  return Math.abs(r) < res / 2 ? 0 : parseFloat(r.toFixed(decimalsOf(res)));
}

export function decimalsOf(res) {
  const s = String(res);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export function fmt(v, res) {
  return roundTo(v, res).toFixed(decimalsOf(res));
}

export function pad(n, w = 2, ch = '0') {
  return String(n).padStart(w, ch);
}

export const store = {
  get(key, def) {
    try {
      const v = localStorage.getItem('gdt.' + key);
      return v == null ? def : JSON.parse(v);
    } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('gdt.' + key, JSON.stringify(val)); } catch { /* storage unavailable */ }
  },
};

export function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
