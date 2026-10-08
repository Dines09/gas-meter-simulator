import { clamp } from './util.js';

// Flexible sampling tubes: verlet rope physics + drag-and-drop between ports.

const N = 26;           // particles per tube
const ITER = 22;        // constraint iterations
const GRAVITY = 1500;   // px/s^2
const END_R = 30;       // grab radius for tube ends (px)
const PORT_R = 26;      // grab radius for empty ports (px)
const SNAP_R = 44;      // snap radius when dropping
const MAX_TUBES = 3;
const COLORS = [
  ['rgba(236,222,178,0.93)', 'rgba(140,120,70,0.9)'],
  ['rgba(196,226,240,0.93)', 'rgba(80,120,140,0.9)'],
  ['rgba(220,220,220,0.93)', 'rgba(110,110,110,0.9)'],
];

export class Tubes {
  constructor(app, stage, canvas) {
    this.app = app;
    this.stage = stage;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ports = new Map();
    this.tubes = [];
    this.drag = null;
    this.hover = null;
    this.hlPorts = new Set();
    this.W = 1; this.H = 1; this.dpr = 1;
    this.t = 0;
    stage.addEventListener('pointerdown', e => this.onDown(e), true);
    stage.addEventListener('pointermove', e => this.onMove(e), true);
    stage.addEventListener('pointerup', e => this.onUp(e), true);
    stage.addEventListener('pointercancel', e => this.onUp(e), true);
  }

  // a solid body (the meter) that hoses must hang around, never across
  setObstacle(el) { this.obstacleEl = el; }

  registerPort(id, el, dir) {
    const old = this.ports.get(id);
    this.ports.set(id, { id, el, dir, x: old?.x ?? 0, y: old?.y ?? 0 });
  }

  layout() {
    const r = this.stage.getBoundingClientRect();
    this.ox = r.left; this.oy = r.top;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (Math.round(r.width) !== this.W || Math.round(r.height) !== this.H || dpr !== this.dpr) {
      this.W = Math.round(r.width); this.H = Math.round(r.height); this.dpr = dpr;
      this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
      this.tubeLen = clamp(Math.max(this.W, this.H) * 0.7, 320, 820);
      for (const t of this.tubes) t.seg = this.tubeLen / (N - 1);
    }
    this.ob = null;
    if (this.obstacleEl && this.obstacleEl.isConnected) {
      const b = this.obstacleEl.getBoundingClientRect();
      const m = 6;
      this.ob = { x0: b.left - r.left - m, y0: b.top - r.top - m, x1: b.right - r.left + m, y1: b.bottom - r.top + m };
    }
    for (const p of this.ports.values()) {
      if (!p.el || !p.el.isConnected) { p.gone = true; continue; }
      p.gone = false;
      const b = p.el.getBoundingClientRect();
      p.x = b.left + b.width / 2 - r.left;
      p.y = b.top + b.height / 2 - r.top;
    }
  }

  local(e) { return { x: e.clientX - this.ox, y: e.clientY - this.oy }; }

  tubeAt(port) { return this.tubes.find(t => t.ends[0].port === port || t.ends[1].port === port); }

  // other end of the tube attached to `port`: port id, 'free', or null (no tube)
  peer(port) {
    const t = this.tubeAt(port);
    if (!t) return null;
    const i = t.ends[0].port === port ? 1 : 0;
    return t.ends[i].port || 'free';
  }

  linked(a, b) { return this.peer(a) === b; }

  reset() {
    this.tubes = [];
    this.drag = null;
  }

  endPos(t, i) {
    return i === 0 ? t.pts[0] : t.pts[N - 1];
  }

  anchorOf(port) {
    const p = this.ports.get(port);
    return { x: p.x + p.dir[0] * 2, y: p.y + p.dir[1] * 2, dir: p.dir };
  }

