// Headless walk-through of the manual procedures for each simulated meter.
// Run: node tests/meters.test.js
import { GX8000 } from '../js/gx8000.js';
import { RX8000 } from '../js/rx8000.js';
import { GX9000 } from '../js/gx9000.js';
import { AIR } from '../js/meter-base.js';
import { CYLINDERS } from '../js/gasworld.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ', msg);
  else { failures++; console.log('  FAIL', msg); }
}

function makeApp() {
  const app = {
    inlet: AIR,
    blocked: false,
    buzzer: { beep() {}, beep2() {}, blip() {}, click() {}, tone() {}, setPattern(p) { this.p = p; }, update() { return false; } },
    toast() {},
  };
  app.gas = { meterDraw: (dt, pumping) => (pumping ? { comp: app.blocked ? null : app.inlet, blocked: app.blocked } : { comp: null, blocked: false }) };
  return app;
}

function sim(m, secs, step = 0.05) {
  for (let t = 0; t < secs; t += step) {
    m.tick(step, step);
    m.renderLCD();
  }
}
function tap(m, k) { m.keyDown(k); sim(m, 0.1); m.keyUp(k); sim(m, 0.1); }
function hold(m, k, secs) { m.keyDown(k); sim(m, secs); m.keyUp(k); sim(m, 0.1); }
function combo(m, first, second, secs = 0.3) { m.keyDown(first); sim(m, 0.1); m.keyDown(second); sim(m, secs); m.keyUp(second); m.keyUp(first); sim(m, 0.1); }
function tapN(m, k, n) { for (let i = 0; i < n; i++) tap(m, k); }

