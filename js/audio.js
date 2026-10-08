// Piezo-buzzer imitation with the Web Audio API.
// Alarm patterns follow the operating manuals: first alarm = strong/weak beeps at ~1 s,
// second alarm / OVER = beeps at ~0.5 s, fault = "blip, beep" at ~1 s.

export class Buzzer {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.pattern = null;
    this.phase = 0;
    this.step = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch { this.ctx = null; }
  }

  tone(dur = 0.12, vol = 0.18, freq = 2900) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.setValueAtTime(vol, t + dur - 0.01);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  beep() { this.tone(0.11, 0.14); if (this.onBeep) this.onBeep(45); }
  blip() { this.tone(0.05, 0.12, 3200); if (this.onBeep) this.onBeep(20); }
  beep2() { this.beep(); setTimeout(() => this.beep(), 180); }
  click() { this.tone(0.012, 0.05, 1800); }

  setPattern(p) {
    if (p === this.pattern) return;
    this.pattern = p;
    this.phase = 0;
    this.step = 0;
  }

  // Returns true while the alarm lamp should be lit (lamp blinks with the buzzer).
  update(dt) {
    const p = this.pattern;
    if (!p) return false;
    const period = p === 'alarm2' || p === 'over' ? 0.5 : 1.0;
    this.phase += dt;
    if (this.phase >= period) {
      this.phase -= period;
      this.step++;
    }
    if (this.phase < dt + 1e-6) {
      const strong = this.step % 2 === 0;
      if (p === 'fault') strong ? this.blip() : this.tone(0.22, 0.14, 2700);
      else if (p === 'alarm1' || p === 'twa' || p === 'stel') this.tone(0.3, strong ? 0.2 : 0.1);
      else this.tone(0.18, strong ? 0.2 : 0.1, 3100);
    }
    return this.phase < period * 0.5;
  }
}
