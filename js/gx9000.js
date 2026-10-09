// RIKEN KEIKI GX-9000 (O2 / H2S / CO / CH4 %LEL) — behaviour follows Operating Manual PT0E-2112/2117.
import { MeterBase, Sensor } from './meter-base.js';
import { deviceSVG, KEYPOS } from './device.js';
import { clamp, fmt, roundTo, pad, esc } from './util.js';

const CELL = { O2: [0, 0], H2S: [1, 0], CO: [2, 0], LEL: [2, 1] };
const USER_ITEMS = ['BUMP TEST', 'GAS CAL', 'ALARM SETTING', 'BUZZER SETTING', 'DATE', 'LANGUAGE', 'VERSION', 'START MEASURE'];
const CYL_ITEMS = ['CYLINDER A', 'ESCAPE', 'START MEASURE'];
const GASCAL_ITEMS = ['AIR CAL', 'SPAN CAL', 'ESCAPE', 'START MEASURE'];
const ALARM_ITEMS = ['ALARM POINTS', 'ALARM LATCHING', 'ESCAPE'];
const DISP_ITEMS = ['PEAK', 'STEL', 'TWA', 'USER ID', 'STATION ID', 'REC DATA DISP', 'DATE', 'GAS NAME', 'ALARM POINTS', 'BUZZER VOLUME'];
const PTS_SEL = ['O2', 'H2S', 'CO', 'LEL', 'ESC'];
const AP_VIEWS = ['FULL SCALE', 'WARNING', 'ALARM', 'STEL', 'TWA'];
const AP_KEY = { 'FULL SCALE': 'fs', WARNING: 'w', ALARM: 'a', STEL: 'stel', TWA: 'twa' };
const START = ['ALL', 'DATE', 'BATTERY', 'ALARM TYPE', 'NEXT MAINT DATE', 'GAS NAME', 'FULL SCALE', 'WARNING', 'ALARM', 'STEL', 'TWA', 'USER ID', 'STATION ID'];

export class GX9000 extends MeterBase {
  constructor(app) {
    super(app);
    this.model = 'GX-9000';
    this.sensors = [
      new Sensor({ id: 'O2', name: 'O2', unit: '%', resp: 'O2', res: 0.1, fs: 25, max: 40, tau: 8.7, kind: 'o2', airTol: 2,
        alarm: { type: 'L-H', w: 19.5, a: 23.5, over: 40 } }),
      new Sensor({ id: 'H2S', name: 'H2S', unit: 'ppm', resp: 'H2S', res: 0.1, fs: 30, max: 200, tau: 13, airTol: 3,
        alarm: { type: 'H-HH', w: 1.0, a: 10.0, stel: 5.0, twa: 1.0, over: 200 } }),
      new Sensor({ id: 'CO', name: 'CO', unit: 'ppm', resp: 'CO', res: 1, fs: 150, max: 2000, tau: 13, airTol: 15,
        alarm: { type: 'H-HH', w: 25, a: 50, stel: 200, twa: 25, over: 2000 } }),
      new Sensor({ id: 'LEL', name: 'CH4', unit: '%LEL', resp: 'LEL_CH4', res: 1, fs: 100, max: 100, tau: 13, kind: 'lel', airTol: 10,
        alarm: { type: 'H-HH', w: 10, a: 50, over: 100 } }),
    ];
    this.span = { O2: 12.0, H2S: 25.0, CO: 50, LEL: 50 };
    this.bumpSet = { time: 30, range: 50, adj: 90, auto: true };
    this.latching = true;
    this.buzzerOn = true;
    this.anyKeyStopsTest = false;
    this.userId = '----------';
    this.stationId = 0;
    this.drift = {
      normal: { O2: { gain: 0.984, off: 0 }, H2S: { gain: 0.96, off: 0.3 }, CO: { gain: 1.04, off: 3 }, LEL: { gain: 0.96, off: 2 } },
    };
    this.persist.push('span', 'bumpSet', 'latching', 'buzzerOn', 'buzzerHigh', 'userId');
    this.applyDrift();
    this.backlight = 0;
  }

  static cylinders = ['MIX4', 'N2', 'ZAIR'];

  svg() {
    return deviceSVG({
      model: 'GX-9000', theme: 'black', lcdBg: '#e3e7e2', lcdViewBox: '0 0 256 150',
      keys: [
        { key: 'up', ...KEYPOS.leftTop, l1: '▲', l2: 'AIR' },
        { key: 'down', ...KEYPOS.leftBot, l1: 'RESET', l2: '▼', small: true },
        { key: 'mode', ...KEYPOS.rightTop, l1: 'DISP', l2: 'ESC' },
        { key: 'enter', ...KEYPOS.rightBot, l1: 'POWER', l2: 'ENTER', small: true },
      ],
    });
  }

  keyNames() { return { up: '▲/AIR', down: 'RESET/▼', mode: 'DISP/ESC', enter: 'POWER/ENTER' }; }

