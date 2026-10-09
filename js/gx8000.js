// RIKEN KEIKI GX-8000 (TYPE-B: CH4 %LEL, O2, CO, H2S) — behaviour follows
// Operating Manual PT0E-0980 and User Maintenance Manual H4E-0050.
import { MeterBase, Sensor } from './meter-base.js';
import { deviceSVG, KEYPOS } from './device.js';
import { draw7, draw14, heart, fan, battery, text } from './seg.js';
import { clamp, fmt, roundTo, pad } from './util.js';

const POS = { LEL: 'u1', O2: 'u2', CO: 'l1', H2S: 'l2' };
const SEL_ORDER = ['LEL', 'O2', 'H2S', 'CO', 'ESC'];
const CAL_ITEMS = ['AIR CAL', 'AUTO CAL', 'ONE CAL', 'BUMP', 'NORMAL'];
const MAINT_ITEMS = ['DATE', 'AIR CAL', 'AUTO CAL', 'ONE CAL', 'BUMP', 'ALARM-P', 'BUMP-SET', 'BEEP SET', 'START'];
const DISP_ITEMS = ['peak', 'stel', 'twa', 'alarmp', 'pump', 'id', 'rec'];
const START_DUR = [2.2, 1.6, 1.6, 1.6, 1.6, 1.8, 1.8, 1.6, 1.6, 1.6];
const ALARMP_VIEWS = ['fs', 'w', 'a', 'stel', 'twa'];
const BUMPSET = {
  items: ['TIME', 'RANGE', 'ADJ.TIME', 'AUTO ADJ', 'ESCAPE'],
  opts: { TIME: [30, 45, 60, 90], RANGE: [10, 20, 30, 40, 50], 'ADJ.TIME': [60, 90, 120, 180], 'AUTO ADJ': [true, false] },
  key: { TIME: 'time', RANGE: 'range', 'ADJ.TIME': 'adj', 'AUTO ADJ': 'auto' },
};

export class GX8000 extends MeterBase {
  constructor(app) {
    super(app);
    this.model = 'GX-8000';
    this.sensors = [
      new Sensor({ id: 'LEL', name: 'CH4', unit: '%LEL', resp: 'LEL_CH4', res: 1, fs: 100, max: 100, tau: 13, kind: 'lel', airTol: 10,
        alarm: { type: 'H-HH', w: 10, a: 50, over: 100 } }),
      new Sensor({ id: 'O2', name: 'O2', unit: '%', resp: 'O2', res: 0.1, fs: 25, max: 40, tau: 8.7, kind: 'o2', airTol: 2,
        alarm: { type: 'L-H', w: 19.5, a: 23.5, over: 40 } }),
      new Sensor({ id: 'CO', name: 'CO', unit: 'ppm', resp: 'CO', res: 1, fs: 150, max: 500, tau: 13, airTol: 15,
        alarm: { type: 'H-HH', w: 25, a: 50, stel: 200, twa: 25, over: 500 } }),
      new Sensor({ id: 'H2S', name: 'H2S', unit: 'ppm', resp: 'H2S', res: 0.5, fs: 30, max: 100, tau: 13, airTol: 3,
        alarm: { type: 'H-HH', w: 5, a: 30, stel: 15, twa: 10, over: 100 } }),
    ];
    this.span = { LEL: 50, O2: 12.0, CO: 50, H2S: 25.0 };
    this.bumpSet = { time: 30, range: 30, adj: 60, auto: true };
    this.stationId = 0;
    this.drift = {
      normal: { LEL: { gain: 0.96, off: 2 }, O2: { gain: 0.981, off: 0 }, CO: { gain: 1.04, off: 3 }, H2S: { gain: 0.97, off: 0.5 } },
    };
    this.persist.push('span', 'bumpSet');
    this.applyDrift();
    this.backlight = 0;
  }

  static cylinders = ['MIX4', 'N2', 'ZAIR'];

  svg(wide = false) {
    return deviceSVG({
      model: 'GX-8000', theme: 'red', wide, lcdBg: '#b8c2b2', lcdViewBox: '0 0 240 150',
      keys: [
        { key: 'up', ...KEYPOS.leftTop, l1: '▲/AIR' },
        { key: 'down', ...KEYPOS.leftBot, l1: '▼', l2: 'RESET' },
        { key: 'mode', ...KEYPOS.rightTop, l1: 'DISPLAY', small: true },
        { key: 'enter', ...KEYPOS.rightBot, l1: 'POWER', l2: 'ENTER', small: true },
      ],
    });
  }

  keyNames() { return { up: '▲/AIR', down: '▼/RESET', mode: 'DISPLAY', enter: 'POWER/ENTER' }; }

  // ------------------------------------------------------------------ state helpers
  pumpActive() { return this.mode !== 'poweroff' && !(this.mode === 'start' && this.st.i === 0); }
  flowCheckActive() { return this.mode !== 'start' && this.mode !== 'poweroff' && this.mode !== 'pw'; }
  measuring() { return ['detect', 'disp', 'memrec'].includes(this.mode) && !this.alarmTest; }
  items() { return this.st.kind === 'maint' ? MAINT_ITEMS : CAL_ITEMS; }
  toMenu(kind, name) { this.go('menu', { kind, i: Math.max(0, (kind === 'maint' ? MAINT_ITEMS : CAL_ITEMS).indexOf(name)) }); }

  powerOnInstant() {
    this.forceMeasuring();
    this.go('detect');
  }

