import { clamp, roundTo, fmt } from './util.js';

export const AIR = Object.freeze({ O2: 20.9, N2: 78.1, CH4: 0, iC4H10: 0, CO: 0, H2S: 0 });

// Natural zero drift between uses (sensor units): a few ppm / a few tenths of a %.
const ZERO_DRIFT = { CO: [2, 4], H2S: [0.5, 1.5], LEL: [1, 3], HC: [1, 2.5], HCV: [0.5, 1], O2: [-0.4, -0.2] };

// LEL values (vol%) used for %LEL conversion
const LEL_CH4 = 5.0;
const LEL_IC4 = 1.8;

const RESPONSE = {
  O2: g => g.O2 ?? 0,
  CO: g => g.CO ?? 0,
  H2S: g => g.H2S ?? 0,
  LEL_CH4: g => ((g.CH4 ?? 0) / LEL_CH4) * 100 + ((g.iC4H10 ?? 0) / LEL_IC4) * 100 * 0.6,
  LEL_HC: g => ((g.iC4H10 ?? 0) / LEL_IC4) * 100 + ((g.CH4 ?? 0) / LEL_CH4) * 100 * 0.5,
  VOL_HC: g => (g.iC4H10 ?? 0) + (g.CH4 ?? 0) * 0.5,
};

export class Sensor {
  constructor(cfg) {
    Object.assign(this, {
      tau: 12, gain: 1, off: 0, max: cfg.fs, alarm: null, kind: 'tox', airTol: 10,
    }, cfg);
    this.respond = RESPONSE[cfg.resp];
    this.raw = this.respond(AIR);
    this.noise = 0;
    this.peak = null;
    this.minuteSum = 0; this.minuteN = 0; this.minutes = []; this.minuteT = 0;
    this.nominal = { gain: this.gain, off: this.off };
  }

  get isO2() { return this.kind === 'o2'; }

  step(gas, dt) {
    if (gas) {
      const target = this.respond(gas);
      const k = 1 - Math.exp(-dt / this.tau);
      this.raw += (target - this.raw) * k;
    }
    // slow random walk noise, about a quarter of the display resolution
    this.noise += (Math.random() - 0.5) * this.res * 0.25 * Math.min(1, dt * 4);
    this.noise *= Math.exp(-dt * 1.5);
  }

  value() {
    let v = this.raw * this.gain + this.off + this.noise;
    if (!this.isO2 && v < 0) v = v > -this.res * 2 ? 0 : v;
    return v;
  }

  reading() {
    return clamp(roundTo(this.value(), this.res), this.isO2 ? 0 : -999, this.max * 1.0001);
  }

  text(v = this.reading()) {
    if (v >= this.max) return '----';
    return fmt(v, this.res);
  }

  barFrac(v = this.reading()) {
    return clamp(v / this.fs, 0, 1);
  }

  // ---- calibration ----
  airCal() {
    const r = this.raw;
    if (this.isO2) {
      if (r < 20.9 - this.airTol || r > 20.9 + this.airTol) return false;
      // keep the zero point (from an N2 span cal), move only the 20.9 % point
      const g = (20.9 - this.off) / r;
      if (!(g > 0.5 && g < 2)) { this.gain = 20.9 / r; this.off = 0; } else this.gain = g;
      return true;
    }
    if (Math.abs(r * this.gain) > this.airTol) return false;
    this.off = -r * this.gain;
    return true;
  }

  spanCal(target) {
    const r = this.raw;
    if (this.isO2) {
      if (20.9 - r < 2) return false;
      const g = (20.9 - target) / (20.9 - r);
      if (!(g > 0.5 && g < 2)) return false;
      this.gain = g;
      this.off = 20.9 - g * 20.9;
      return true;
    }
    if (r <= 0.05 * target) return false;
    const g = (target - this.off) / r;
    if (!(g > 0.4 && g < 2.5)) return false;
    this.gain = g;
    return true;
  }

  bumpPass(v, target, tolPct) {
    const tol = tolPct / 100;
    if (this.isO2) return Math.abs(v - target) <= tol * Math.abs(20.9 - target);
    return Math.abs(v - target) <= tol * target;
  }

  // ---- alarms ----
  alarmLevel(v) {
    const a = this.alarm;
    if (!a) return 0;
    if (a.over != null && v >= a.over) return 3;
    if (a.type === 'L-H') {
      if (a.a != null && v >= a.a) return 2;
      if (a.w != null && v <= a.w) return 1;
      return 0;
    }
    if (a.a != null && v >= a.a) return 2;
    if (a.w != null && v >= a.w) return 1;
    return 0;
  }

