// RIKEN KEIKI RX-8000 (HC %LEL / vol% by infrared + O2) — behaviour follows
// Operating Manual PT0E-1194. Gas alarms are an optional setting; this unit shows NO ALARM.
import { MeterBase, Sensor } from './meter-base.js';
import { deviceSVG, KEYPOS, WIDE_DX } from './device.js';
import { draw7, draw14, heart, fan, battery, text } from './seg.js';
import { clamp, fmt, roundTo, pad } from './util.js';

const SEL = ['HC', 'HCV', 'O2', 'ESC'];
const DISP_ITEMS = ['peak', 'clock', 'id', 'rec'];
const START_DUR = [2.0, 1.5, 1.5, 1.5, 1.5, 1.5];

export class RX8000 extends MeterBase {
  constructor(app) {
    super(app);
    this.model = 'RX-8000';
    this.sensors = [
      new Sensor({ id: 'HC', name: 'HC', unit: '%LEL', resp: 'LEL_HC', res: 0.5, fs: 100, max: 100, tau: 13, kind: 'lel', airTol: 10 }),
      new Sensor({ id: 'HCV', name: 'HC', unit: 'vol%', resp: 'VOL_HC', res: 0.5, fs: 100, max: 100, tau: 13, kind: 'vol', airTol: 3 }),
      new Sensor({ id: 'O2', name: 'O2', unit: '%', resp: 'O2', res: 0.1, fs: 25, max: 40, tau: 8.7, kind: 'o2', airTol: 2 }),
    ];
    this.alarmsEnabled = false;
    this.range = 'LEL';
    this.stationId = 0;
    this.drift = {
      normal: { HC: { gain: 0.96, off: 1.5 }, HCV: { gain: 1.03, off: 0.5 }, O2: { gain: 0.986, off: 0 } },
    };
    this.applyDrift();
    this.backlight = 0;
    this.pumpBeepT = 0;
  }

  static cylinders = ['HC50', 'HCV', 'N2', 'ZAIR'];

  svg(wide = false) {
    const stripes = `
      <rect x="70" y="48" width="140" height="5" rx="2" fill="#f2c230"/>
      <rect x="${350 + (wide ? WIDE_DX : 0)}" y="48" width="140" height="5" rx="2" fill="#2f8fe0"/>
      <text x="62" y="210" font-family="Barlow Condensed, Arial Narrow" font-weight="700" font-size="15" fill="#f4f6f8">CAL</text>
      <path d="M78 186 L70 192 L70 226 L78 232" fill="none" stroke="#f4f6f8" stroke-width="2"/>`;
    return deviceSVG({
      model: 'RX-8000', theme: 'red', wide, lcdBg: '#b9c3b6', lcdViewBox: '0 0 240 150', stripes,
      keys: [
        { key: 'up', ...KEYPOS.leftTop, x: 116, l1: '▲', l2: 'AIR' },
        { key: 'down', ...KEYPOS.leftBot, x: 116, l1: 'PUMP', l2: '▼' },
        { key: 'mode', ...KEYPOS.rightTop, l1: 'PEAK', l2: 'ESC' },
        { key: 'enter', ...KEYPOS.rightBot, l1: 'POWER', l2: 'ENTER', small: true },
      ],
    });
  }

  keyNames() { return { up: '▲/AIR', down: '▼/PUMP', mode: 'PEAK/ESC', enter: 'POWER/ENTER' }; }

  pumpActive() { return this.mode !== 'poweroff' && this.mode !== 'pumpoff' && !(this.mode === 'start' && this.st.i === 0); }
  flowCheckActive() { return !['start', 'filter', 'poweroff', 'pumpoff'].includes(this.mode); }
  measuring() { return ['detect', 'disp', 'memrec'].includes(this.mode); }

  powerOnInstant() { this.forceMeasuring(); this.go('detect'); }

  hcDisplay() {
    const hc = this.S('HC'), hv = this.S('HCV');
    const lel = hc.value();
    if (this.range === 'LEL' && lel >= 100) this.range = 'VOL';
    else if (this.range === 'VOL' && hv.value() < 1.8 * 0.9) this.range = 'LEL';
    if (this.range === 'VOL') return { txt: hv.text(), frac: hv.barFrac(), unit: 'vol%' };
    return { txt: hc.text(), frac: hc.barFrac(), unit: '%LEL' };
  }