  // ------------------------------------------------------------------ keys
  onKeyDown(k) {
    this.backlight = 10;
    if (this.mode === 'off' || this.mode === 'start' || this.mode === 'poweroff') return;
    if (this.fault) {
      if (k === 'down') this.tryResetFault();
      return;
    }
    const f = this['k_' + this.mode];
    if (f) f.call(this, k);
  }

  k_detect(k) {
    if (k === 'down') this.resetAlarms();
    if (k === 'mode') {
      if (this.down('down')) {
        this.consume('down');
        this.beep();
        this.go('menu', { kind: 'cal', i: 0 });
      } else this.go('disp', { item: 0, sub: null });
    }
    if (k === 'up' && this.down('down')) {
      this.consume('down'); this.consume('up');
      this.go('memrec', { t: 0, phase: 'show' });
    }
  }

  k_air(k) {
    if (this.st.phase === 'view' && k === 'mode') this.airBack();
  }

  k_disp(k) {
    const st = this.st;
    const item = DISP_ITEMS[st.item];
    if (!st.sub) {
      if (item === 'pump' && !this.pumpOn) {
        if (k === 'enter') this.pumpOn = true;
        return;
      }
      if (k === 'mode') {
        st.item++;
        st.cycle = 0;
        if (st.item >= DISP_ITEMS.length) this.go('detect');
      } else if (k === 'enter') {
        if (item === 'alarmp') { st.sub = 'alarmp'; st.view = 0; }
        else if (item === 'pump') this.pumpOn = !this.pumpOn;
        else if (item === 'id') { st.sub = 'id'; st.val = this.stationId; }
        else if (item === 'rec') { st.sub = 'rec'; st.sel = Math.max(0, this.mem.length - 1); st.open = false; }
      }
      return;
    }
    if (st.sub === 'alarmp') {
      if (k === 'up') st.view = (st.view + 1) % ALARMP_VIEWS.length;
      if (k === 'down') st.view = (st.view + ALARMP_VIEWS.length - 1) % ALARMP_VIEWS.length;
      if (k === 'enter') this.startAlarmTest({ fs: 3, w: 1, a: 2, stel: 5, twa: 4 }[ALARMP_VIEWS[st.view]]);
      if (k === 'mode') st.sub = null;
    } else if (st.sub === 'id') {
      if (k === 'up') st.val = (st.val + 1) % 256;
      if (k === 'down') st.val = (st.val + 255) % 256;
      if (k === 'enter') { this.stationId = st.val; st.sub = 'idend'; st.t = 0; }
      if (k === 'mode') st.sub = null;
    } else if (st.sub === 'rec') {
      const n = this.mem.length;
      if (k === 'mode') { this.go('detect'); return; }
      if (!n) return;
      if (k === 'up' && !st.open) st.sel = (st.sel + 1) % n;
      if (k === 'down' && !st.open) st.sel = (st.sel + n - 1) % n;
      if (k === 'enter') st.open = !st.open;
    }
  }

  k_menu(k) {
    const items = this.items();
    const st = this.st;
    if (k === 'up') st.i = (st.i + 1) % items.length;
    if (k === 'down') st.i = (st.i + items.length - 1) % items.length;
    if (k !== 'enter') return;
    const kind = st.kind;
    switch (items[st.i]) {
      case 'AIR CAL': this.go('air', { phase: 'view', t: 0, from: 'menu', kind }); break;
      case 'AUTO CAL': this.go('autocal', { phase: 'conc', kind, t: 0 }); break;
      case 'ONE CAL': this.go('onecal', { phase: 'sel', sel: 0, kind }); break;
      case 'BUMP': this.go('bump', { phase: 'conc', kind, t: 0 }); break;
      case 'NORMAL': this.go('detect'); this.buzzer.beep2(); break;
      case 'DATE': {
        const d = this.now();
        this.go('date', { f: 0, v: [d.getFullYear() % 100, d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()] });
        break;
      }
      case 'ALARM-P': this.go('alarmset', { phase: 'sel', sel: 0 }); break;
      case 'BUMP-SET': this.go('bumpset', { i: 0, edit: false }); break;
      case 'BEEP SET': this.go('beepset', { val: this.confirmBeep }); break;
      case 'START': this.beep(); this.go('start', { i: 1, t: 0 }); break;
    }
  }

  k_pw(k) {
    const st = this.st;
    if (st.phase === 'err') return;
    if (k === 'enter') this.buzzer.blip();
    if (k === 'up') st.d[st.pos] = (st.d[st.pos] + 1) % 10;
    if (k === 'down') st.d[st.pos] = (st.d[st.pos] + 9) % 10;
    if (k === 'enter') {
      st.pos++;
      if (st.pos >= 4) {
        if (st.d.join('') === '0008') { this.beep(); this.go('menu', { kind: 'maint', i: 0 }); }
        else {
          st.phase = 'err'; st.t = 0;
          this.alarmTest = { level: 0, pattern: 'fault' };
          if (this.app.toast) this.app.toast(`Wrong password (${st.d.join('')}). Enter 0 0 0 8 again.`, 'bad');
        }
      }
    }
  }

