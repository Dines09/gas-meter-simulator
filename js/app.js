import { Buzzer } from './audio.js';
import { Tubes } from './tubes.js';
import { GasWorld } from './gasworld.js';
import { AIR } from './meter-base.js';
import { GX8000 } from './gx8000.js';
import { RX8000 } from './rx8000.js';
import { GX9000 } from './gx9000.js';
import { TASKS } from './tasks.js';
import { store } from './util.js';

const MODELS = { 'GX-8000': GX8000, 'RX-8000': RX8000, 'GX-9000': GX9000 };
const KEYMAP = {
  ArrowUp: 'up', KeyQ: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyA: 'down', KeyS: 'down',
  KeyD: 'mode', KeyM: 'mode', Escape: 'mode',
  Enter: 'enter', KeyE: 'enter', NumpadEnter: 'enter',
};
const SPEEDS = [1, 2, 4];
const $ = s => document.querySelector(s);

class App {
  constructor() {
    this.buzzer = new Buzzer();
    this.buzzer.enabled = store.get('sound', true);
    this.speed = store.get('speed', 2);
    this.stage = $('#stage');
    this.tubes = new Tubes(this, this.stage, $('#tubeCanvas'));
    this.gas = new GasWorld(this, $('#bench'), $('#cylChips'), $('#benchStatus'));
    this.latchedKeys = new Set();
    this.lastLcd = '';
    this.lcdT = 0;
    this.toastT = null;
    this.guideCache = {};

    const ms = $('#modelSelect');
    ms.innerHTML = Object.keys(MODELS).map(m => `<option value="${m}">${m}</option>`).join('');
    ms.onchange = () => this.setModel(ms.value);
    $('#taskSelect').onchange = e => this.startTask(e.target.value);
    $('#speedBtn').onclick = () => {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
      store.set('speed', this.speed);
      this.syncButtons();
      this.toast(`Simulation speed ${this.speed}× (gas response, timers and countdowns)`, true);
    };
    $('#soundBtn').onclick = () => {
      this.buzzer.enabled = !this.buzzer.enabled;
      store.set('sound', this.buzzer.enabled);
      this.syncButtons();
    };
    $('#resetBtn').onclick = () => this.startTask(this.taskId);
    $('#infoBtn').onclick = () => { const d = $('#infoDlg'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); };

    document.addEventListener('pointerdown', () => this.audioUnlock(), { capture: true, passive: true });
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAllKeys());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAllKeys(); });

    this.syncButtons();
    const model = MODELS[store.get('model', 'GX-8000')] ? store.get('model', 'GX-8000') : 'GX-8000';
    ms.value = model;
    this.setModel(model);

    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
  }

  audioUnlock() { this.buzzer.unlock(); }

  syncButtons() {
    $('#speedBtn').textContent = `${this.speed}×`;
    $('#soundBtn').textContent = this.buzzer.enabled ? '🔊' : '🔇';
    $('#soundBtn').classList.toggle('off', !this.buzzer.enabled);
  }

  toast(msg, ok = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('ok', ok);
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------------------------------------------------------------- model / device
  setModel(id) {
    this.modelId = id;
    store.set('model', id);
    const Cls = MODELS[id];
    this.meter = new Cls(this);
    const pane = $('#meterPane');
    pane.innerHTML = this.meter.svg();
    this.devSvg = pane.querySelector('svg');
    this.lcd = pane.querySelector('#lcd');
    this.lcdBg = pane.querySelector('#lcdBg');
    this.lamps = [...pane.querySelectorAll('.lamp')];
    this.lampGlow = pane.querySelector('#lampGlow');
    this.keyEls = {};
    pane.querySelectorAll('.dev-key').forEach(g => this.bindKey(g));
    this.lastLcd = '';
    this.tubes.reset();
    this.tubes.registerPort('meterIn', pane.querySelector('#port-meterIn'), [1, 0]);
    this.gas.setCylinders(Cls.cylinders);
    this.tasks = TASKS[id] || [];
    this.fillTaskSelect();
    const saved = store.get('task.' + id, this.tasks.length ? this.tasks[0].id : 'free');
    this.startTask(this.tasks.some(t => t.id === saved) || saved === 'free' ? saved : 'free');
  }

  fillTaskSelect() {
    const done = new Set(store.get('done.' + this.modelId, []));
    const sel = $('#taskSelect');
    sel.innerHTML = `<option value="free">🧭 Free practice (no guide)</option>` +
      this.tasks.map((t, i) => `<option value="${t.id}">${done.has(t.id) ? '✓' : `${i + 1}.`} ${t.title}</option>`).join('');
  }

  bindKey(g) {
    const key = g.dataset.key;
    this.keyEls[key] = g;
    const press = () => {
      this.meter.keyDown(key);
      g.classList.add('pressed');
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch { /* ignore */ } }
    };
    const release = () => {
      if (this.latchedKeys.has(key)) return;
      this.meter.keyUp(key);
      g.classList.remove('pressed');
    };
    g.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.audioUnlock();
      if (e.shiftKey) {
        if (this.latchedKeys.has(key)) {
          this.latchedKeys.delete(key);
          g.classList.remove('latched');
          release();
        } else {
          this.latchedKeys.add(key);
          g.classList.add('latched');
          press();
        }
        return;
      }
      if (this.latchedKeys.has(key)) return;
      try { g.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      press();
    });
    g.addEventListener('pointerup', release);
    g.addEventListener('pointercancel', release);
    g.addEventListener('lostpointercapture', release);
    g.addEventListener('contextmenu', e => e.preventDefault());
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
    if ($('#infoDlg').open) return;
    const key = KEYMAP[e.code];
    if (!key) return;
    e.preventDefault();
    if (e.repeat) return;
    this.audioUnlock();
    const g = this.keyEls[key];
    if (down) { this.meter.keyDown(key); g && g.classList.add('pressed'); }
    else if (!this.latchedKeys.has(key)) { this.meter.keyUp(key); g && g.classList.remove('pressed'); }
  }

  releaseAllKeys() {
    for (const [key, g] of Object.entries(this.keyEls || {})) {
      if (this.meter.down(key)) this.meter.keyUp(key);
      g.classList.remove('pressed', 'latched');
    }
    this.latchedKeys.clear();
  }

  onTubesChanged() { /* gas world reads connections every tick */ }

  // ---------------------------------------------------------------- tasks
  resetWorld(setup = {}) {
    this.releaseAllKeys();
    this.meter = new MODELS[this.modelId](this);
    this.lastLcd = '';
    this.tubes.reset();
    this.gas.reset({ cyl: setup.cyl });
    const cal = setup.cal || 'drift';
    for (const s of this.meter.sensors) {
      s.raw = s.respond(AIR);
      if (cal === 'perfect') { s.gain = 1; s.off = 0; }
      else if (cal === 'aircal') s.airCal();
    }
    if (setup.power === 'on') this.meter.powerOnInstant();
  }

  startTask(id) {
    this.taskId = id;
    store.set('task.' + this.modelId, id);
    $('#taskSelect').value = id;
    this.task = id === 'free' ? null : this.tasks.find(t => t.id === id);
    this.stepIdx = 0;
    this.stepT = 0;
    this.stepSim = 0;
    this.taskDone = false;
    this.resetWorld(this.task ? this.task.setup : { power: 'off' });
    this.guideCache = {};
    this.renderGuide(true);
  }

  get step() { return this.task ? this.task.steps[this.stepIdx] : null; }

  advance() {
    this.stepIdx++;
    this.stepT = 0;
    this.stepSim = 0;
    const g = $('#guide');
    g.classList.remove('flash'); void g.offsetWidth; g.classList.add('flash');
    if (this.step && this.step.final) this.completeTask();
    this.renderGuide(true);
  }

  completeTask() {
    this.taskDone = true;
    const done = new Set(store.get('done.' + this.modelId, []));
    done.add(this.task.id);
    store.set('done.' + this.modelId, [...done]);
    this.fillTaskSelect();
    $('#taskSelect').value = this.taskId;
    this.toast('Lesson complete ✔', true);
  }

  updateGuide(rdt, dt) {
    const step = this.step;
    if (step && !step.final && !step.ack) {
      this.stepT += rdt;
      this.stepSim += dt;
      if (this.stepT > 0.6 && (!step.minSim || this.stepSim >= step.minSim) && step.done(this)) this.advance();
    }
    this.renderGuide();
  }

  renderGuide(force = false) {
    const g = $('#guide');
    const val = v => (typeof v === 'function' ? v(this) : v) || '';
    let mode, count, text, sub, pct, cls;
    if (!this.task) {
      mode = 'FREE'; count = this.modelId; text = 'Free practice — use the meter and the gas bench any way you like.';
      sub = this.meter.help(); pct = 0; cls = 'free';
    } else {
      const step = this.step;
      const n = this.task.steps.length - 1;
      mode = this.taskDone ? 'DONE' : 'LEARN';
      count = `${this.task.title} · ${Math.min(this.stepIdx + 1, n)}/${n}`;
      text = val(step.t);
      sub = val(step.sub);
      pct = this.taskDone ? 100 : (this.stepIdx / n) * 100;
      cls = this.taskDone ? 'done' : '';
      if (step.ack) sub += `${sub ? '<br>' : ''}<button class="next-btn" data-act="ack">Got it ▸</button>`;
      if (this.taskDone) {
        const i = this.tasks.indexOf(this.task);
        const next = this.tasks[i + 1];
        sub += `${sub ? '<br>' : ''}<button class="next-btn" data-act="${next ? 'next' : 'free'}">${next ? `Next: ${next.title} ▸` : 'Free practice ▸'}</button>`;
      }
    }
    const key = [mode, count, text, sub, pct, cls].join('|');
    if (!force && key === this.guideCache.key) { this.applyHighlights(); return; }
    this.guideCache.key = key;
    g.className = `guide ${cls}`;
    $('#guideMode').textContent = mode;
    $('#guideCount').textContent = count;
    $('#guideText').innerHTML = text;
    $('#guideSub').innerHTML = sub;
    $('#guideBar').style.width = `${pct}%`;
    g.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = () => {
        const act = b.dataset.act;
        if (act === 'ack') this.advance();
        else if (act === 'next') this.startTask(this.tasks[this.tasks.indexOf(this.task) + 1].id);
        else this.startTask('free');
      };
    });
    this.applyHighlights();
  }

  applyHighlights() {
    const hl = (this.step && !this.taskDone && this.step.hl) || {};
    const keys = new Set(hl.keys || []);
    for (const [k, g] of Object.entries(this.keyEls)) g.classList.toggle('hl', keys.has(k));
    this.gas.hl = new Set(hl.bench || []);
    this.tubes.hlPorts = new Set(hl.ports || []);
  }

  // ---------------------------------------------------------------- main loop
  frame(ts) {
    const rdt = Math.min(0.05, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;
    const dt = rdt * this.speed;

    this.tubes.layout();
    this.gas.update(dt);
    this.meter.tick(rdt, dt);
    this.tubes.step(rdt);
    this.tubes.draw();
    this.renderMeter(rdt);
    this.gas.render();
    this.updateGuide(rdt, dt);
    requestAnimationFrame(t => this.frame(t));
  }

  renderMeter(rdt) {
    this.lcdT += rdt;
    if (this.lcdT >= 1 / 15) {
      this.lcdT = 0;
      const { svg, bg } = this.meter.renderLCD();
      if (svg !== this.lastLcd) {
        this.lastLcd = svg;
        this.lcd.innerHTML = svg;
      }
      if (this.lcdBg.getAttribute('fill') !== bg) this.lcdBg.setAttribute('fill', bg);
      this.lcd.style.setProperty('--lcd-bg', bg);
      this.lcd.style.setProperty('--seg-on', this.meter instanceof GX9000 ? '#1b211e' : '#141918');
      this.lcd.style.setProperty('--seg-ghost', this.meter.on ? 'rgba(0,0,0,0.055)' : 'rgba(0,0,0,0.03)');
    }
    const lampOn = this.meter.on && (this.meter.lamp || (this.meter.mode === 'start' && this.meter.st.i === 0) || (this.meter.mode === 'off' && false));
    for (const l of this.lamps) l.setAttribute('fill', lampOn ? '#ff3b2f' : '#7a1c14');
    this.lampGlow.setAttribute('opacity', lampOn ? '0.85' : '0');
  }
}

// Module scripts run after the document is parsed, so the DOM is ready here.
try {
  window.app = new App();
} catch (err) {
  console.error(err);
  const g = document.querySelector('#guideText');
  if (g) g.textContent = `Start-up error: ${err.message}`;
}