  // ------------------------------------------------------------------ keys
  onKeyDown(k) {
    this.backlight = 10;
    if (['off', 'start', 'poweroff'].includes(this.mode)) return;
    if (this.fault) { if (k === 'down') this.tryResetFault(); return; }
    const st = this.st;
    switch (this.mode) {
      case 'filter':
        if (k === 'enter') { this.consume('enter'); this.go('warmup', { t: 30 }); }
        break;
      case 'detect':
        break; // handled on release / hold
      case 'air':
        break;
      case 'pumpoff':
        if (k === 'down') { this.consume('down'); this.pumpOn = true; this.go('detect'); }
        break;
      case 'disp': {
        if (st.sub === 'id') {
          if (k === 'up') st.val = (st.val + 1) % 128;
          if (k === 'down') st.val = (st.val + 127) % 128;
          if (k === 'enter') { this.stationId = st.val; st.sub = 'end'; st.t = 0; }
          if (k === 'mode') st.sub = null;
          return;
        }
        if (st.sub === 'rec') {
          const n = this.mem.length;
          if (k === 'mode') { st.sub = null; return; }
          if (!n) return;
          if (k === 'up' && !st.open) st.sel = (st.sel + 1) % n;
          if (k === 'down' && !st.open) st.sel = (st.sel + n - 1) % n;
          if (k === 'enter') st.open = !st.open;
          return;
        }
        if (k === 'mode') {
          st.item++;
          if (st.item >= DISP_ITEMS.length) { this.consume('mode'); this.go('detect'); }
        } else if (k === 'enter') {
          const item = DISP_ITEMS[st.item];
          if (item === 'id') { st.sub = 'id'; st.val = this.stationId; }
          if (item === 'rec') { st.sub = 'rec'; st.sel = Math.max(0, this.mem.length - 1); st.open = false; }
        }
        break;
      }
      case 'onecal': {
        if (st.phase === 'sel') {
          if (k === 'up') st.sel = (st.sel + 1) % SEL.length;
          if (k === 'down') st.sel = (st.sel + SEL.length - 1) % SEL.length;
          if (k === 'enter') {
            if (SEL[st.sel] === 'ESC') { this.go('detect'); this.buzzer.beep2(); }
            else { st.phase = 'adjust'; st.delta = 0; }
          }
        } else if (st.phase === 'adjust') {
          const s = this.S(SEL[st.sel]);
          if (k === 'up') st.delta = roundTo(st.delta + s.res, s.res);
          if (k === 'down') st.delta = roundTo(st.delta - s.res, s.res);
          if (k === 'mode') st.phase = 'sel';
          if (k === 'enter') {
            const target = this.oneCalDisplay();
            if (s.spanCal(target)) { st.phase = 'end'; st.t = 0; }
            else {
              const sel = st.sel;
              this.setFault({ kind: 'cal', text: 'ONE CAL', ids: [s.id], after: () => this.go('onecal', { phase: 'sel', sel }) });
            }
          }
        }
        break;
      }
      case 'memrec':
        if (st.phase !== 'show') return;
        if (k === 'enter') {
          const vals = {};
          for (const s of this.sensors) vals[s.id] = s.reading();
          this.mem.push({ t: this.now(), vals });
          st.phase = 'end'; st.t = 0;
        }
        if (k === 'mode') this.go('detect');
        break;
    }
  }

  onKeyUp(k, held, consumed) {
    if (consumed) return;
    if (this.mode === 'detect' && k === 'mode' && held < 0.8) this.go('disp', { item: 0, sub: null });
  }

  oneCalDisplay() {
    const s = this.S(SEL[this.st.sel]);
    return clamp(roundTo(s.value() + this.st.delta, s.res), 0, s.max);
  }