  k_autocal(k) {
    const st = this.st;
    if (st.phase === 'conc') {
      if (k === 'mode') {
        if (this.down('down')) { this.consume('down'); st.phase = 'setsel'; st.sel = 0; }
        else { st.phase = 'supply'; st.t = 0; }
      }
    } else if (st.phase === 'setsel') {
      if (k === 'up') st.sel = (st.sel + 1) % 5;
      if (k === 'down') st.sel = (st.sel + 4) % 5;
      if (k === 'enter') {
        const id = SEL_ORDER[st.sel];
        if (id === 'ESC') st.phase = 'conc';
        else { st.phase = 'setedit'; st.val = this.span[id]; }
      }
    } else if (st.phase === 'setedit') {
      const id = SEL_ORDER[st.sel];
      const s = this.S(id);
      const lim = { LEL: [10, 100], O2: [0, 25], CO: [5, 500], H2S: [1, 100] }[id];
      if (k === 'up') st.val = clamp(roundTo(st.val + s.res, s.res), lim[0], lim[1]);
      if (k === 'down') st.val = clamp(roundTo(st.val - s.res, s.res), lim[0], lim[1]);
      if (k === 'enter') { this.span[id] = st.val; st.phase = 'setend'; st.t = 0; }
    } else if (st.phase === 'supply') {
      if (k === 'enter') { st.phase = 'adj'; st.t = 0; }
    }
  }

  k_onecal(k) {
    const st = this.st;
    if (st.phase === 'sel') {
      if (k === 'up') st.sel = (st.sel + 1) % 5;
      if (k === 'down') st.sel = (st.sel + 4) % 5;
      if (k === 'enter') {
        const id = SEL_ORDER[st.sel];
        if (id === 'ESC') this.toMenu(st.kind, 'ONE CAL');
        else { st.phase = 'adjust'; st.delta = 0; }
      }
    } else if (st.phase === 'adjust') {
      const s = this.S(SEL_ORDER[st.sel]);
      if (k === 'up') st.delta = roundTo(st.delta + s.res, s.res);
      if (k === 'down') st.delta = roundTo(st.delta - s.res, s.res);
      if (k === 'mode') st.phase = 'sel';
      if (k === 'enter') {
        const target = this.oneCalDisplay();
        if (s.spanCal(target)) { st.phase = 'end'; st.t = 0; }
        else {
          const kind = st.kind, sel = st.sel;
          this.setFault({ kind: 'cal', text: 'ONE CAL', ids: [s.id], after: () => this.go('onecal', { phase: 'sel', sel, kind }) });
        }
      }
    }
  }

  oneCalDisplay() {
    const s = this.S(SEL_ORDER[this.st.sel]);
    return clamp(roundTo(s.value() + this.st.delta, s.res), 0, s.max);
  }

  k_bump(k) {
    const st = this.st;
    if (st.phase === 'conc' && k === 'enter') { st.phase = 'apply'; st.t = this.bumpSet.time; }
    else if (st.phase === 'result') {
      const n = st.cal ? 3 : 2;
      if (k === 'up') st.view = (st.view + 1) % n;
      if (k === 'down') st.view = (st.view + n - 1) % n;
      if (k === 'enter') this.toMenu(st.kind, 'BUMP');
    }
  }

  k_alarmset(k) {
    const st = this.st;
    if (st.phase === 'sel') {
      if (k === 'up') st.sel = (st.sel + 1) % 5;
      if (k === 'down') st.sel = (st.sel + 4) % 5;
      if (k === 'enter') {
        const id = SEL_ORDER[st.sel];
        if (id === 'ESC') { this.toMenu('maint', 'ALARM-P'); return; }
        const a = this.S(id).alarm;
        st.fields = a.stel != null ? ['w', 'a', 'stel', 'twa'] : ['w', 'a'];
        st.fi = 0; st.tmp = { ...a }; st.val = a.w; st.phase = 'edit';
      }
    } else if (st.phase === 'edit') {
      const s = this.S(SEL_ORDER[st.sel]);
      if (k === 'up') st.val = clamp(roundTo(st.val + s.res, s.res), 0, s.max);
      if (k === 'down') st.val = clamp(roundTo(st.val - s.res, s.res), 0, s.max);
      if (k === 'enter') {
        st.tmp[st.fields[st.fi]] = st.val;
        st.fi++;
        if (st.fi >= st.fields.length) {
          Object.assign(s.alarm, st.tmp);
          st.phase = 'end'; st.t = 0;
        } else st.val = st.tmp[st.fields[st.fi]];
      }
    }
  }

  k_bumpset(k) {
    const st = this.st;
    const name = BUMPSET.items[st.i];
    if (!st.edit) {
      if (k === 'up') st.i = (st.i + 1) % BUMPSET.items.length;
      if (k === 'down') st.i = (st.i + BUMPSET.items.length - 1) % BUMPSET.items.length;
      if (k === 'enter') {
        if (name === 'ESCAPE') { this.toMenu('maint', 'BUMP-SET'); return; }
        st.edit = true; st.oi = Math.max(0, BUMPSET.opts[name].indexOf(this.bumpSet[BUMPSET.key[name]]));
      }
    } else {
      const opts = BUMPSET.opts[name];
      if (k === 'up') st.oi = (st.oi + 1) % opts.length;
      if (k === 'down') st.oi = (st.oi + opts.length - 1) % opts.length;
      if (k === 'enter') { this.bumpSet[BUMPSET.key[name]] = opts[st.oi]; st.edit = false; }
    }
  }

  k_beepset(k) {
    if (k === 'up' || k === 'down') this.st.val = !this.st.val;
    if (k === 'enter') { this.confirmBeep = this.st.val; this.toMenu('maint', 'BEEP SET'); }
  }

  k_date(k) {
    const st = this.st;
    const lim = [[0, 99], [1, 12], [1, 31], [0, 23], [0, 59]][st.f];
    if (k === 'up') st.v[st.f] = st.v[st.f] >= lim[1] ? lim[0] : st.v[st.f] + 1;
    if (k === 'down') st.v[st.f] = st.v[st.f] <= lim[0] ? lim[1] : st.v[st.f] - 1;
    if (k === 'enter') {
      st.f++;
      if (st.f >= 5) {
        const [y, mo, d, h, mi] = st.v;
        const target = new Date(2000 + y, mo - 1, d, h, mi, new Date().getSeconds());
        this.clockOffset = target.getTime() - Date.now();
        st.phase = 'end'; st.t = 0;
      }
    }
  }