  pumpActive() { return !['poweroff', 'pumpoff'].includes(this.mode) && !(this.mode === 'start' && this.st.i === 0); }
  flowCheckActive() { return !['start', 'poweroff', 'pumpoff'].includes(this.mode); }
  measuring() { return ['meas', 'disp'].includes(this.mode) && !this.alarmTest; }
  powerOnInstant() { this.forceMeasuring(); this.go('meas'); }
  menuGo(mode, items, name) { this.go(mode, { i: Math.max(0, items.indexOf(name)) }); }

  // ------------------------------------------------------------------ keys
  onKeyDown(k) {
    this.backlight = 10;
    if (['off', 'start', 'poweroff'].includes(this.mode)) return;
    if (this.fault) { if (k !== 'up') this.tryResetFault(); return; }
    const f = this['k_' + this.mode];
    if (f) f.call(this, k);
  }

  k_meas(k) {
    if (k === 'down') {
      this.resetAlarms();
      if (this.down('up')) this.snapLog();
    }
    if (k === 'up' && this.down('down')) this.snapLog();
    if (k === 'mode') this.go('disp', { item: 0, sub: null });
  }

  snapLog() {
    this.consume('up'); this.consume('down');
    const vals = {};
    for (const s of this.sensors) vals[s.id] = s.reading();
    this.mem.push({ t: this.now(), vals });
    this.go('msg', { lines: ['SNAP LOGGER', 'SAVED'], title: 'REC DATA', t: 0, next: () => this.go('meas') });
  }

  k_pumpoff(k) {
    if (k === 'down') { this.consume('down'); this.st.hold = true; }
  }

  k_disp(k) {
    const st = this.st;
    const item = DISP_ITEMS[st.item];
    if (st.sub === 'ap') {
      if (k === 'down' && this.alarmTest) { this.alarmTest = null; return; }
      if (k === 'up') st.view = (st.view + 1) % AP_VIEWS.length;
      if (k === 'enter') this.startAlarmTest({ 'FULL SCALE': 3, WARNING: 1, ALARM: 2, STEL: 5, TWA: 4 }[AP_VIEWS[st.view]]);
      if (k === 'mode') { this.alarmTest = null; st.sub = null; }
      return;
    }
    if (st.sub === 'rec') {
      const n = this.mem.length;
      if (k === 'mode') { st.sub = null; return; }
      if (!n) return;
      if (k === 'up') st.sel = (st.sel + 1) % n;
      if (k === 'down') st.sel = (st.sel + n - 1) % n;
      return;
    }
    if (k === 'mode') {
      st.item++;
      if (st.item >= DISP_ITEMS.length) this.go('meas');
    } else if (k === 'enter') {
      if (item === 'ALARM POINTS') { st.sub = 'ap'; st.view = 0; }
      if (item === 'REC DATA DISP') { st.sub = 'rec'; st.sel = Math.max(0, this.mem.length - 1); }
      if (item === 'BUZZER VOLUME') this.buzzerHigh = !this.buzzerHigh;
    }
  }

  // generic list menu
  listKey(k, items, onEnter, onEsc) {
    const st = this.st;
    if (k === 'up') st.i = (st.i + items.length - 1) % items.length;
    if (k === 'down') st.i = (st.i + 1) % items.length;
    if (k === 'enter') onEnter(items[st.i]);
    if (k === 'mode' && onEsc) onEsc();
  }

  k_user(k) {
    this.listKey(k, USER_ITEMS, name => {
      switch (name) {
        case 'BUMP TEST': this.go('bumpmenu', { i: 0 }); break;
        case 'GAS CAL': this.go('gascal', { i: 0 }); break;
        case 'ALARM SETTING': this.go('alarmmenu', { i: 0 }); break;
        case 'BUZZER SETTING': this.go('toggle', { name, key: 'buzzerOn', val: this.buzzerOn }); break;
        case 'DATE': this.go('msg', { lines: [this.dateText(), this.clockText()], title: 'DATE', wait: true, next: () => this.menuGo('user', USER_ITEMS, 'DATE') }); break;
        case 'LANGUAGE': this.go('msg', { lines: ['ENGLISH'], title: 'LANGUAGE', wait: true, next: () => this.menuGo('user', USER_ITEMS, 'LANGUAGE') }); break;
        case 'VERSION': this.go('msg', { lines: ['MAIN  Ver.1.00', 'SENSOR Ver.1.00'], title: 'VERSION', wait: true, next: () => this.menuGo('user', USER_ITEMS, 'VERSION') }); break;
        case 'START MEASURE': this.startMeasure(); break;
      }
    });
  }

  startMeasure() { this.userActive = false; this.buzzer.blip(); this.go('start', { i: 0, t: 0 }); }

  k_bumpmenu(k) {
    this.listKey(k, CYL_ITEMS, name => {
      if (name === 'CYLINDER A') this.go('bumprun', { phase: 'test', t: this.bumpSet.time });
      else if (name === 'ESCAPE') this.menuGo('user', USER_ITEMS, 'BUMP TEST');
      else this.startMeasure();
    });
  }