  // ------------------------------------------------------------------ update
  update(dt, rdt) {
    this.backlight = Math.max(0, this.backlight - rdt);
    const st = this.st;
    const m = this.mode;
    if (m === 'off') {
      if (this.down('enter') && this.held('enter') >= 2.5 && !this.keys.enter.consumed) {
        this.consume('enter'); this.beep(); this.forceMeasuring(); this.range = 'LEL';
        this.go('start', { i: 0, t: 0 });
      }
      return;
    }
    if (['detect', 'disp', 'pumpoff'].includes(m) && !this.fault && this.down('enter') && !this.keys.enter.consumed && this.held('enter') >= 3) {
      this.consume('enter'); this.beep(); this.go('poweroff', { t: 0 });
      return;
    }
    if (this.fault) return;
    switch (m) {
      case 'start':
        st.t += dt;
        if (st.t >= START_DUR[st.i]) { st.t = 0; st.i++; if (st.i >= START_DUR.length) this.go('filter', { t: 0 }); }
        break;
      case 'filter': st.t += rdt; break;
      case 'warmup':
        st.t -= dt;
        if (st.t <= 0) { this.go('detect'); this.buzzer.beep2(); }
        break;
      case 'poweroff':
        st.t += rdt;
        if (st.t > 1.2) this.powerOffNow();
        break;
      case 'detect': {
        const up = this.down('up'), dn = this.down('down'), md = this.down('mode');
        if (up && dn && !this.keys.up.consumed && Math.min(this.held('up'), this.held('down')) > 1.0) {
          this.consume('up'); this.consume('down'); this.beep();
          this.go('onecal', { phase: 'sel', sel: 0 });
        } else if (md && up && !this.keys.mode.consumed && Math.min(this.held('mode'), this.held('up')) > 0.8) {
          this.consume('mode'); this.consume('up');
          this.go('memrec', { t: 0, phase: 'show' });
        } else if (up && !dn && !md && !this.keys.up.consumed && this.held('up') > 0.6) {
          this.consume('up');
          this.go('air', { phase: 'hold', t: 0 });
        } else if (dn && !up && !this.keys.down.consumed && this.held('down') > 3) {
          this.consume('down'); this.beep(); this.pumpOn = false;
          this.go('pumpoff', { t: 0 });
        }
        break;
      }
      case 'air':
        st.t += rdt;
        if (st.phase === 'hold') {
          if (!this.down('up')) this.go('detect');
          else if (st.t > 2.0) { st.phase = 'release'; this.beep(); }
        } else if (st.phase === 'release') {
          if (!this.down('up')) { st.phase = 'adj'; st.t = 0; }
        } else if (st.phase === 'adj' && st.t > 1.2) {
          const failed = this.sensors.filter(s => !s.airCal()).map(s => s.id);
          if (failed.length) this.setFault({ kind: 'cal', text: 'AIR CAL', ids: failed, after: () => this.go('detect') });
          else this.go('detect');
        }
        break;
      case 'pumpoff':
        this.pumpBeepT += dt;
        if (this.pumpBeepT > 180) { this.pumpBeepT = 0; this.buzzer.beep2(); }
        break;
      case 'disp':
        if (st.sub === 'end') { st.t = (st.t || 0) + rdt; if (st.t > 1) st.sub = null; }
        if (this.idle > 20) this.go('detect');
        break;
      case 'onecal':
        if (st.phase === 'end') { st.t += rdt; if (st.t > 0.9) st.phase = 'sel'; }
        break;
      case 'memrec':
        st.t += rdt;
        if (st.phase === 'end' && st.t > 1) this.go('detect');
        break;
    }
  }