  k_memrec(k) {
    if (this.st.phase !== 'show') return;
    if (k === 'enter') {
      const vals = {};
      for (const s of this.sensors) vals[s.id] = s.reading();
      this.mem.push({ t: this.now(), vals });
      if (this.mem.length > 256) this.mem.shift();
      this.st.phase = 'end'; this.st.t = 0;
    }
    if (k === 'mode') this.go('detect');
  }

  onKeyUp() { /* actions happen on key press; long presses are polled in update() */ }

  // ------------------------------------------------------------------ update
  update(dt, rdt) {
    this.backlight = Math.max(0, this.backlight - rdt);
    const st = this.st;
    const m = this.mode;

    if (m === 'off') {
      if (this.down('enter') && this.down('up') && this.down('down') && this.held('enter') > 0.8) {
        ['enter', 'up', 'down'].forEach(k => this.consume(k));
        this.beep();
        this.forceMeasuring();
        this.go('pw', { d: [0, 0, 0, 0], pos: 0 });
      } else if (this.down('enter') && !this.down('up') && !this.down('down') && this.held('enter') >= 2.5 && !this.keys.enter.consumed) {
        this.consume('enter');
        this.beep();
        this.forceMeasuring();
        this.go('start', { i: 0, t: 0 });
      }
      return;
    }

    // power off: keep POWER/ENTER pressed
    if (['detect', 'disp'].includes(m) && !this.fault && this.down('enter') && !this.keys.enter.consumed && this.held('enter') >= 3) {
      this.consume('enter');
      this.beep();
      this.go('poweroff', { t: 0 });
      return;
    }
    if (this.fault) return;

    switch (m) {
      case 'start':
        st.t += dt;
        if (st.t >= START_DUR[st.i]) {
          st.t = 0; st.i++;
          if (st.i >= START_DUR.length) { this.go('detect'); this.buzzer.beep2(); }
        }
        break;
      case 'poweroff':
        st.t += rdt;
        if (st.t > 1.2) this.powerOffNow();
        break;
      case 'detect':
        if (this.down('up') && !this.down('down') && !this.keys.up.consumed && this.held('up') > 0.35) {
          this.consume('up');
          this.go('air', { phase: 'hold1', t: 0, from: 'detect' });
        }
        break;
      case 'air': this.updateAir(rdt); break;
      case 'disp':
        if (st.sub === 'idend') { st.t += rdt; if (st.t > 1) st.sub = null; }
        st.cycle = (st.cycle || 0) + rdt;
        if (this.idle > 20 && this.pumpOn && !this.alarmTest) this.go('detect');
        break;
      case 'pw':
        if (st.phase === 'err') { st.t += rdt; if (st.t > 2.0) { this.alarmTest = null; st.phase = null; st.d = [0, 0, 0, 0]; st.pos = 0; } }
        break;
      case 'autocal':
        st.t += rdt;
        if (st.phase === 'setend' && st.t > 0.9) st.phase = 'setsel';
        if (st.phase === 'adj' && st.t > 1.2) {
          const failed = this.sensors.filter(s => !s.spanCal(this.span[s.id])).map(s => s.id);
          const kind = st.kind;
          if (failed.length) this.setFault({ kind: 'cal', text: 'AUTO CAL', ids: failed, after: () => this.toMenu(kind, 'AIR CAL') });
          else { st.phase = 'pass'; st.t = 0; }
        }
        if (st.phase === 'pass' && st.t > 1.5) this.toMenu(st.kind, 'AIR CAL');
        break;
      case 'onecal':
        if (st.phase === 'end') { st.t += rdt; if (st.t > 0.9) st.phase = 'sel'; }
        break;
      case 'bump': this.updateBump(dt); break;
      case 'alarmset':
        if (st.phase === 'end') { st.t += rdt; if (st.t > 0.9) st.phase = 'sel'; }
        break;
      case 'date':
        if (st.phase === 'end') { st.t += rdt; if (st.t > 0.9) this.toMenu('maint', 'DATE'); }
        break;
      case 'memrec':
        st.t += rdt;
        if (st.phase === 'end' && st.t > 1) this.go('detect');
        break;
    }
  }

  updateAir(rdt) {
    const st = this.st;
    st.t += rdt;
    switch (st.phase) {
      case 'view':
        if (this.down('up') && this.held('up') > 0.35) { this.consume('up'); st.phase = 'hold1'; st.t = 0; }
        break;
      case 'hold1':
        if (!this.down('up')) return this.airBack();
        if (st.t > 1.0) { st.phase = 'hold2'; st.t = 0; }
        break;
      case 'hold2':
        if (!this.down('up')) return this.airBack();
        if (st.t > 1.4) { st.phase = 'release'; st.t = 0; this.beep(); }
        break;
      case 'release':
        if (!this.down('up')) { st.phase = 'adj'; st.t = 0; }
        break;
      case 'adj':
        if (st.t > 1.2) {
          const failed = this.sensors.filter(s => !s.airCal()).map(s => s.id);
          if (failed.length) {
            const back = () => this.airBack();
            this.setFault({ kind: 'cal', text: 'AIR CAL', ids: failed, after: back });
          } else { st.phase = 'end'; st.t = 0; }
        }
        break;
      case 'end':
        if (st.t > 1.0) this.airBack();
        break;
    }
  }