  k_bumprun(k) {
    const st = this.st;
    if ((st.phase === 'test' || st.phase === 'cal') && k === 'mode') { this.go('bumpmenu', { i: 0 }); return; }
    if (st.phase === 'result') {
      const n = st.cal ? 3 : 2;
      if (k === 'up') st.view = (st.view + n - 1) % n;
      if (k === 'down') st.view = (st.view + 1) % n;
      if (k === 'enter') this.go('msg', { lines: ['END'], title: 'BUMP TEST', t: 0, next: () => this.go('bumpmenu', { i: 0 }) });
    }
  }

  k_gascal(k) {
    this.listKey(k, GASCAL_ITEMS, name => {
      if (name === 'AIR CAL') this.go('uair', { phase: 'view', t: 0 });
      else if (name === 'SPAN CAL') this.go('spanmenu', { i: 0 });
      else if (name === 'ESCAPE') this.menuGo('user', USER_ITEMS, 'GAS CAL');
      else this.startMeasure();
    }, () => this.menuGo('user', USER_ITEMS, 'GAS CAL'));
  }

  k_uair(k) { if (this.st.phase === 'view' && k === 'mode') this.menuGo('gascal', GASCAL_ITEMS, 'AIR CAL'); }

  k_spanmenu(k) {
    this.listKey(k, CYL_ITEMS, name => {
      if (name === 'CYLINDER A') this.go('spanrun', { phase: 'supply', t: 0 });
      else if (name === 'ESCAPE') this.menuGo('gascal', GASCAL_ITEMS, 'SPAN CAL');
      else this.startMeasure();
    }, () => this.menuGo('gascal', GASCAL_ITEMS, 'SPAN CAL'));
  }

  k_spanrun(k) {
    const st = this.st;
    if (st.phase !== 'supply') return;
    if (k === 'mode') this.go('spanmenu', { i: 0 });
    if (k === 'enter') { st.phase = 'adjusting'; st.t = 0; }
  }

  k_alarmmenu(k) {
    this.listKey(k, ALARM_ITEMS, name => {
      if (name === 'ALARM POINTS') this.go('alarmpts', { phase: 'sel', sel: 0 });
      else if (name === 'ALARM LATCHING') this.go('toggle', { name, key: 'latching', val: this.latching });
      else this.menuGo('user', USER_ITEMS, 'ALARM SETTING');
    }, () => this.menuGo('user', USER_ITEMS, 'ALARM SETTING'));
  }

  k_alarmpts(k) {
    const st = this.st;
    if (st.phase === 'sel') {
      if (k === 'up') st.sel = (st.sel + PTS_SEL.length - 1) % PTS_SEL.length;
      if (k === 'down') st.sel = (st.sel + 1) % PTS_SEL.length;
      if (k === 'mode') this.menuGo('alarmmenu', ALARM_ITEMS, 'ALARM POINTS');
      if (k === 'enter') {
        const id = PTS_SEL[st.sel];
        if (id === 'ESC') { this.menuGo('alarmmenu', ALARM_ITEMS, 'ALARM POINTS'); return; }
        const a = this.S(id).alarm;
        st.fields = a.stel != null ? ['w', 'a', 'stel', 'twa'] : ['w', 'a'];
        st.fi = 0; st.tmp = { ...a }; st.val = a.w; st.phase = 'edit';
      }
    } else if (st.phase === 'edit') {
      const s = this.S(PTS_SEL[st.sel]);
      if (k === 'up') st.val = clamp(roundTo(st.val + s.res, s.res), 0, s.max);
      if (k === 'down') st.val = clamp(roundTo(st.val - s.res, s.res), 0, s.max);
      if (k === 'mode') {
        if (st.fi === 0) st.phase = 'sel';
        else { st.fi--; st.val = st.tmp[st.fields[st.fi]]; }
      }
      if (k === 'enter') {
        st.tmp[st.fields[st.fi]] = st.val;
        st.fi++;
        if (st.fi >= st.fields.length) {
          Object.assign(s.alarm, st.tmp);
          const sel = st.sel;
          this.go('msg', { lines: ['END'], title: 'ALARM POINTS', t: 0, next: () => this.go('alarmpts', { phase: 'sel', sel }) });
        } else st.val = st.tmp[st.fields[st.fi]];
      }
    }
  }

  k_toggle(k) {
    const st = this.st;
    if (k === 'up' || k === 'down') st.val = !st.val;
    if (k === 'enter' || k === 'mode') {
      if (k === 'enter') this[st.key] = st.val;
      if (st.name === 'ALARM LATCHING') this.menuGo('alarmmenu', ALARM_ITEMS, st.name);
      else this.menuGo('user', USER_ITEMS, st.name);
    }
  }

  k_msg(k) {
    if (this.st.wait && (k === 'enter' || k === 'mode')) this.st.next();
  }

  onKeyUp() {}