// ------------------------------------------------------------------ GX-8000
{
  console.log('GX-8000');
  const app = makeApp();
  const m = new GX8000(app);
  hold(m, 'enter', 3);
  check(m.mode === 'start', 'power on starts the self-check');
  sim(m, 20);
  check(m.mode === 'detect', 'reaches detection mode');
  check(Math.abs(m.S('O2').reading() - 20.5) < 0.15, `O2 drifted reading ${m.S('O2').reading()}`);

  m.keyDown('up'); sim(m, 1.2);
  check(m.mode === 'air' && m.st.phase !== 'release', 'holding AIR shows HOLD AIR');
  sim(m, 2.5);
  check(m.st.phase === 'release', 'RELEASE appears');
  m.keyUp('up'); sim(m, 3);
  check(m.mode === 'detect', 'back to detection after air cal');
  check(m.S('O2').reading() === 20.9 && m.S('CO').reading() === 0, `zeroed: O2 ${m.S('O2').reading()} CO ${m.S('CO').reading()}`);

  // display mode / alarm test
  tap(m, 'mode');
  check(m.mode === 'disp' && m.st.item === 0, 'DISPLAY opens PEAK');
  tapN(m, 'mode', 3);
  check(m.st.item === 3, 'ALARM-P item');
  tap(m, 'enter'); tap(m, 'up'); tap(m, 'enter');
  check(m.alarmTest && m.alarmTest.level === 1, 'WARNING alarm test runs');
  tap(m, 'mode');
  check(!m.alarmTest, 'any key stops alarm test');
  tap(m, 'mode');
  check(m.st.sub === null, 'DISPLAY leaves ALARM-P');
  tapN(m, 'mode', 4);
  check(m.mode === 'detect', 'DISPLAY cycles back to detection');

  // bump test
  combo(m, 'down', 'mode');
  check(m.mode === 'menu' && m.st.kind === 'cal', '▼ + DISPLAY opens calibration mode');
  tapN(m, 'up', 3);
  check(m.items()[m.st.i] === 'BUMP', '▲ x3 = BUMP');
  tap(m, 'enter');
  check(m.mode === 'bump' && m.st.phase === 'conc', 'bump shows test gas values');
  app.inlet = CYLINDERS.MIX4.comp;
  tap(m, 'enter');
  check(m.st.phase === 'apply', 'bump started');
  sim(m, 31);
  check(m.st.phase === 'result', `bump result shown (${JSON.stringify(m.st.pass)})`);
  check(Object.values(m.st.pass).every(Boolean), 'all channels pass with drifted-but-ok sensors');
  tap(m, 'up'); tap(m, 'enter');
  check(m.mode === 'menu', 'ENTER returns to menu');
  app.inlet = AIR; sim(m, 60);

  // AUTO CAL
  tap(m, 'down'); tap(m, 'down');
  check(m.items()[m.st.i] === 'AUTO CAL', '▼ moves back to AUTO CAL');
  tap(m, 'enter');
  check(m.mode === 'autocal' && m.st.phase === 'conc', 'AUTO CAL conc screen');
  tap(m, 'mode');
  check(m.st.phase === 'supply', 'DISPLAY = supply gas');
  app.inlet = CYLINDERS.MIX4.comp; sim(m, 70);
  tap(m, 'enter'); sim(m, 1.5);
  check(m.st.phase === 'pass', 'AUTO CAL PASS');
  check(m.S('CO').reading() === 50 && m.S('O2').reading() === 12 && m.S('LEL').reading() === 50 && m.S('H2S').reading() === 25, `span exact: ${m.sensors.map(s => s.reading()).join(',')}`);
  sim(m, 2);
  check(m.mode === 'menu' && m.items()[m.st.i] === 'AIR CAL', 'returns to AIR CAL');

  // ONE CAL CO with adjustment
  tapN(m, 'up', 2); tap(m, 'enter');
  tapN(m, 'up', 3);
  check(m.mode === 'onecal' && m.st.sel === 3, 'ONE CAL CO selected');
  tap(m, 'enter');
  tapN(m, 'up', 5);
  check(m.oneCalDisplay() === 55, `display adjusted to 55 (${m.oneCalDisplay()})`);
  tap(m, 'enter'); sim(m, 1);
  check(m.S('CO').reading() === 55, 'CO now reads 55');
  tap(m, 'up'); tap(m, 'enter');
  check(m.mode === 'menu', 'ESCAPE back to menu');

  // AIR CAL with gas present -> FAIL
  tapN(m, 'down', 2);
  check(m.items()[m.st.i] === 'AIR CAL', 'AIR CAL item');
  tap(m, 'enter');
  hold(m, 'up', 3.5); sim(m, 2);
  check(m.fault && m.fault.text === 'AIR CAL', 'air cal in gas fails');
  tap(m, 'down');
  check(!m.fault && m.mode === 'menu', 'RESET clears fault');
  app.inlet = AIR; sim(m, 60);

  // NORMAL -> detection, gas alarm with latch
  tapN(m, 'down', 1); tap(m, 'enter');
  check(m.mode === 'detect', 'NORMAL -> detection');
  app.inlet = CYLINDERS.MIX4.comp; sim(m, 40);
  check(m.topAlarm() >= 2, `gas alarm latched (${JSON.stringify(m.latched)})`);
  app.inlet = AIR; sim(m, 80);
  check(m.topAlarm() >= 2, 'alarm stays latched after gas removed');
  tap(m, 'down');
  check(m.topAlarm() === 0, 'RESET clears latched alarm');

  // low flow
  app.blocked = true; sim(m, 3);
  check(m.fault && m.fault.kind === 'flow', 'blocked inlet -> LOW FLOW');
  tap(m, 'down');
  check(m.fault, 'cannot reset while still blocked');
  app.blocked = false; sim(m, 0.5); tap(m, 'down');
  check(!m.fault, 'reset after flow restored');

  // power off and maintenance mode
  hold(m, 'enter', 3.3); sim(m, 2);
  check(m.mode === 'off', 'hold POWER turns off');
  m.keyDown('up'); m.keyDown('down'); sim(m, 0.1); m.keyDown('enter'); sim(m, 1.0);
  check(m.mode === 'pw', 'maintenance password screen');
  m.keyUp('enter'); m.keyUp('up'); m.keyUp('down'); sim(m, 0.2);
  tap(m, 'enter'); tap(m, 'enter'); tap(m, 'enter');
  tapN(m, 'up', 8); tap(m, 'enter');
  check(m.mode === 'menu' && m.st.kind === 'maint', 'password 0008 accepted');
  tapN(m, 'up', 5);
  check(m.items()[m.st.i] === 'ALARM-P', 'ALARM-P item');
  tap(m, 'enter'); tapN(m, 'up', 3); tap(m, 'enter');
  check(m.st.phase === 'edit' && m.st.val === 25, 'editing CO WARNING (25)');
  tapN(m, 'up', 5); tapN(m, 'enter', 4); sim(m, 1);
  check(m.S('CO').alarm.w === 30, 'CO WARNING set to 30');
  tap(m, 'up'); tap(m, 'enter');
  tapN(m, 'up', 3); tap(m, 'enter');
  check(m.mode === 'start', 'START restarts');
  sim(m, 20);
  check(m.mode === 'detect', 'back in detection');
}