  airBack() {
    if (this.st.from === 'menu') this.toMenu(this.st.kind, 'AIR CAL');
    else this.go('detect');
  }

  updateBump(dt) {
    const st = this.st;
    if (st.phase === 'apply') {
      st.t -= dt;
      if (st.t <= 0) {
        st.vals = {}; st.pass = {};
        for (const s of this.sensors) {
          st.vals[s.id] = s.reading();
          st.pass[s.id] = s.bumpPass(st.vals[s.id], this.span[s.id], this.bumpSet.range);
        }
        const allPass = Object.values(st.pass).every(Boolean);
        if (allPass || !this.bumpSet.auto) { st.phase = 'result'; st.view = 0; st.cal = false; this.beep(); }
        else { st.phase = 'cal'; st.t = Math.max(10, this.bumpSet.adj - this.bumpSet.time); }
      }
    } else if (st.phase === 'cal') {
      st.t -= dt;
      if (st.t <= 0) {
        st.calPass = {}; st.calVals = {};
        for (const s of this.sensors) {
          st.calPass[s.id] = st.pass[s.id] ? true : s.spanCal(this.span[s.id]);
          st.calVals[s.id] = s.reading();
        }
        st.phase = 'result'; st.view = 0; st.cal = true; this.beep();
      }
    }
  }

  // ------------------------------------------------------------------ LCD
  frame() {
    const F = { heart: false, fan: false, labels: {}, u1: '', u2: '', l1: '', l2: '', bars: {}, text: '', clock: null, batt: 3, all: false };
    const st = this.st;
    const m = this.mode;
    if (m === 'off') return null;

    if (this.fault) {
      F.u1 = 'FAiL'; F.text = this.fault.text;
      if (this.fault.ids) for (const id of this.fault.ids) this.labelFor(F, id);
      return F;
    }

    switch (m) {
      case 'start': return this.startFrame(F, st.i);
      case 'poweroff': F.text = 'POWER OFF'; return F;
      case 'detect': return this.detectFrame(F);
      case 'air': return this.airFrame(F);
      case 'disp': return this.dispFrame(F);
      case 'menu': F.text = this.items()[st.i]; return F;
      case 'pw':
        if (st.phase === 'err') { F.mid = this.blinkOn(2) ? 'FAiL' : ''; F.text = 'PASSWORD'; return F; }
        F.mid = st.d.map((d, i) => (i === st.pos && !this.blinkOn(2) ? ' ' : String(d))).join('');
        F.text = 'PASSWORD';
        return F;
      case 'autocal': return this.autoFrame(F);
      case 'onecal': return this.oneFrame(F);
      case 'bump': return this.bumpFrame(F);
      case 'alarmset': return this.alarmSetFrame(F);
      case 'bumpset': {
        const name = BUMPSET.items[st.i];
        F.text = name;
        if (name !== 'ESCAPE') {
          const v = st.edit ? BUMPSET.opts[name][st.oi] : this.bumpSet[BUMPSET.key[name]];
          const s = v === true ? ' On' : v === false ? 'OFF' : String(v);
          F.u2 = st.edit && !this.blinkOn(2) ? '' : s;
        }
        return F;
      }
      case 'beepset': F.text = 'BEEP SET'; F.u2 = this.blinkOn(2) ? (st.val ? ' On' : 'OFF') : ''; return F;
      case 'date': {
        if (st.phase === 'end') { F.text = 'END'; return F; }
        const v = st.v.map(n => pad(n));
        const bl = i => (st.f === i && !this.blinkOn(2) ? '  ' : v[i]);
        F.u1 = `${bl(0)}- `; F.u2 = `${bl(1)}.${bl(2)}`;
        F.l2 = `${bl(3)}:${bl(4)}`;
        F.text = 'DATE';
        return F;
      }
      case 'memrec': {
        if (st.phase === 'end') { F.text = 'END'; return F; }
        const n = this.mem.length + 1;
        const ph = Math.floor(st.t / 1.2) % 3;
        if (ph === 0) { F.u1 = 'no. '; F.u2 = pad(n, 3); F.text = 'MEMORY'; }
        else if (ph === 1) { const d = this.now(); F.u1 = `${pad(d.getFullYear() % 100)}- `; F.u2 = `${d.getMonth() + 1}.${pad(d.getDate())}`; F.l2 = this.clockText(); F.text = 'MEMORY'; }
        else { this.fillValues(F); F.text = 'REC.'; }
        return F;
      }
    }
    return F;
  }

  labelFor(F, id) {
    const L = { LEL: ['CH4', 'LEL'], O2: ['O2', 'PCT'], CO: ['CO', 'PPM1'], H2S: ['H2S', 'PPM2'] }[id];
    for (const l of L) F.labels[l] = true;
  }

  fillValues(F, vals, opts = {}) {
    for (const s of this.sensors) {
      const v = vals ? vals[s.id] : s.reading();
      this.labelFor(F, s.id);
      if (v == null) continue;
      F[POS[s.id]] = s.text(v);
      if (!opts.noBars) F.bars[POS[s.id]] = s.barFrac(v);
    }
  }