  newTube(port, x, y) {
    const a = this.anchorOf(port);
    const used = new Set(this.tubes.map(t => t.color));
    const color = COLORS.findIndex((_, i) => !used.has(i));
    const t = { color: color < 0 ? 0 : color, seg: this.tubeLen / (N - 1), pts: [], ends: [{ port }, { port: null }] };
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const px = a.x + (x - a.x) * f, py = a.y + (y - a.y) * f + Math.sin(f * Math.PI) * 30;
      t.pts.push({ x: px, y: py, px, py });
    }
    this.tubes.push(t);
    return t;
  }

  freePortNear(x, y, r, exceptPort) {
    let best = null, bd = r;
    for (const p of this.ports.values()) {
      if (p.gone || p.id === exceptPort || this.tubeAt(p.id)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  onDown(e) {
    if (this.drag) return;
    this.layout();
    const { x, y } = this.local(e);
    // grab an existing tube end
    let best = null, bd = END_R;
    for (const t of this.tubes) {
      for (const i of [0, 1]) {
        const p = this.endPos(t, i);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = { t, i }; }
      }
    }
    if (!best) {
      const port = this.freePortNear(x, y, PORT_R);
      if (port) {
        if (this.tubes.length >= MAX_TUBES) {
          this.app.toast('All tubes are in use. Drag the end of an existing tube.');
          return;
        }
        const t = this.newTube(port.id, x, y);
        best = { t, i: 1 };
      }
    }
    if (!best) return;
    e.preventDefault();
    e.stopPropagation();
    this.app.audioUnlock();
    const end = best.t.ends[best.i];
    if (end.port) {
      end.port = null;
      this.app.onTubesChanged();
    }
    this.drag = { t: best.t, i: best.i, id: e.pointerId, x, y };
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  onMove(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    e.preventDefault();
    const { x, y } = this.local(e);
    this.drag.x = clamp(x, 4, this.W - 4);
    this.drag.y = clamp(y, 4, this.H - 4);
    const other = this.drag.t.ends[1 - this.drag.i].port;
    this.hover = this.freePortNear(this.drag.x, this.drag.y, SNAP_R, other);
  }

  onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const { t, i } = this.drag;
    const other = t.ends[1 - i].port;
    const port = this.freePortNear(this.drag.x, this.drag.y, SNAP_R, other);
    if (port) {
      t.ends[i].port = port.id;
      this.app.buzzer.click();
      if (navigator.vibrate) { try { navigator.vibrate(18); } catch { /* ignore */ } }
      this.app.onTubesChanged(port.id);
    }
    this.drag = null;
    this.hover = null;
  }

  pinned(t, i) {
    const end = t.ends[i];
    if (end.port) {
      const p = this.ports.get(end.port);
      if (!p || p.gone) { end.port = null; return null; }
      return this.anchorOf(end.port);
    }
    if (this.drag && this.drag.t === t && this.drag.i === i) return { x: this.drag.x, y: this.drag.y, dir: null };
    return null;
  }

  step(dt) {
    this.t += dt;
    dt = Math.min(dt, 1 / 30);
    const floor = this.H - 5;
    for (const t of this.tubes) {
      const P = t.pts;
      for (let k = 0; k < N; k++) {
        const p = P[k];
        const vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
        p.px = p.x; p.py = p.y;
        p.x += vx;
        p.y += vy + GRAVITY * dt * dt;
      }
      const pin0 = this.pinned(t, 0), pin1 = this.pinned(t, 1);
      for (let it = 0; it < ITER; it++) {
        for (let k = 0; k < N - 1; k++) {
          const a = P[k], b = P[k + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-4;
          const diff = (d - t.seg) / d * 0.5;
          a.x += dx * diff; a.y += dy * diff;
          b.x -= dx * diff; b.y -= dy * diff;
        }
        this.applyPin(P, 0, 1, pin0, t.seg);
        this.applyPin(P, N - 1, N - 2, pin1, t.seg);
        if (this.ob) {
          const o = this.ob;
          for (let q = 2; q < N - 2; q++) {
            const p = P[q];
            if (p.x > o.x0 && p.x < o.x1 && p.y > o.y0 && p.y < o.y1) {
              const dl = p.x - o.x0, dr = o.x1 - p.x, dt = p.y - o.y0, db = o.y1 - p.y;
              const mn = Math.min(dl, dr, dt, db);
              if (mn === dr) p.x = o.x1; else if (mn === dl) p.x = o.x0; else if (mn === db) p.y = o.y1; else p.y = o.y0;
            }
          }
        }
        for (const p of P) {
          if (p.y > floor) { p.y = floor; p.px = p.x - (p.x - p.px) * 0.6; }
          if (p.x < 3) p.x = 3;
          if (p.x > this.W - 3) p.x = this.W - 3;
        }
      }
    }
  }

  applyPin(P, i, j, pin, seg) {
    if (!pin) return;
    P[i].x = pin.x; P[i].y = pin.y;
    if (pin.dir) {
      P[j].x = pin.x + pin.dir[0] * seg * 0.9;
      P[j].y = pin.y + pin.dir[1] * seg * 0.9;
    }
  }

  draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);

    // port hints
    const dragging = !!this.drag;
    for (const p of this.ports.values()) {
      if (p.gone) continue;
      const hl = this.hlPorts.has(p.id);
      if (this.tubeAt(p.id)) {
        if (hl && !dragging) {
          const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
          c.beginPath(); c.arc(p.x, p.y, 16 + pulse * 6, 0, Math.PI * 2);
          c.strokeStyle = `rgba(255,210,63,${0.55 + pulse * 0.45})`; c.lineWidth = 3; c.stroke();
        }
        continue;
      }
      if (!dragging && !hl) {
        c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.5; c.stroke();
        continue;
      }
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
      c.beginPath(); c.arc(p.x, p.y, hl ? 13 + pulse * 6 : 12, 0, Math.PI * 2);
      c.strokeStyle = hl ? `rgba(255,210,63,${0.55 + pulse * 0.45})` : 'rgba(120,200,255,0.5)';
      c.lineWidth = hl ? 3 : 2;
      c.setLineDash(dragging && this.hover !== p ? [4, 4] : []);
      c.stroke();
      c.setLineDash([]);
      if (this.hover === p) {
        c.beginPath(); c.arc(p.x, p.y, 18, 0, Math.PI * 2);
        c.fillStyle = 'rgba(80,220,140,0.25)'; c.fill();
      }
    }

    for (const t of this.tubes) this.drawTube(t);
  }

  path(P) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(P[0].x, P[0].y);
    for (let k = 1; k < P.length - 1; k++) {
      const mx = (P[k].x + P[k + 1].x) / 2, my = (P[k].y + P[k + 1].y) / 2;
      c.quadraticCurveTo(P[k].x, P[k].y, mx, my);
    }
    c.lineTo(P[P.length - 1].x, P[P.length - 1].y);
  }

  drawTube(t) {
    const c = this.ctx;
    const P = t.pts;
    const [fill, edge] = COLORS[t.color];
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.save(); c.translate(1.5, 3); this.path(P); c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 10; c.stroke(); c.restore();
    this.path(P); c.strokeStyle = edge; c.lineWidth = 9.5; c.stroke();
    this.path(P); c.strokeStyle = fill; c.lineWidth = 7; c.stroke();
    c.save(); c.translate(-1.2, -1.6); this.path(P); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.8; c.stroke(); c.restore();
    for (const i of [0, 1]) this.drawFitting(t, i);
  }

  drawFitting(t, i) {
    const c = this.ctx;
    const P = t.pts;
    const a = i === 0 ? P[0] : P[N - 1];
    const b = i === 0 ? P[2] : P[N - 3];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const attached = !!t.ends[i].port;
    c.save();
    c.translate(a.x, a.y);
    c.rotate(ang);
    const g = c.createLinearGradient(0, -6, 0, 6);
    g.addColorStop(0, '#f2f4f6'); g.addColorStop(0.5, '#9aa4ac'); g.addColorStop(1, '#5d666d');
    c.fillStyle = g;
    c.strokeStyle = '#3d454c';
    c.lineWidth = 1;
    roundRect(c, -2, -6, 15, 12, 3);
    c.fill(); c.stroke();
    if (!attached) {
      c.beginPath(); c.arc(-2, 0, 3, 0, Math.PI * 2);
      c.fillStyle = '#1d2327'; c.fill();
    }
    c.restore();
    if (!attached && !this.drag) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 5 + i);
      c.beginPath(); c.arc(a.x, a.y, 14 + pulse * 3, 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,255,255,${0.15 + pulse * 0.2})`; c.lineWidth = 1.5; c.stroke();
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