// ------------------------------------------------------------------ RX-8000
{
  console.log('RX-8000');
  const app = makeApp();
  const m = new RX8000(app);
  hold(m, 'enter', 3);
  sim(m, 10);
  check(m.mode === 'filter', 'filter check screen waits');
  tap(m, 'enter');
  check(m.mode === 'warmup', 'warm-up');
  sim(m, 31);
  check(m.mode === 'detect', 'detection');
  hold(m, 'up', 3); sim(m, 2);
  check(m.mode === 'detect' && m.S('O2').reading() === 20.9 && m.S('HC').reading() === 0, 'air cal');
  m.keyDown('up'); m.keyDown('down'); sim(m, 1.3); m.keyUp('up'); m.keyUp('down'); sim(m, 0.1);
  check(m.mode === 'onecal', '▲+▼ opens ONE CAL');
  tap(m, 'enter');
  app.inlet = CYLINDERS.HC50.comp; sim(m, 70);
  const d0 = m.oneCalDisplay();
  const steps = Math.round((50 - d0) / 0.5);
  tapN(m, steps > 0 ? 'up' : 'down', Math.abs(steps));
  check(m.oneCalDisplay() === 50, `adjusted to 50 (from ${d0})`);
  tap(m, 'enter'); sim(m, 1);
  check(m.S('HC').reading() === 50, 'HC reads 50 after span');
  tapN(m, 'up', 3); tap(m, 'enter');
  check(m.mode === 'detect', 'ESCAPE to detection');
  app.inlet = CYLINDERS.HCV.comp; sim(m, 80);
  check(m.range === 'VOL', `auto range to vol% (${m.hcDisplay().txt} ${m.hcDisplay().unit})`);
  app.inlet = AIR; sim(m, 120);
  check(m.range === 'LEL', 'back to %LEL');
  tap(m, 'mode');
  check(m.mode === 'disp', 'PEAK opens display mode');
  tapN(m, 'mode', 4);
  check(m.mode === 'detect', 'cycles back');
  hold(m, 'down', 3.3);
  check(m.mode === 'pumpoff', 'pump off');
  tap(m, 'down');
  check(m.mode === 'detect' && m.pumpOn, 'pump back on');
}

// ------------------------------------------------------------------ GX-9000
{
  console.log('GX-9000');
  const app = makeApp();
  const m = new GX9000(app);
  hold(m, 'enter', 3);
  sim(m, 20);
  check(m.mode === 'meas', 'measurement mode');
  m.keyDown('up'); sim(m, 3.2);
  check(m.mode === 'air' && m.st.phase === 'release', 'air: RELEASE');
  m.keyUp('up'); sim(m, 4);
  check(m.mode === 'meas' && m.S('O2').reading() === 20.9, 'air cal done');
  tapN(m, 'mode', 9);
  check(m.mode === 'disp' && m.st.item === 8, 'ALARM POINTS item');
  tap(m, 'enter'); tap(m, 'up'); tap(m, 'enter');
  check(m.alarmTest && m.alarmTest.level === 1, 'alarm test WARNING');
  tap(m, 'up');
  check(m.alarmTest, 'only RESET stops the GX-9000 test');
  tap(m, 'down');
  check(!m.alarmTest, 'RESET stops test');
  tapN(m, 'mode', 3);
  check(m.mode === 'meas', 'back to measurement');
  hold(m, 'enter', 3.3); sim(m, 2);
  check(m.mode === 'off', 'off');
  m.keyDown('enter'); m.keyDown('up'); sim(m, 1); m.keyUp('enter'); m.keyUp('up'); sim(m, 0.1);
  check(m.mode === 'user', 'user mode');
  tap(m, 'enter');
  check(m.mode === 'bumpmenu', 'BUMP TEST menu');
  app.inlet = CYLINDERS.MIX4.comp;
  tap(m, 'enter'); sim(m, 32);
  check(m.mode === 'bumprun' && m.st.phase === 'result', `bump result ${JSON.stringify(m.st.pass)}`);
  tap(m, 'enter'); sim(m, 1.5);
  check(m.mode === 'bumpmenu', 'END -> cylinder screen');
  tap(m, 'mode');
  tap(m, 'down'); tap(m, 'enter');
  check(m.mode === 'user', 'ESCAPE to user menu');
  tap(m, 'down'); tap(m, 'enter');
  check(m.mode === 'gascal', 'GAS CAL');
  tap(m, 'down'); tap(m, 'enter');
  check(m.mode === 'spanmenu', 'SPAN CAL');
  tap(m, 'enter'); sim(m, 65); tap(m, 'enter'); sim(m, 2);
  check(m.st.phase === 'pass' || m.st.phase === 'after', 'span PASS');
  sim(m, 3);
  check(m.S('CO').reading() === 50 && m.S('H2S').reading() === 25, 'span exact');
  app.inlet = AIR;
  tap(m, 'mode'); tap(m, 'mode');
  tap(m, 'down'); tap(m, 'enter');
  check(m.mode === 'alarmmenu', 'ALARM SETTING');
  tap(m, 'enter'); tapN(m, 'down', 2); tap(m, 'enter');
  check(m.mode === 'alarmpts' && m.st.phase === 'edit' && m.st.sel === 2, 'editing CO');
  tapN(m, 'up', 5); tapN(m, 'enter', 4); sim(m, 1.5);
  check(m.S('CO').alarm.w === 30, 'CO WARNING 30');
  tap(m, 'mode'); tap(m, 'mode');
  check(m.mode === 'user', 'back to USER MODE');
  tapN(m, 'down', 5); tap(m, 'enter');
  check(m.mode === 'start', 'START MEASURE');
  sim(m, 20);
  check(m.mode === 'meas', 'measurement');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