  startFrame(F, i) {
    const d = this.now();
    switch (i) {
      case 0: F.all = true; return F;
      case 1: F.heart = true; F.u1 = `${pad(d.getFullYear() % 100)}- `; F.u2 = `${d.getMonth() + 1}.${pad(d.getDate())}`; F.l2 = this.clockText(); return F;
      case 2: F.heart = true; F.u1 = 'bAtt.'; F.l2 = '3.8'; F.text = 'AL--H'; F.volt = true; return F;
      case 3: F.heart = true; F.u1 = 'CH4 '; F.u2 = ' O2 '; F.l1 = 'CO  '; F.l2 = 'H2S'; F.labels = { LEL: 1, PCT: 1, PPM1: 1, PPM2: 1 }; return F;
      case 4: this.fillValues(F, { LEL: 100, O2: 40, CO: 500, H2S: 100 }); F.u1 = '100'; F.u2 = '40.0'; F.l1 = '500'; F.l2 = '100.0'; F.bars = { u1: 1, u2: 1, l1: 1, l2: 1 }; F.text = 'F. S.'; return F;
      case 5: this.alarmPointsFrame(F, 'w'); F.heart = true; return F;
      case 6: this.alarmPointsFrame(F, 'a'); F.heart = true; return F;
      case 7: this.alarmPointsFrame(F, 'stel'); return F;
      case 8: this.alarmPointsFrame(F, 'twa'); return F;
      case 9: F.heart = true; F.u1 = 'id  '; F.text = `ST_ID${pad(this.stationId, 3)}`; return F;
    }
    return F;
  }

  alarmPointsFrame(F, which) {
    const name = { fs: 'F. S.', w: 'WARNING', a: 'ALARM', stel: 'STEL', twa: 'TWA' }[which];
    F.text = name;
    if (which === 'fs') {
      this.fillValues(F, { LEL: 100, O2: 40, CO: 500, H2S: 100 });
      F.u1 = '100'; F.u2 = '40.0'; F.l1 = '500'; F.l2 = '100.0';
      F.bars = { u1: 1, u2: 1, l1: 1, l2: 1 };
      return F;
    }
    for (const s of this.sensors) {
      const v = s.alarm[which];
      if (v == null) continue;
      this.labelFor(F, s.id);
      F[POS[s.id]] = fmt(v, s.res);
      F.bars[POS[s.id]] = s.barFrac(v);
    }
    return F;
  }

  detectFrame(F) {
    F.heart = this.blinkOn(1);
    F.fan = this.pumpOn && this.flowOk;
    this.fillValues(F);
    const top = this.topAlarm();
    if (top) {
      const fast = top >= 2;
      const on = this.blinkOn(fast ? 2 : 1);
      for (const id in this.latched) if (!on) F[POS[id]] = '';
      F.text = on ? this.alarmName(top) : '';
    } else F.clock = this.clockText();
    if (!this.pumpOn) { F.text = 'PUMP OFF'; F.clock = null; }
    return F;
  }

  airFrame(F) {
    const st = this.st;
    F.heart = true;
    switch (st.phase) {
      case 'view': this.fillValues(F); F.text = 'AIR CAL'; F.fan = true; return F;
      case 'hold1': F.u1 = 'Air '; F.u2 = 'CAL'; F.text = 'HOLD AIR'; return F;
      case 'hold2': F.u1 = 'Adj '; F.text = 'HOLD AIR'; return F;
      case 'release': case 'adj': F.u1 = 'Adj '; F.text = 'RELEASE'; return F;
      case 'end': F.text = 'END'; return F;
    }
    return F;
  }

  dispFrame(F) {
    const st = this.st;
    const item = DISP_ITEMS[st.item];
    F.heart = true;
    F.fan = this.pumpOn && this.flowOk;
    const cyc = Math.floor((st.cycle || 0) / 1.1) % 3;
    const yesNo = () => {
      F.u1 = 'd iS'; F.u2 = 'PLAY';
      F.text = cyc === 1 ? 'YES/ENT.' : 'NO /DISP';
    };
    if (st.sub === 'alarmp') {
      this.alarmPointsFrame(F, ALARMP_VIEWS[st.view]);
      if (this.alarmTest && !this.lamp) { F.u1 = F.u2 = F.l1 = F.l2 = ''; }
      return F;
    }
    if (st.sub === 'id' || st.sub === 'idend') {
      F.u1 = 'id  ';
      F.text = st.sub === 'idend' ? 'END' : (this.blinkOn(2) ? `ST_ID${pad(st.val, 3)}` : 'ST_ID');
      return F;
    }
    if (st.sub === 'rec') {
      if (!this.mem.length) { F.u1 = 'no  '; F.u2 = 'dAtA'; F.text = 'REC. DATA'; return F; }
      const e = this.mem[st.sel];
      if (st.open) { this.fillValues(F, e.vals); F.text = `No.${pad(st.sel + 1, 3)}`; return F; }
      F.u1 = `${pad(e.t.getMonth() + 1)}.${pad(e.t.getDate())}`;
      F.l2 = `${e.t.getHours()}:${pad(e.t.getMinutes())}`;
      F.text = `No.${pad(st.sel + 1, 3)}`;
      return F;
    }
    switch (item) {
      case 'peak': {
        const vals = {};
        for (const s of this.sensors) vals[s.id] = s.peak ?? s.reading();
        this.fillValues(F, vals); F.text = 'PEAK'; return F;
      }
      case 'stel': {
        this.fillValues(F, { CO: this.S('CO').stel, H2S: this.S('H2S').stel });
        F.labels = { CO: 1, PPM1: 1, H2S: 1, PPM2: 1 }; F.text = 'STEL'; return F;
      }
      case 'twa': {
        this.fillValues(F, { CO: this.S('CO').twa, H2S: this.S('H2S').twa });
        F.labels = { CO: 1, PPM1: 1, H2S: 1, PPM2: 1 }; F.text = 'TWA'; return F;
      }
      case 'alarmp': if (cyc === 0) { F.u1 = 'd iS'; F.u2 = 'PLAY'; F.text = 'ALARM-P'; } else yesNo(); return F;
      case 'pump':
        if (!this.pumpOn) { F.u2 = 'OFF'; F.text = 'PUMP OFF'; return F; }
        if (cyc === 0) F.text = 'PUMP OFF'; else yesNo();
        return F;
      case 'id':
        if (cyc === 0) { F.u1 = 'id  '; F.lAll = 'SELECt'; F.text = `ST--ID${pad(this.stationId, 3)}`; } else yesNo();
        return F;
      case 'rec': if (cyc === 0) { F.u1 = 'd iS'; F.u2 = 'PLAY'; F.text = 'REC. DATA'; } else yesNo(); return F;
    }
    return F;
  }