  // ------------------------------------------------------------------ update
  update(dt, rdt) {
    this.backlight = Math.max(0, this.backlight - rdt);
    const st = this.st;
    const m = this.mode;
    if (m === 'off') {
      if (this.down('enter') && this.down('up') && this.held('enter') > 0.6 && this.held('up') > 0.6) {
        this.consume('enter'); this.consume('up');
        this.buzzer.blip(); this.forceMeasuring();
        this.userActive = true;
        this.go('user', { i: 0 });
      } else if (this.down('enter') && !this.down('up') && this.held('enter') >= 2.5 && !this.keys.enter.consumed) {
        this.consume('enter'); this.buzzer.blip(); this.forceMeasuring();
        this.userActive = false;
        this.go('start', { i: 0, t: 0 });
      }
      return;
    }
    if (!this.latching) this.resetAlarms();
    if (['meas', 'disp'].includes(m) && !this.fault && this.down('enter') && !this.keys.enter.consumed && this.held('enter') >= 3) {
      this.consume('enter'); this.beep();
      this.go('poweroff', { t: 0 });
      return;
    }
    if (this.fault) return;
    switch (m) {
      case 'start':
        st.t += dt;
        if (st.t >= (st.i === 0 ? 1.8 : 1.25)) {
          st.t = 0; st.i++;
          if (st.i >= START.length) { this.go('meas'); this.buzzer.blip(); setTimeout(() => this.buzzer.blip(), 160); }
        }
        break;
      case 'poweroff':
        st.t += rdt;
        if (st.t > 1.4) this.powerOffNow();
        break;
      case 'meas':
        if (this.down('up') && !this.down('down') && !this.keys.up.consumed && this.held('up') > 0.5) {
          this.consume('up');
          this.go('air', { phase: 'hold', t: 0, from: 'meas' });
        } else if (this.down('down') && !this.down('up') && !this.keys.down.consumed && this.held('down') > 3) {
          this.consume('down'); this.beep(); this.pumpOn = false;
          this.go('pumpoff', {});
        }
        break;
      case 'pumpoff':
        if (st.hold && this.down('down') && this.held('down') > 1.5) { st.hold = false; this.beep(); this.pumpOn = true; this.go('meas'); }
        if (!this.down('down')) st.hold = false;
        break;
      case 'disp':
        if (st.sub == null && DISP_ITEMS[st.item] === 'PEAK' && this.down('up') && this.held('up') > 3 && !this.keys.up.consumed) {
          this.consume('up'); this.beep();
          for (const s of this.sensors) s.peak = null;
        }
        if (this.idle > 20 && !this.alarmTest) this.go('meas');
        break;
      case 'air': case 'uair': this.updateAir(rdt); break;
      case 'bumprun': this.updateBump(dt, rdt); break;
      case 'spanrun':
        st.t += st.phase === 'supply' ? dt : rdt;
        if (st.phase === 'adjusting' && st.t > 1.6) {
          const failed = this.sensors.filter(s => !s.spanCal(this.span[s.id])).map(s => s.id);
          if (failed.length) this.setFault({ kind: 'cal', text: 'SPAN CAL', ids: failed, after: () => this.go('spanmenu', { i: 0 }) });
          else { st.phase = 'pass'; st.t = 0; }
        } else if (st.phase === 'pass' && st.t > 1.3) { st.phase = 'after'; st.t = 0; }
        else if (st.phase === 'after' && st.t > 1.5) this.go('spanmenu', { i: 0 });
        break;
      case 'msg':
        st.t = (st.t || 0) + rdt;
        if (!st.wait && st.t > 1.1) st.next();
        break;
    }
  }

  updateAir(rdt) {
    const st = this.st;
    st.t += rdt;
    const back = () => (this.mode === 'uair' ? this.menuGo('gascal', GASCAL_ITEMS, 'AIR CAL') : this.go('meas'));
    switch (st.phase) {
      case 'view':
        if (this.down('up') && this.held('up') > 0.35) { this.consume('up'); st.phase = 'hold'; st.t = 0; }
        break;
      case 'hold':
        if (!this.down('up')) return back();
        if (st.t > 2.2) { st.phase = 'release'; st.t = 0; this.beep(); }
        break;
      case 'release':
        if (!this.down('up')) { st.phase = 'adj'; st.t = 0; }
        break;
      case 'adj':
        if (st.t > 1.2) {
          const failed = this.sensors.filter(s => !s.airCal()).map(s => s.id);
          if (failed.length) this.setFault({ kind: 'cal', text: 'AIR CAL', ids: failed, after: back });
          else { st.phase = 'pass'; st.t = 0; }
        }
        break;
      case 'pass': if (st.t > 1.3) { st.phase = 'after'; st.t = 0; } break;
      case 'after': if (st.t > 1.3) back(); break;
    }
  }

  updateBump(dt, rdt) {
    const st = this.st;
    if (st.phase === 'test') {
      st.t -= dt;
      if (st.t <= 0) {
        st.vals = {}; st.pass = {};
        for (const s of this.sensors) {
          st.vals[s.id] = s.reading();
          st.pass[s.id] = s.bumpPass(st.vals[s.id], this.span[s.id], this.bumpSet.range);
        }
        if (Object.values(st.pass).every(Boolean) || !this.bumpSet.auto) { st.phase = 'result'; st.view = 0; st.cal = false; this.beep(); }
        else { st.phase = 'cal'; st.t = this.bumpSet.adj - this.bumpSet.time; }
      }
    } else if (st.phase === 'cal') {
      st.t -= dt;
      if (st.t <= 0) { st.phase = 'adjusting'; st.t = 0; }
    } else if (st.phase === 'adjusting') {
      st.t += rdt;
      if (st.t > 1.6) {
        st.calPass = {}; st.calVals = {};
        for (const s of this.sensors) {
          st.calPass[s.id] = st.pass[s.id] ? true : s.spanCal(this.span[s.id]);
          st.calVals[s.id] = s.reading();
        }
        st.phase = 'result'; st.view = 0; st.cal = true; this.beep();
      }
    }
  }