  // ------------------------------------------------------------------ LCD
  frame() {
    const F = { heart: false, fan: false, noAlarm: !this.alarmsEnabled, cal: false, hc: false, o2: false, unitL: null, unitR: null, arcL: null, arcR: null, b1: '', b2: '', bAll: null, text: '', batt: 3, all: false };
    const st = this.st;
    if (this.mode === 'off') return null;
    if (this.fault) {
      F.bAll = 'FAiL'; F.text = this.fault.text;
      if (this.fault.ids) { if (this.fault.ids.some(i => i !== 'O2')) F.hc = true; if (this.fault.ids.includes('O2')) F.o2 = true; }
      return F;
    }
    const meas = (vals) => {
      F.hc = F.o2 = true;
      const h = vals ? { txt: fmt(vals.HC, 0.5), frac: clamp(vals.HC / 100, 0, 1), unit: '%LEL' } : this.hcDisplay();
      F.b1 = h.txt; F.arcL = h.frac; F.unitL = h.unit;
      const o = this.S('O2');
      const ov = vals ? vals.O2 : o.reading();
      F.b2 = o.text(ov); F.arcR = o.barFrac(ov); F.unitR = '%';
    };
    switch (this.mode) {
      case 'start': {
        const d = this.now();
        switch (st.i) {
          case 0: F.all = true; break;
          case 1: F.heart = true; F.bAll = `${pad(d.getFullYear() % 100)}-${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; F.text = this.clockText(); break;
          case 2: F.heart = true; F.bAll = 'bAtt.  3.8'; F.text = 'LI-ION'; break;
          case 3: F.heart = true; F.hc = F.o2 = true; F.b1 = 'HC'; F.b2 = 'O2'; F.unitL = '%LEL'; F.unitR = '%'; break;
          case 4: F.hc = F.o2 = true; F.b1 = '100'; F.b2 = '25.0'; F.arcL = 1; F.arcR = 1; F.unitL = '%LEL'; F.unitR = '%'; F.text = 'F. S.'; break;
          case 5: F.heart = true; F.bAll = 'id'; F.text = `ST-ID${pad(this.stationId, 3)}`; break;
        }
        return F;
      }
      case 'filter': {
        F.heart = true; F.fan = true;
        F.bAll = 'FiLtEr';
        F.text = Math.floor(st.t / 1.1) % 2 === 0 ? 'CHECK OK' : 'YES/ENT.';
        return F;
      }
      case 'warmup': {
        F.heart = true; F.fan = true; F.arcL = 1; F.arcR = 1;
        F.bAll = `${Math.max(0, Math.ceil(st.t))} SEC`;
        F.text = 'WARM UP';
        return F;
      }
      case 'poweroff': F.text = 'POWER OFF'; return F;
      case 'detect':
        F.heart = this.blinkOn(1); F.fan = this.flowOk; meas();
        return F;
      case 'pumpoff':
        F.heart = this.blinkOn(1); meas(); F.text = 'PUMP OFF';
        return F;
      case 'air':
        F.heart = true;
        F.bAll = 'AdJ';
        F.text = st.phase === 'hold' ? 'HOLD AIR' : 'RELEASE';
        return F;
      case 'disp': {
        F.heart = true; F.fan = this.flowOk;
        if (st.sub === 'id' || st.sub === 'end') { F.bAll = 'id'; F.text = st.sub === 'end' ? 'END' : (this.blinkOn(2) ? `ST-ID${pad(st.val, 3)}` : 'ST-ID'); return F; }
        if (st.sub === 'rec') {
          if (!this.mem.length) { F.bAll = 'no dAtA'; F.text = 'REC.DATA'; return F; }
          const e = this.mem[st.sel];
          if (st.open) { meas(e.vals); F.text = `No.${pad(st.sel + 1, 3)}`; return F; }
          F.bAll = `${pad(e.t.getMonth() + 1)}.${pad(e.t.getDate())} ${e.t.getHours()}:${pad(e.t.getMinutes())}`; F.text = `No.${pad(st.sel + 1, 3)}`;
          return F;
        }
        const item = DISP_ITEMS[st.item];
        if (item === 'peak') {
          const vals = {};
          for (const s of this.sensors) vals[s.id] = s.peak ?? s.reading();
          meas(vals); F.text = 'PEAK';
        } else if (item === 'clock') { F.bAll = this.clockText(); F.text = 'CLOCK'; }
        else if (item === 'id') { F.bAll = 'id'; F.text = `ST-ID${pad(this.stationId, 3)}`; }
        else { F.bAll = 'd iSPLAY'; F.text = 'REC.DATA'; }
        return F;
      }
      case 'onecal': {
        F.heart = true; F.cal = true;
        if (st.phase === 'end') { F.text = 'END'; return F; }
        const id = SEL[st.sel];
        if (id === 'ESC') { F.text = 'ESCAPE'; return F; }
        F.text = 'ONE CAL';
        if (id === 'O2') { F.o2 = true; F.unitR = '%'; F.arcR = 0.5; } else { F.hc = true; F.unitL = id === 'HC' ? '%LEL' : 'vol%'; F.arcL = 0.5; }
        const fld = id === 'O2' ? 'b2' : 'b1';
        if (st.phase === 'sel') F[fld] = '---';
        else { F.fan = true; F[fld] = this.blinkOn(1.5) ? fmt(this.oneCalDisplay(), this.S(id).res) : ''; }
        return F;
      }
      case 'memrec': {
        if (st.phase === 'end') { F.text = 'END'; return F; }
        const ph = Math.floor(st.t / 1.2) % 3;
        if (ph === 0) { F.bAll = `no.  ${pad(this.mem.length + 1, 3)}`; F.text = 'MEMORY'; }
        else if (ph === 1) { const d = this.now(); F.bAll = `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${this.clockText()}`; F.text = 'MEMORY'; }
        else { meas(); F.text = 'REC.'; }
        return F;
      }
    }
    return F;
  }

  renderLCD() {
    const F = this.frame();
    const lit = this.backlight > 0 && this.mode !== 'off';
    if (!F) return { svg: '', bg: '#a9b3a6' };
    const all = F.all;
    let s = '';
    s += heart(5, 2, 0.95, all || F.heart);
    if (all || F.noAlarm) s += `<rect x="62" y="1.5" width="46" height="9" rx="4.5" fill="none" stroke="var(--seg-on)" stroke-width="1"/>` + text(85, 8.6, 6.4, 'NO ALARM', { anchor: 'middle' });
    if (all || F.cal) s += `<rect x="114" y="1.5" width="22" height="9" rx="2" fill="none" stroke="var(--seg-on)" stroke-width="1"/>` + text(125, 8.6, 6.4, 'CAL', { anchor: 'middle' });
    s += fan(229, 7.5, 6, this.fanAngle, all || F.fan);

    // arc bar graphs
    // elliptical arc bar graphs running round the edge of the glass (HC left, O2 right)
    const cx = 120, cy = 162, RX = 116, RY = 142, W = 9;
    const P = (a, d) => [cx + (RX - d) * Math.cos((a * Math.PI) / 180), cy + (RY - d) * Math.sin((a * Math.PI) / 180)];
    const arc = (a0, a1, frac, show) => {
      if (!show && !all) return '';
      const n = 30;
      let out = '';
      for (let i = 0; i < n; i++) {
        const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 0.75)) / n;
        const pts = [P(t0, W), P(t0, 0), P(t1, 0), P(t1, W)].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
        const on = all || i < Math.round((frac ?? 0) * n);
        out += `<polygon points="${pts}" fill="${on ? 'var(--seg-on)' : 'var(--seg-ghost)'}"/>`;
      }
      for (let i = 0; i <= 5; i++) {
        const a = a0 + ((a1 - a0) * i) / 5;
        const [x1, y1] = P(a, W + 1), [x2, y2] = P(a, W + 4);
        out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--seg-on)" stroke-width="0.8"/>`;
      }
      return out;
    };
    s += arc(199, 262, F.arcL, F.arcL != null);
    s += arc(341, 278, F.arcR, F.arcR != null);
    if (all || F.arcL != null) s += text(93, 36, 7, '100', { anchor: 'middle' });
    if (all || F.arcR != null) s += text(150, 36, 7, '25.0', { anchor: 'middle' });

    if (all || F.hc) s += text(70, 70, 15, 'HC', { italic: true });
    if (all || F.o2) s += text(146, 70, 15, 'O', { italic: true }) + text(158, 73, 9, '2', { italic: true });

    if (F.bAll != null && !all) {
      s += draw7(44, 76, 28, F.bAll, { pitch: 20, n: 8, ghost: true, align: 'left' });
    } else {
      s += draw7(44, 76, 28, all ? '8.8.8.8.' : F.b1, { pitch: 19, n: 4, ghost: true });
      s += draw7(124, 76, 28, all ? '8.8.8.8.' : F.b2, { pitch: 19, n: 4, ghost: true });
    }
    if (all || F.unitL === '%LEL') s += text(74, 116, 9, '%LEL');
    if (all || F.unitL === 'vol%') s += `<rect x="72" y="108" width="24" height="10" rx="1.5" fill="var(--seg-on)"/>` + text(84, 116, 8, 'vol%', { anchor: 'middle', fill: 'var(--lcd-bg)' });
    if (all || F.unitR) s += text(190, 116, 9, '%');

    s += battery(3, 131, 22, 12, all ? 3 : F.batt, true);
    s += draw14(30, 128, 16, all ? '**********' : F.text.padEnd(10, ' ').slice(0, 10), { ghost: true, pitch: 13 });
    return { svg: s, bg: lit ? '#cfe3a2' : '#b9c3b6' };
  }

  help() {
    if (this.fault) return 'Fault: remove the cause, then press ▼.';
    switch (this.mode) {
      case 'off': return 'Power ON: hold POWER/ENTER ~3 s.';
      case 'start': return 'Start-up self-check…';
      case 'filter': return 'Check the filters are fitted, then press ENTER.';
      case 'warmup': return 'Warm-up: wait for the countdown.';
      case 'detect': return 'Detection: hold ▲/AIR = air calibration · ▲+▼ together ~1 s = span (ONE CAL) · PEAK = display menu · hold ▼/PUMP 3 s = pump off · hold POWER = off.';
      case 'air': return 'Keep holding ▲/AIR until RELEASE, then let go.';
      case 'pumpoff': return 'Pump stopped (no detection!). Press ▼/PUMP to restart.';
      case 'disp': return 'PEAK = next item · ENTER = open · ESC = back.';
      case 'onecal': return this.st.phase === 'adjust' ? 'Supply gas, wait until stable, ▲/▼ = set reading to cylinder value, ENTER = adjust. ESC = cancel.' : '▲/▼ = choose · ENTER = select. ESCAPE + ENTER = exit.';
      default: return '';
    }
  }
}