  autoFrame(F) {
    const st = this.st;
    F.heart = true;
    switch (st.phase) {
      case 'conc': this.fillValues(F, this.span, { noBars: true }); F.text = 'AUTO CAL'; return F;
      case 'setsel': this.selFrame(F, 'AUTO CAL'); return F;
      case 'setedit': {
        const id = SEL_ORDER[st.sel];
        this.labelFor(F, id);
        F[POS[id]] = this.blinkOn(2) ? fmt(st.val, this.S(id).res) : '';
        F.text = 'AUTO CAL';
        return F;
      }
      case 'setend': F.text = 'END'; return F;
      case 'supply': case 'adj':
        this.fillValues(F, null, { noBars: true }); F.fan = true;
        F.text = st.phase === 'adj' || this.blinkOn(1) ? 'AUTO CAL' : '';
        return F;
      case 'pass': F.text = 'PASS'; return F;
    }
    return F;
  }

  selFrame(F, label) {
    const id = SEL_ORDER[this.st.sel];
    if (id === 'ESC') { F.text = 'ESCAPE'; return; }
    this.labelFor(F, id);
    F[POS[id]] = '---';
    F.text = label;
  }

  oneFrame(F) {
    const st = this.st;
    F.heart = true;
    if (st.phase === 'sel') { this.selFrame(F, 'ONE CAL'); return F; }
    if (st.phase === 'end') { F.text = 'END'; return F; }
    const id = SEL_ORDER[st.sel];
    const s = this.S(id);
    this.labelFor(F, id);
    F.fan = true;
    F[POS[id]] = this.blinkOn(1.5) ? fmt(this.oneCalDisplay(), s.res) : '';
    F.text = 'ONE CAL';
    return F;
  }

  bumpFrame(F) {
    const st = this.st;
    F.heart = true;
    if (st.phase === 'conc') { this.fillValues(F, this.span, { noBars: true }); F.text = 'BUMP'; F.small = String(this.bumpSet.time); return F; }
    if (st.phase === 'apply' || st.phase === 'cal') {
      this.fillValues(F, null, { noBars: true }); F.fan = true;
      const alt = Math.floor(this.realNow) % 2 === 0;
      F.text = alt ? (st.phase === 'cal' ? 'CAL' : 'BUMP') : 'APPLY';
      F.small = String(Math.max(0, Math.ceil(st.t)));
      return F;
    }
    // result
    if (st.view === 0) {
      for (const s of this.sensors) {
        this.labelFor(F, s.id);
        const b = st.pass[s.id] ? 'P' : 'F';
        F[POS[s.id]] = st.cal ? `${b}${st.calPass[s.id] ? 'P' : 'F'}` : b;
      }
      F.text = st.cal ? 'BUMP/CAL' : 'BUMP';
    } else if (st.view === 1) { this.fillValues(F, st.vals, { noBars: true }); F.text = st.cal ? 'BUMP/' : 'BUMP'; }
    else { this.fillValues(F, st.calVals, { noBars: true }); F.text = '/CAL'; }
    return F;
  }

  alarmSetFrame(F) {
    const st = this.st;
    F.heart = true;
    if (st.phase === 'sel') { this.selFrame(F, 'ALARM-P'); return F; }
    if (st.phase === 'end') { F.text = 'END'; return F; }
    const id = SEL_ORDER[st.sel];
    const s = this.S(id);
    this.labelFor(F, id);
    F[POS[id]] = this.blinkOn(2) ? fmt(st.val, s.res) : '';
    F.text = { w: 'WARNING', a: 'ALARM', stel: 'STEL', twa: 'TWA' }[st.fields[st.fi]];
    return F;
  }