  trackExposure(v, dt) {
    if (this.peak == null) this.peak = v;
    else this.peak = this.isO2 ? Math.min(this.peak, v) : Math.max(this.peak, v);
    if (this.isO2) return;
    this.minuteSum += v * dt; this.minuteN += dt; this.minuteT += dt;
    if (this.minuteT >= 60) {
      this.minutes.push(this.minuteSum / Math.max(this.minuteN, 1e-6));
      if (this.minutes.length > 480) this.minutes.shift();
      this.minuteSum = 0; this.minuteN = 0; this.minuteT = 0;
    }
  }

  get stel() {
    const last = this.minutes.slice(-15);
    const cur = this.minuteN > 0 ? this.minuteSum / this.minuteN : 0;
    const vals = last.length < 15 ? last.concat([cur]) : last;
    return vals.reduce((a, b) => a + b, 0) / 15;
  }

  get twa() {
    const cur = this.minuteN > 0 ? (this.minuteSum / this.minuteN) * (this.minuteN / 60) : 0;
    return (this.minutes.reduce((a, b) => a + b, 0) + cur) / 480;
  }

  resetExposure() {
    this.peak = null; this.minutes = []; this.minuteSum = 0; this.minuteN = 0; this.minuteT = 0;
  }
}

export class MeterBase {
  constructor(app) {
    this.app = app;
    this.buzzer = app.buzzer;
    this.keys = {};
    this.realNow = 0;
    this.simTime = 0;
    this.idle = 0;
    this.mode = 'off';
    this.st = {};
    this.pumpOn = true;
    this.flowOk = true;
    this.blockT = 0;
    this.fault = null;
    this.latched = {};
    this.alarmTest = null;
    this.alarmsEnabled = true;
    this.anyKeyStopsTest = true;
    this.fanAngle = 0;
    this.lamp = false;
    this.mem = [];
    this.clockOffset = 0;
    this.confirmBeep = true;
    this.sensors = [];
    // settings a real meter keeps in memory when switched off (models add their own)
    this.persist = ['clockOffset', 'stationId', 'confirmBeep'];
  }

