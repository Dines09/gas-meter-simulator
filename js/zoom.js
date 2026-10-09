// Pinch / wheel / double-tap zoom and one-finger pan for the training stage.
// Gestures only start on "background" (not on keys, knobs, buttons or tube ends), so
// two-finger key combinations on the meter keep working.
import { clamp } from './util.js';

const MIN = 1, MAX = 4;
const INTERACTIVE = '.dev-key, .tap, button, select, a, input, .cyl-chips, .zoom-ui, .toast';

export class Zoom {
  constructor(app, stage, layers, ui) {
    this.app = app;
    this.stage = stage;
    this.layers = layers;
    this.ui = ui;
    this.s = 1; this.tx = 0; this.ty = 0;
    this.pts = new Map();
    this.g = null;
    this.lastTap = null;

    stage.addEventListener('pointerdown', e => this.down(e));
    stage.addEventListener('pointermove', e => this.move(e));
    stage.addEventListener('pointerup', e => this.up(e));
    stage.addEventListener('pointercancel', e => this.up(e));
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.local(e);
      this.zoomAt(p.x, p.y, this.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });

    ui.querySelector('[data-z=in]').onclick = () => this.zoomCenter(this.s * 1.4);
    ui.querySelector('[data-z=out]').onclick = () => this.zoomCenter(this.s / 1.4);
    ui.querySelector('[data-z=fit]').onclick = () => this.set(1, 0, 0);
    this.label = ui.querySelector('[data-z=lbl]');
    this.label.onclick = () => this.set(1, 0, 0);
    window.addEventListener('resize', () => { this.set(this.s, this.tx, this.ty); this.render(); });
    this.render();
  }

  local(e) {
    const r = this.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  size() { return { W: this.stage.clientWidth, H: this.stage.clientHeight }; }

  set(s, tx, ty) {
    s = clamp(s, MIN, MAX);
    const { W, H } = this.size();
    tx = clamp(tx, W - W * s, 0);
    ty = clamp(ty, H - H * s, 0);
    if (s === this.s && tx === this.tx && ty === this.ty && this.rendered) return;
    this.app.tubes.setView(s, tx, ty);
    this.s = s; this.tx = tx; this.ty = ty;
    this.render();
  }

  // keep the world point under (x, y) fixed while scaling
  zoomAt(x, y, s) {
    s = clamp(s, MIN, MAX);
    const wx = (x - this.tx) / this.s, wy = (y - this.ty) / this.s;
    this.set(s, x - wx * s, y - wy * s);
  }

  zoomCenter(s) {
    const { W, H } = this.size();
    this.zoomAt(W / 2, H / 2, s);
  }

  render() {
    this.rendered = true;
    const { s, tx, ty } = this;
    for (const el of this.layers) {
      el.style.transformOrigin = '0 0';
      el.style.transform = s === 1 ? '' : `translate(${tx + (s - 1) * el.offsetLeft}px, ${ty + (s - 1) * el.offsetTop}px) scale(${s})`;
    }
    this.label.textContent = `${Math.round(s * 100)}%`;
    this.ui.classList.toggle('zoomed', s > 1.001);
  }

  down(e) {
    if (e.target.closest && e.target.closest(INTERACTIVE)) return;
    const p = this.local(e);
    this.pts.set(e.pointerId, p);
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.startGesture();
    this.tapStart = { x: p.x, y: p.y, t: performance.now(), id: e.pointerId };
  }

  startGesture() {
    const P = [...this.pts.values()];
    if (P.length >= 2) {
      const [a, b] = P;
      this.g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s0: this.s, tx0: this.tx, ty0: this.ty };
    } else if (P.length === 1) {
      this.g = { type: 'pan', p0: P[0], tx0: this.tx, ty0: this.ty };
    } else this.g = null;
  }

  move(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.set(e.pointerId, this.local(e));
    const P = [...this.pts.values()];
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch' && P.length >= 2) {
      const [a, b] = P;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = clamp(g.s0 * d / g.d0, MIN, MAX);
      const wx = (g.m0.x - g.tx0) / g.s0, wy = (g.m0.y - g.ty0) / g.s0;
      this.set(s, m.x - wx * s, m.y - wy * s);
    } else if (g.type === 'pan' && this.s > 1) {
      const p = P[0];
      this.set(this.s, g.tx0 + p.x - g.p0.x, g.ty0 + p.y - g.p0.y);
    }
  }

  up(e) {
    if (!this.pts.has(e.pointerId)) return;
    const p = this.local(e);
    this.pts.delete(e.pointerId);
    // double tap on background toggles zoom
    const ts = this.tapStart;
    if (ts && ts.id === e.pointerId && performance.now() - ts.t < 250 && Math.hypot(p.x - ts.x, p.y - ts.y) < 12 && this.pts.size === 0) {
      const now = performance.now();
      if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 40) {
        if (this.s > 1.05) this.set(1, 0, 0);
        else this.zoomAt(p.x, p.y, 2.2);
        this.lastTap = null;
      } else this.lastTap = { x: p.x, y: p.y, t: now };
    }
    this.startGesture();
  }
}