  renderLCD() {
    const F = this.frame();
    const lit = this.backlight > 0 && this.mode !== 'off';
    if (!F) return { svg: '', bg: '#a9b2a3' };
    const all = F.all;
    const L = l => all || F.labels[l];
    let s = '';
    s += heart(5, 2, 0.95, all || F.heart);
    if (all) {
      s += `<rect x="38" y="1.5" width="44" height="9" rx="2" fill="none" stroke="var(--seg-on)" stroke-width="1"/>` + text(60, 8.6, 6.2, 'NO ALARM', { anchor: 'middle' });
      s += `<rect x="86" y="1.5" width="62" height="9" rx="2" fill="none" stroke="var(--seg-on)" stroke-width="1"/>` + text(117, 8.6, 6.2, 'MAINTENANCE', { anchor: 'middle' });
      s += `<rect x="152" y="1.5" width="44" height="9" rx="2" fill="none" stroke="var(--seg-on)" stroke-width="1"/>` + text(174, 8.6, 6.2, 'B.H.MODE', { anchor: 'middle' });
    }
    s += fan(229, 7.5, 6, this.fanAngle, all || F.fan);

    if (L('CH4')) s += text(7, 21, 7.5, 'CH4', { italic: true });
    if (L('LEL')) s += text(66, 21, 7, '%LEL', { italic: true });
    if (L('O2')) s += text(136, 21, 7.5, 'O2', { italic: true });
    if (L('PCT')) s += text(226, 21, 7.5, '%', { italic: true });
    if (L('CO')) s += text(7, 118, 7.5, 'CO', { italic: true });
    if (L('PPM1')) s += text(76, 118, 7, 'ppm', { italic: true });
    if (L('H2S')) s += text(134, 118, 7.5, 'H2S', { italic: true });
    if (L('PPM2')) s += text(214, 118, 7, 'ppm', { italic: true });

    const D = (x, y, str) => draw7(x, y, 30, all ? '8.8.8.8.' : str, { pitch: 24, n: 4, ghost: true });
    if (F.mid != null && !all) s += draw7(70, 25, 30, F.mid, { pitch: 24, n: 4, ghost: true, align: 'left' });
    else {
      s += D(10, 25, F.u1);
      s += D(132, 25, F.u2);
    }
    if (F.lAll && !all) {
      s += draw7(10, 78, 30, F.lAll.slice(0, 4), { pitch: 24, n: 4, ghost: true, align: 'left' });
      s += draw7(132, 78, 30, F.lAll.slice(4).padEnd(4, ' '), { pitch: 24, n: 4, ghost: true, align: 'left' });
    } else {
      s += D(10, 78, F.l1);
      s += D(132, 78, F.l2);
    }

    // bar meters around the centre axis
    const bar = (x0, x1, y, frac, up) => {
      let r = `<line x1="${x0}" y1="66" x2="${x1}" y2="66" stroke="var(--seg-on)" stroke-width="0.9"/>`;
      for (let i = 0; i <= 5; i++) {
        const x = x0 + ((x1 - x0) * i) / 5;
        r += `<line x1="${x.toFixed(1)}" y1="${up ? 63.5 : 66}" x2="${x.toFixed(1)}" y2="${up ? 66 : 68.5}" stroke="var(--seg-on)" stroke-width="0.8"/>`;
      }
      const n = 20, w = (x1 - x0) / n;
      const lit = all ? n : Math.round((frac ?? 0) * n);
      for (let i = 0; i < n; i++) {
        r += `<rect x="${(x0 + i * w + 0.4).toFixed(2)}" y="${y}" width="${(w - 0.9).toFixed(2)}" height="4" fill="${i < lit ? 'var(--seg-on)' : 'var(--seg-ghost)'}"/>`;
      }
      return r;
    };
    const hasBars = all || Object.keys(F.bars).length;
    if (hasBars) {
      s += bar(6, 112, 58.5, F.bars.u1, true);
      s += bar(126, 234, 58.5, F.bars.u2, true);
      s += bar(6, 112, 69.5, F.bars.l1, false).replace(/<line[^>]*y1="66"[^>]*\/>/, '');
      s += bar(126, 234, 69.5, F.bars.l2, false).replace(/<line[^>]*y1="66"[^>]*\/>/, '');
    }

    s += battery(3, 128, 22, 12, all ? 3 : F.batt, true);
    s += draw14(30, 125, 17, all ? '**********' : F.text.padEnd(10, ' ').slice(0, 10), { ghost: true, pitch: 13.6 });
    if (F.clock || all) s += draw7(182, 127, 15, all ? '88:88' : F.clock, { pitch: 12.5, n: 4 });
    if (F.small) s += draw7(190, 127, 15, F.small, { pitch: 12.5, n: 3 });
    if (F.volt) s += text(228, 108, 9, 'V', { italic: true });

    return { svg: s, bg: lit ? '#cfe3a2' : '#b8c2b2' };
  }

  // ------------------------------------------------------------------ help text (free practice)
  help() {
    const m = this.mode;
    if (this.fault) return 'Fault alarm: remove the cause, then press ▼/RESET.';
    switch (m) {
      case 'off': return 'Power ON: hold POWER/ENTER ~3 s. Maintenance mode: hold ▲+▼, then press POWER.';
      case 'start': return 'Start-up self-check… wait for detection mode (beep-beep).';
      case 'detect': return 'Detection: hold ▲/AIR = air calibration · DISPLAY = display menu · hold ▼ + press DISPLAY = calibration mode · ▼/RESET = reset alarm · hold POWER = off.';
      case 'air': return this.st.phase === 'view' ? 'Hold ▲/AIR until RELEASE appears. DISPLAY = back.' : 'Keep holding ▲/AIR until RELEASE, then let go.';
      case 'disp': return 'Display mode: DISPLAY = next item · ENTER = open item. Returns to detection after ~20 s.';
      case 'menu': return 'Menu: ▲/▼ = move · ENTER = select.';
      case 'pw': return 'Password: ▲/▼ = change digit · ENTER = next digit. (0008)';
      case 'autocal': return { conc: 'Check span-gas values. DISPLAY = start (supply gas) · hold ▼ + DISPLAY = change values.', supply: 'Supply the span gas, wait ~60 s until stable, then ENTER.' }[this.st.phase] || '▲/▼ + ENTER';
      case 'onecal': return this.st.phase === 'adjust' ? 'Supply gas, wait until stable, ▲/▼ = set reading to cylinder value, ENTER = adjust.' : '▲/▼ = choose gas · ENTER = select.';
      case 'bump': return { conc: 'Check test-gas values match the cylinder. Supply gas, then ENTER.', result: 'P = pass, F = fail. ▲/▼ = values · ENTER = finish.' }[this.st.phase] || 'Keep supplying gas…';
      case 'alarmset': return '▲/▼ = choose gas / change value · ENTER = next.';
      default: return '▲/▼ = change · ENTER = confirm.';
    }
  }
}