  // ---------- helpers ----------
  S(id) { return this.sensors.find(s => s.id === id); }
  get on() { return this.mode !== 'off'; }
  down(k) { return !!(this.keys[k] && this.keys[k].down); }
  held(k) { const ks = this.keys[k]; return ks && ks.down ? this.realNow - ks.t0 : 0; }
  consume(k) { if (this.keys[k]) this.keys[k].consumed = true; }
  blinkOn(rate = 1) { return Math.floor(this.realNow * rate * 2) % 2 === 0; }
  go(mode, st = {}) { this.mode = mode; this.st = st; this.idle = 0; }
  beep() { this.buzzer.beep(); }
  now() { return new Date(Date.now() + this.clockOffset); }
  clockText() {
    const d = this.now();
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // Called by the app ---------------------------------------------------------------
  keyDown(k) {
    if (this.keys[k] && this.keys[k].down) return;
    this.keys[k] = { down: true, t0: this.realNow, consumed: false };
    this.idle = 0;
    if (this.on && this.alarmTest && this.anyKeyStopsTest) {
      this.alarmTest = null;
      this.consume(k);
      return;
    }
    this.onKeyDown(k);
  }

  keyUp(k) {
    const ks = this.keys[k];
    if (!ks || !ks.down) return;
    ks.down = false;
    this.onKeyUp(k, this.realNow - ks.t0, ks.consumed);
  }

  releaseAll() {
    for (const k of Object.keys(this.keys)) this.keys[k].down = false;
  }

  tick(rdt, dt) {
    this.realNow += rdt;
    this.simTime += dt;
    this.idle += dt;

    let flowBlocked = false;
    if (this.on) {
      const pumping = this.pumpOn && this.pumpActive();
      const inlet = this.app.gas.meterDraw(dt, pumping);
      flowBlocked = pumping && inlet.blocked;
      const comp = pumping && !inlet.blocked ? inlet.comp : null;
      for (const s of this.sensors) s.step(comp, dt);
      this.flowOk = !flowBlocked;
      if (pumping && !flowBlocked) this.fanAngle = (this.fanAngle + rdt * 420) % 360;
      if (flowBlocked && this.flowCheckActive()) {
        this.blockT += dt;
        if (this.blockT > 2 && !this.fault) this.setFault({ kind: 'flow', text: 'LOW FLOW' });
      } else this.blockT = 0;
    } else {
      for (const s of this.sensors) s.step(null, dt);
    }

    this.update(dt, rdt);

    if (this.on && this.measuring()) {
      for (const s of this.sensors) {
        const v = s.reading();
        s.trackExposure(v, dt);
        if (!this.alarmsEnabled || !s.alarm) continue;
        let lvl = s.alarmLevel(v);
        if (!lvl && s.alarm.stel && s.stel >= s.alarm.stel) lvl = 5;
        if (!lvl && s.alarm.twa && s.twa >= s.alarm.twa) lvl = 4;
        if (lvl > (this.latched[s.id] || 0)) this.latched[s.id] = lvl;
      }
    }

    let pattern = null;
    if (this.on) {
      if (this.fault) pattern = 'fault';
      else if (this.alarmTest) pattern = this.alarmTest.pattern;
      else {
        const top = this.topAlarm();
        if (top) pattern = { 1: 'alarm1', 2: 'alarm2', 3: 'over', 4: 'twa', 5: 'stel' }[top];
      }
    }
    this.buzzer.setPattern(pattern);
    this.lamp = this.buzzer.update(rdt);
  }

  topAlarm() {
    let top = 0;
    for (const id in this.latched) top = Math.max(top, this.latched[id]);
    return top;
  }

  alarmName(lvl) {
    return { 1: 'WARNING', 2: 'ALARM', 3: 'OVER', 4: 'TWA', 5: 'STEL' }[lvl] || '';
  }

  resetAlarms() {
    for (const s of this.sensors) {
      if (!this.latched[s.id]) continue;
      const v = s.reading();
      const lvl = s.alarmLevel(v);
      if (lvl === 0) delete this.latched[s.id];
    }
  }

  setFault(f) {
    this.fault = f;
  }

  tryResetFault() {
    if (!this.fault) return false;
    if (this.fault.kind === 'flow' && this.blockT > 0) return false;
    const f = this.fault;
    this.fault = null;
    this.blockT = 0;
    if (f.after) f.after();
    return true;
  }

  startAlarmTest(level) {
    const pattern = { 0: 'over', 1: 'alarm1', 2: 'alarm2', 3: 'over', 4: 'twa', 5: 'stel' }[level];
    this.alarmTest = { level, pattern };
  }

  // Defaults; models override ------------------------------------------------------------
  pumpActive() { return true; }
  flowCheckActive() { return true; }
  measuring() { return false; }
  onKeyDown() {}
  onKeyUp() {}
  update() {}

  powerOffNow() {
    this.go('off');
    this.fault = null;
    this.latched = {};
    this.alarmTest = null;
    this.pumpOn = true;
    this.buzzer.setPattern(null);
  }

  // Put the instrument straight into measuring state (used by learning-task setup).
  forceMeasuring() {
    this.fault = null;
    this.latched = {};
    this.alarmTest = null;
    this.pumpOn = true;
    for (const s of this.sensors) s.resetExposure();
  }

  // ---------- memory: calibration, alarm setpoints and settings survive power-off ----------
  saveState() {
    const out = { cal: {}, alarm: {}, set: {}, mem: [] };
    for (const s of this.sensors) {
      out.cal[s.id] = { gain: s.gain, off: s.off };
      if (s.alarm) out.alarm[s.id] = { ...s.alarm };
    }
    for (const k of this.persist) out.set[k] = this[k];
    out.mem = this.mem.map(e => ({ t: +e.t, vals: e.vals }));
    return out;
  }

  loadState(st) {
    if (!st) return;
    for (const s of this.sensors) {
      const c = st.cal && st.cal[s.id];
      if (c && Number.isFinite(c.gain) && Number.isFinite(c.off)) { s.gain = c.gain; s.off = c.off; }
      const a = st.alarm && st.alarm[s.id];
      if (a && s.alarm) Object.assign(s.alarm, a);
    }
    for (const k of this.persist) {
      if (!st.set || !(k in st.set)) continue;
      const v = st.set[k];
      if (v && typeof v === 'object' && this[k] && typeof this[k] === 'object') Object.assign(this[k], v);
      else this[k] = v;
    }
    if (Array.isArray(st.mem)) this.mem = st.mem.map(e => ({ t: new Date(e.t), vals: e.vals }));
  }

  // Small natural zero drift (a few ppm / tenths of a %) on top of the current calibration.
  // Span (gain) calibration is kept; a fresh air calibration removes it.
  naturalDrift() {
    for (const s of this.sensors) {
      const [lo, hi] = ZERO_DRIFT[s.id] || [0, 0];
      const d = lo + Math.random() * (hi - lo);
      const r = s.raw;
      if (s.isO2) {
        if (r > 1) s.gain = (20.9 + d - s.off) / r;
      } else s.off = -r * s.gain + d;
    }
  }

  // Factory state: close to correct, with the small error of a meter fresh out of the box.
  applyDrift(scenario = 'normal') {
    for (const s of this.sensors) {
      const d = (this.drift && this.drift[scenario] && this.drift[scenario][s.id]) || (this.drift && this.drift.normal[s.id]) || { gain: 1, off: 0 };
      s.gain = d.gain; s.off = d.off;
    }
  }
}