  dateText() {
    const d = this.now();
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  // ------------------------------------------------------------------ screen model
  // returns { kind: 'grid'|'menu'|'msg'|'all', ... }
  screen() {
    const st = this.st;
    if (this.mode === 'off') return null;
    const chip = this.userActive ? 'MAINT.' : null;
    const S = { chip, heart: true, fan: this.pumpOn && this.flowOk && this.mode !== 'poweroff' };
    const live = () => this.liveCells();

    if (this.fault) {
      const cells = this.fault.ids ? live() : {};
      for (const id of this.fault.ids || []) cells[id].val = 'FAIL';
      if (!this.fault.ids) return { ...S, kind: 'msg', lines: ['FAIL', this.fault.text], title: 'FAULT' };
      return { ...S, kind: 'grid', cells, bottom: this.fault.text };
    }

    switch (this.mode) {
      case 'start': return this.startScreen(S, START[st.i]);
      case 'poweroff': return { ...S, kind: 'msg', lines: ['POWER OFF'], title: '' };
      case 'meas': {
        const cells = live();
        const top = this.topAlarm();
        for (const id in this.latched) cells[id].inv = this.blinkOn(this.latched[id] >= 2 ? 2 : 1);
        return { ...S, heart: this.blinkOn(1), kind: 'grid', cells, bottom: top ? this.alarmName(top) : '' };
      }
      case 'pumpoff': return { ...S, kind: 'grid', cells: live(), bottom: 'PUMP OFF', fan: false };
      case 'air': case 'uair': {
        const title = 'AIR CAL';
        switch (st.phase) {
          case 'view': return { ...S, kind: 'grid', cells: live(), bottom: title };
          case 'hold': return { ...S, kind: 'msg', lines: ['HOLD AIR BUTTON'], title };
          case 'release': case 'adj': return { ...S, kind: 'msg', lines: ['ADJUSTING AIR'], title: 'RELEASE', titleCenter: true };
          case 'pass': return { ...S, kind: 'msg', lines: ['PASS'], title };
          case 'after': return { ...S, kind: 'grid', cells: live(), bottom: title };
        }
        break;
      }
      case 'disp': return this.dispScreen(S);
      case 'user': return { ...S, kind: 'menu', items: USER_ITEMS, i: st.i, title: 'USER MODE' };
      case 'gascal': return { ...S, kind: 'menu', items: GASCAL_ITEMS, i: st.i, title: 'GAS CAL' };
      case 'alarmmenu': return { ...S, kind: 'menu', items: ALARM_ITEMS, i: st.i, title: 'ALARM SETTING' };
      case 'spanmenu': {
        const name = CYL_ITEMS[st.i];
        if (name === 'CYLINDER A') return { ...S, kind: 'grid', cells: this.valueCells(this.span), bottom: 'CYLINDER A', note: 'SPAN CAL' };
        return { ...S, kind: 'msg', lines: [name], title: 'SPAN CAL' };
      }
      case 'bumpmenu': {
        const name = CYL_ITEMS[st.i];
        if (name === 'CYLINDER A') return { ...S, kind: 'grid', cells: this.valueCells(this.span), bottom: 'CYLINDER A' };
        return { ...S, kind: 'msg', lines: [name], title: 'BUMP TEST' };
      }
      case 'bumprun': {
        if (st.phase === 'test') return { ...S, kind: 'grid', cells: live(), bottom: 'BUMP TEST', right: String(Math.max(0, Math.ceil(st.t))) };
        if (st.phase === 'cal') return { ...S, kind: 'grid', cells: live(), bottom: 'SPAN CAL', right: String(Math.max(0, Math.ceil(st.t))) };
        if (st.phase === 'adjusting') return { ...S, kind: 'msg', lines: ['ADJUSTING'], title: 'SPAN CAL' };
        if (st.view === 0) {
          const cells = {};
          for (const s of this.sensors) cells[s.id] = { name: s.name, unit: s.unit, val: (st.pass[s.id] ? 'P' : 'F') + (st.cal ? (st.calPass[s.id] ? 'P' : 'F') : '') };
          return { ...S, kind: 'grid', cells, bottom: 'RESULT' };
        }
        if (st.view === 1) return { ...S, kind: 'grid', cells: this.valueCells(st.vals), bottom: 'BUMP TEST' };
        return { ...S, kind: 'grid', cells: this.valueCells(st.calVals), bottom: 'SPAN CAL' };
      }
      case 'spanrun': {
        if (st.phase === 'supply') return { ...S, kind: 'grid', cells: live(), bottom: 'SPAN CAL', right: `${Math.floor(st.t)}s` };
        if (st.phase === 'adjusting') return { ...S, kind: 'msg', lines: ['ADJUSTING'], title: 'SPAN CAL' };
        if (st.phase === 'pass') return { ...S, kind: 'msg', lines: ['PASS'], title: 'SPAN CAL' };
        return { ...S, kind: 'grid', cells: live(), bottom: 'SPAN CAL' };
      }
      case 'alarmpts': {
        if (st.phase === 'sel') {
          const id = PTS_SEL[st.sel];
          if (id === 'ESC') return { ...S, kind: 'msg', lines: ['ESCAPE'], title: 'ALARM POINTS' };
          const s = this.S(id);
          return { ...S, kind: 'grid', cells: { [id]: { name: s.name, unit: s.unit, val: '---' } }, bottom: 'ALARM POINTS' };
        }
        const s = this.S(PTS_SEL[st.sel]);
        const f = st.fields[st.fi];
        return { ...S, kind: 'grid', cells: { [s.id]: { name: s.name, unit: s.unit, val: this.blinkOn(2) ? fmt(st.val, s.res) : '', bar: s.barFrac(st.val) } }, bottom: { w: 'WARNING', a: 'ALARM', stel: 'STEL', twa: 'TWA' }[f] };
      }
      case 'toggle': return { ...S, kind: 'msg', lines: [this.blinkOn(2) ? (st.val ? 'ON' : 'OFF') : ''], title: st.name };
      case 'msg': return { ...S, kind: 'msg', lines: st.lines, title: st.title };
    }
    return { ...S, kind: 'msg', lines: [''], title: '' };
  }

  liveCells() {
    const cells = {};
    for (const s of this.sensors) {
      const v = s.reading();
      cells[s.id] = { name: s.name, unit: s.unit, val: s.text(v), bar: s.barFrac(v) };
    }
    return cells;
  }

  valueCells(vals) {
    const cells = {};
    for (const s of this.sensors) {
      const v = vals[s.id];
      if (v == null) continue;
      cells[s.id] = { name: s.name, unit: s.unit, val: s.text(v), bar: s.barFrac(v) };
    }
    return cells;
  }

  alarmCells(which) {
    const cells = {};
    for (const s of this.sensors) {
      const v = which === 'fs' ? s.max : s.alarm[which];
      cells[s.id] = { name: s.name, unit: s.unit, val: v == null ? '---' : fmt(v, s.res), bar: v == null ? 0 : s.barFrac(v) };
    }
    return cells;
  }

  startScreen(S, name) {
    switch (name) {
      case 'ALL': return { kind: 'all' };
      case 'DATE': return { ...S, kind: 'msg', lines: ['YYYY/MM/DD', this.dateText(), this.clockText()], title: 'DATE' };
      case 'BATTERY': return { ...S, kind: 'msg', lines: ['BATTERY', '4.0V', 'Li-ion'], title: '', right: 'LATCHING' };
      case 'ALARM TYPE': {
        const cells = {};
        for (const s of this.sensors) cells[s.id] = { name: s.name, unit: s.unit, val: s.alarm.type, small: true };
        return { ...S, kind: 'grid', cells, bottom: 'ALARM TYPE' };
      }
      case 'NEXT MAINT DATE': return { ...S, kind: 'msg', lines: ['365 DAYS'], title: 'NEXT MAINT DATE' };
      case 'GAS NAME': {
        const cells = {};
        for (const s of this.sensors) cells[s.id] = { name: s.name, unit: s.unit, val: s.name, small: true };
        return { ...S, kind: 'grid', cells, bottom: 'GAS NAME' };
      }
      case 'FULL SCALE': return { ...S, kind: 'grid', cells: this.alarmCells('fs'), bottom: 'FULL SCALE' };
      case 'WARNING': return { ...S, kind: 'grid', cells: this.alarmCells('w'), bottom: 'WARNING' };
      case 'ALARM': return { ...S, kind: 'grid', cells: this.alarmCells('a'), bottom: 'ALARM' };
      case 'STEL': return { ...S, kind: 'grid', cells: this.alarmCells('stel'), bottom: 'STEL' };
      case 'TWA': return { ...S, kind: 'grid', cells: this.alarmCells('twa'), bottom: 'TWA' };
      case 'USER ID': return { ...S, kind: 'msg', lines: ['USER ID', this.userId], title: '' };
      case 'STATION ID': return { ...S, kind: 'msg', lines: ['STATION ID', `ST-ID${pad(this.stationId, 3)}`], title: '' };
    }
    return { ...S, kind: 'msg', lines: [''], title: '' };
  }

  dispScreen(S) {
    const st = this.st;
    const item = DISP_ITEMS[st.item];
    if (st.sub === 'ap') {
      const v = AP_VIEWS[st.view];
      const cells = this.alarmCells(AP_KEY[v]);
      if (this.alarmTest) for (const id in cells) cells[id].inv = this.lamp;
      return { ...S, kind: 'grid', cells, bottom: v, right: this.alarmTest ? 'TEST' : '' };
    }
    if (st.sub === 'rec') {
      if (!this.mem.length) return { ...S, kind: 'msg', lines: ['NO DATA'], title: 'REC DATA DISP' };
      const e = this.mem[st.sel];
      return { ...S, kind: 'grid', cells: this.valueCells(e.vals), bottom: `No.${pad(st.sel + 1, 3)} ${e.t.getHours()}:${pad(e.t.getMinutes())}` };
    }
    switch (item) {
      case 'PEAK': {
        const vals = {};
        for (const s of this.sensors) vals[s.id] = s.peak ?? s.reading();
        return { ...S, kind: 'grid', cells: this.valueCells(vals), bottom: 'PEAK' };
      }
      case 'STEL': case 'TWA': {
        const vals = {};
        for (const s of this.sensors) if (!s.isO2 && s.alarm.stel != null) vals[s.id] = item === 'STEL' ? s.stel : s.twa;
        return { ...S, kind: 'grid', cells: this.valueCells(vals), bottom: item };
      }
      case 'USER ID': return { ...S, kind: 'msg', lines: [this.userId], title: 'USER ID' };
      case 'STATION ID': return { ...S, kind: 'msg', lines: [`ST-ID${pad(this.stationId, 3)}`], title: 'STATION ID' };
      case 'REC DATA DISP': return { ...S, kind: 'msg', lines: ['REC DATA DISP', 'ENTER: VIEW'], title: 'DISPLAY' };
      case 'DATE': return { ...S, kind: 'msg', lines: [this.dateText(), this.clockText(), '24.0°C'], title: 'DATE' };
      case 'GAS NAME': {
        const cells = {};
        for (const s of this.sensors) cells[s.id] = { name: s.name, unit: s.unit, val: s.name, small: true };
        return { ...S, kind: 'grid', cells, bottom: 'GAS NAME' };
      }
      case 'ALARM POINTS': return { ...S, kind: 'msg', lines: ['ALARM POINTS', 'ENTER: VIEW/TEST'], title: 'DISPLAY' };
      case 'BUZZER VOLUME': return { ...S, kind: 'msg', lines: [this.buzzerHigh === false ? 'LOW' : 'HIGH'], title: 'BUZZER VOLUME' };
    }
    return { ...S, kind: 'msg', lines: [item], title: 'DISPLAY' };
  }

  // ------------------------------------------------------------------ render
  renderLCD() {
    const sc = this.screen();
    const lit = this.backlight > 0 && this.mode !== 'off';
    if (!sc) return { svg: '', bg: '#cfd4cf' };
    const INK = 'var(--seg-on)';
    const T = (x, y, size, str, o = {}) =>
      `<text x="${x}" y="${y}" font-size="${size}" fill="${o.fill || INK}" font-family="${o.font || 'Share Tech Mono, Consolas, monospace'}" font-weight="${o.weight || 400}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(str)}</text>`;
    if (sc.kind === 'all') return { svg: `<rect x="1" y="1" width="254" height="148" fill="${INK}"/>`, bg: '#e3e7e2' };

    let s = '';
    // status bar
    if (sc.heart) s += `<path transform="translate(4,3) scale(0.85)" d="M0 3 C0 -1 5 -1 5 2.5 C5 -1 10 -1 10 3 C10 6 6 8 5 10 C4 8 0 6 0 3Z" fill="${INK}"/>`;
    s += `<path d="M18 8 l2.5 3 l5 -6" stroke="${INK}" stroke-width="1.6" fill="none"/>`;
    if (sc.fan) {
      s += `<g transform="translate(37,8) rotate(${this.fanAngle.toFixed(0)})" fill="${INK}">`;
      for (let i = 0; i < 3; i++) s += `<path transform="rotate(${i * 120})" d="M0 0 C1.5 -2.5 4.5 -3 5.5 -0.8 Z"/>`;
      s += `</g>`;
    }
    const chip = sc.chip || (!this.alarmsEnabled ? 'NO ALARM' : null);
    if (chip) s += `<rect x="50" y="2" width="44" height="11" rx="2" fill="${INK}"/>` + T(72, 10.5, 8, chip, { anchor: 'middle', fill: 'var(--lcd-bg)', weight: 700 });
    s += T(178, 11, 10, this.clockText(), { anchor: 'end' });
    s += `<path d="M186 6 h3 l4 -3 v10 l-4 -3 h-3z" fill="${INK}"/><path d="M196 4 q3 4 0 8 M199 2 q5 6 0 12" stroke="${INK}" stroke-width="1" fill="none"/>`;
    s += `<rect x="228" y="3" width="22" height="10" rx="1.5" fill="none" stroke="${INK}" stroke-width="1.2"/><rect x="250" y="6" width="2" height="4" fill="${INK}"/>`;
    for (let i = 0; i < 3; i++) s += `<rect x="${230 + i * 6.5}" y="5" width="5" height="6" fill="${INK}"/>`;

    if (sc.kind === 'grid') {
      s += `<line x1="0" y1="16" x2="256" y2="16" stroke="${INK}" stroke-width="0.8"/>`;
      s += `<line x1="86" y1="16" x2="86" y2="128" stroke="${INK}" stroke-width="0.8"/><line x1="171" y1="16" x2="171" y2="128" stroke="${INK}" stroke-width="0.8"/>`;
      s += `<line x1="86" y1="72" x2="256" y2="72" stroke="${INK}" stroke-width="0.8"/>`;
      for (const [id, [cx, cy]] of Object.entries(CELL)) {
        const c = sc.cells[id];
        const x = [0, 86, 171][cx], w = cx === 0 ? 86 : 85, y = cy === 0 ? 16 : 72, h = cy === 0 && cx === 0 ? 112 : 56;
        if (!c) continue;
        if (c.inv) s += `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" fill="${INK}"/>`;
        const fill = c.inv ? 'var(--lcd-bg)' : INK;
        s += T(x + 3, y + 10, 9, c.name, { fill, weight: 700 });
        s += T(x + w - 3, y + 10, 8.5, c.unit, { anchor: 'end', fill });
        const big = cx === 0 && cy === 0 ? 44 : 34;
        const vy = cx === 0 && cy === 0 ? y + 56 : y + 45;
        if (c.val != null && c.val !== '') s += T(x + w - 4, vy, c.small ? 18 : big, c.val, { anchor: 'end', fill, font: 'Barlow Condensed, Arial Narrow, sans-serif', weight: 700 });
        if (c.bar != null && !c.small) {
          const by = cx === 0 && cy === 0 ? y + 64 : y + 50;
          s += `<line x1="${x + 4}" y1="${by + 3}" x2="${x + w - 4}" y2="${by + 3}" stroke="${fill}" stroke-width="0.7"/>`;
          s += `<rect x="${x + 4}" y="${by}" width="${((w - 8) * clamp(c.bar, 0, 1)).toFixed(1)}" height="3" fill="${fill}"/>`;
          for (let i = 0; i <= 4; i++) s += `<line x1="${(x + 4 + ((w - 8) * i) / 4).toFixed(1)}" y1="${by + 3}" x2="${(x + 4 + ((w - 8) * i) / 4).toFixed(1)}" y2="${by + 6}" stroke="${fill}" stroke-width="0.7"/>`;
        }
      }
      s += `<line x1="0" y1="128" x2="256" y2="128" stroke="${INK}" stroke-width="0.8"/>`;
      s += T(4, 143, 12, sc.bottom || '');
      if (sc.right) s += T(252, 143, 12, sc.right, { anchor: 'end' });
    } else if (sc.kind === 'menu') {
      const n = sc.items.length;
      const start = clamp(sc.i - 1, 0, Math.max(0, n - 3));
      for (let r = 0; r < 3 && start + r < n; r++) {
        const idx = start + r;
        s += T(6, 44 + r * 26, 19, (idx === sc.i ? '>' : ' ') + sc.items[idx]);
      }
      s += `<line x1="0" y1="118" x2="256" y2="118" stroke="${INK}" stroke-width="1"/>`;
      s += T(6, 140, 17, sc.title);
    } else {
      const lines = sc.lines || [];
      const n = lines.length;
      lines.forEach((l, i) => s += T(128, 72 - (n - 1) * 12 + i * 24, n > 2 ? 17 : 19, l, { anchor: 'middle' }));
      s += `<line x1="0" y1="118" x2="256" y2="118" stroke="${INK}" stroke-width="1"/>`;
      if (sc.titleCenter) s += T(128, 140, 17, sc.title, { anchor: 'middle' });
      else s += T(6, 140, 17, sc.title || '');
      if (sc.right) s += T(250, 140, 14, sc.right, { anchor: 'end' });
    }
    return { svg: s, bg: lit ? '#f2f8ee' : '#e3e7e2' };
  }

  help() {
    if (this.fault) return 'Fault: remove the cause, then press RESET/▼ (or any key except ▲).';
    switch (this.mode) {
      case 'off': return 'Power ON: hold POWER/ENTER ~3 s. User mode: with power off, hold POWER/ENTER + ▲/AIR together.';
      case 'start': return 'Start-up display… wait for measurement mode.';
      case 'meas': return 'Measurement: hold ▲/AIR = fresh air adjustment · DISP/ESC = display mode · RESET/▼ = reset alarm (hold 3 s = pump off) · hold POWER = off.';
      case 'disp': return 'DISP/ESC = next item · ENTER = open (ALARM POINTS: ▲ = next setpoint, ENTER = alarm test, RESET = stop).';
      case 'user': case 'gascal': case 'alarmmenu': case 'spanmenu': case 'bumpmenu': return '▲/▼ = move cursor · ENTER = select.';
      case 'bumprun': return this.st.phase === 'result' ? '▲/▼ = switch result/values · ENTER = finish.' : 'Keep supplying the test gas…';
      case 'spanrun': return 'Supply the calibration gas, wait ~60 s until stable, then ENTER.';
      case 'uair': case 'air': return 'Hold ▲/AIR until RELEASE appears, then let go.';
      case 'alarmpts': return '▲/▼ = choose / change · ENTER = next · DISP/ESC = back.';
      default: return '▲/▼ + ENTER';
    }
  }
}
