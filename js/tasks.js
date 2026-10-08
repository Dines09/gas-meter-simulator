// Learning-mode lessons. Each step: { t, sub, hl: {keys, bench, ports}, done(app), ack, minSim, final }
import { CYLINDERS } from './gasworld.js';

const k = s => `<span class="k">${s}</span>`;
const isBag = p => p === 'bagIn' || p === 'bagOut';
const M = a => a.meter;
const st = a => a.meter.st;

// ---------------------------------------------------------------- shared gas-handling steps
function gasSteps(cyl) {
  const c = CYLINDERS[cyl];
  return [
    { t: `Gas set-up: select the <b>${c.chip}</b> cylinder on the bench.`, sub: 'Always read the cylinder label: gas, concentration and expiry date.',
      hl: { bench: ['cyl:' + cyl] }, done: a => a.gas.cylId === cyl },
    { t: 'Drag a tube from the <b>regulator outlet</b> to the bag <b>IN</b> port.', sub: 'Touch the small ring at the regulator outlet and drag it to the bag.',
      hl: { ports: ['reg', 'bagIn'] }, done: a => isBag(a.tubes.peer('reg')) },
    { t: 'Tap the bag <b>valve</b> to open it.', hl: { bench: ['valve'] }, done: a => a.gas.bag.valve },
    { t: 'Tap the <b>regulator knob</b> to open the cylinder.', sub: 'Gas now flows into the sampling bag.', hl: { bench: ['knob'] }, done: a => a.gas.reg.open || a.gas.bag.vol > 1.5 },
    { t: 'Let the bag fill until it is nearly full (about 1.8 L)…', sub: a => `Bag: ${a.gas.bag.vol.toFixed(2)} L`, done: a => a.gas.bag.vol >= 1.75 || (!a.gas.reg.open && a.gas.bag.vol > 1.0) },
    { t: 'Bag is full: tap the <b>regulator knob</b> to close it.', sub: 'Never over-fill the bag.', hl: { bench: ['knob'] }, done: a => !a.gas.reg.open },
  ];
}

const connectMeter = (txt) => ({
  t: txt || `Drag a tube from the bag <b>OUT</b> port to the meter's <b>GAS IN</b>.`,
  sub: 'The meter pump now draws gas from the bag. Leave GAS OUT open.',
  hl: { ports: ['bagOut', 'meterIn'] }, done: a => isBag(a.tubes.peer('meterIn')),
});

const disconnectMeter = () => ({
  t: `Gas finished: pull the tube off the meter's <b>GAS IN</b> (drag it away).`,
  sub: 'The meter then draws fresh air again. Close the bag valve when you are done.',
  hl: { ports: ['meterIn'] }, done: a => { const p = a.tubes.peer('meterIn'); return !p || p === 'free'; },
});

const waitStable = (secs, what) => ({
  t: `Keep the gas flowing and wait about ${secs} s until the ${what || 'readings'} are stable.`,
  sub: a => `Waiting… ${Math.max(0, Math.ceil(secs - a.stepSim))} s`,
  minSim: secs, done: () => true,
});

const final = (t, sub) => ({ t, sub, final: true, done: () => false });

// ---------------------------------------------------------------- GX-8000
const GX8000 = [
  {
    id: 'start', title: 'Power ON & self-check', setup: { power: 'off' },
    steps: [
      { t: `Press and <b>hold</b> ${k('POWER/ENTER')} for about 3 seconds to switch on.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'off' },
      { t: 'Self-test: all LCD segments light up, the alarm lamps flash and the buzzer beeps once.', sub: 'Check that no segment is missing.', done: a => M(a).mode !== 'start' || st(a).i >= 1 },
      { t: 'Date / time, then the battery voltage (bAtt.) are shown.', sub: 'Make sure the battery is charged.', done: a => M(a).mode !== 'start' || st(a).i >= 3 },
      { t: 'Gas names: CH4 · O2 · CO · H2S, then the full scale (F.S.).', done: a => M(a).mode !== 'start' || st(a).i >= 5 },
      { t: 'Alarm setpoints: <b>WARNING</b> (1st) → <b>ALARM</b> (2nd) → STEL → TWA.', sub: 'CH4 10/50 %LEL · O2 19.5/23.5 % · CO 25/50 ppm · H2S 5/30 ppm', done: a => M(a).mode !== 'start' || st(a).i >= 9 },
      { t: 'Station ID, then detection mode starts (beep-beep)…', done: a => M(a).mode === 'detect' },
      final('Detection mode ✔ — in fresh air O2 should be 20.9 % and the other gases 0.', 'Readings not right? Do a fresh air calibration (AIR CAL) — next lesson.'),
    ],
  },
  {
    id: 'air', title: 'Fresh air calibration (AIR CAL)', setup: { power: 'on' },
    steps: [
      { t: 'Make sure the meter is in <b>clean air</b>: nothing connected to GAS IN.', ack: true },
      { t: 'Look at the display: O2 is about 20.5 % and CH4/CO are not 0 — the sensors have drifted.', ack: true },
      { t: `Press and <b>hold</b> ${k('▲/AIR')}…`, sub: 'The display shows “Air CAL — HOLD AIR”.', hl: { keys: ['up'] }, done: a => M(a).mode === 'air' },
      { t: `Keep holding ${k('▲/AIR')} until <b>RELEASE</b> appears on the bottom line.`, hl: { keys: ['up'] }, done: a => M(a).mode !== 'air' || ['release', 'adj', 'end'].includes(st(a).phase) },
      { t: `Now <b>let go</b> of ${k('▲/AIR')}.`, done: a => M(a).mode !== 'air' || ['adj', 'end'].includes(st(a).phase) },
      { t: 'Adjusting… END is shown and the meter returns to detection mode.', done: a => M(a).mode === 'detect' && Math.abs(M(a).S('O2').value() - 20.9) < 0.15 },
      final('Done ✔ — O2 = 20.9 %, CH4 / CO / H2S = 0.', 'Do AIR CAL in clean air after every start-up and before a span calibration.'),
    ],
  },
  {
    id: 'alarmtest', title: 'Alarm test (lamps & buzzer)', setup: { power: 'on', cal: 'aircal' },
    steps: [
      { t: `Press ${k('DISPLAY')} to enter Display mode.`, sub: 'The first item is PEAK.', hl: { keys: ['mode'] }, done: a => M(a).mode === 'disp' },
      { t: `Press ${k('DISPLAY')} again until the bottom line shows <b>ALARM-P</b>.`, sub: 'PEAK → STEL → TWA → ALARM-P', hl: { keys: ['mode'] }, done: a => M(a).mode === 'disp' && st(a).item === 3 },
      { t: `Press ${k('POWER/ENTER')} to open it.`, sub: 'The screen cycles “d iSPLAY / YES/ENT. / NO /DISP”.', hl: { keys: ['enter'] }, done: a => st(a).sub === 'alarmp' },
      { t: `This is the full scale (F.S.). Press ${k('▲/AIR')} to show the <b>WARNING</b> setpoints.`, hl: { keys: ['up'] }, done: a => st(a).sub === 'alarmp' && st(a).view === 1 },
      { t: `Press ${k('POWER/ENTER')} to run the 1st alarm (WARNING) test.`, hl: { keys: ['enter'] }, done: a => M(a).alarmTest && M(a).alarmTest.level === 1 },
      { t: 'Lamps blink and the buzzer beeps about every second. Press <b>any key</b> to stop.', done: a => !M(a).alarmTest },
      { t: `Press ${k('▲/AIR')} to show the <b>ALARM</b> (2nd alarm) setpoints.`, hl: { keys: ['up'] }, done: a => st(a).sub === 'alarmp' && st(a).view === 2 },
      { t: `Press ${k('POWER/ENTER')} to test the 2nd alarm — note the faster pattern.`, hl: { keys: ['enter'] }, done: a => M(a).alarmTest && M(a).alarmTest.level === 2 },
      { t: 'Press <b>any key</b> to stop the alarm.', done: a => !M(a).alarmTest },
      { t: `Press ${k('DISPLAY')} to leave, then ${k('DISPLAY')} repeatedly until detection mode.`, hl: { keys: ['mode'] }, done: a => M(a).mode === 'detect' },
      final('Alarm test done ✔ — do it once a month and record it.'),
    ],
  },
  {
    id: 'bump', title: 'Bump test (BUMP)', setup: { power: 'on', cal: 'aircal', cyl: 'N2' },
    steps: [
      { t: `Hold ${k('▼/RESET')} and, while holding it, press ${k('DISPLAY')}. Release when it beeps.`, sub: 'This opens the Calibration mode menu (AIR CAL).', hl: { keys: ['down', 'mode'] }, done: a => M(a).mode === 'menu' },
      { t: `Press ${k('▲/AIR')} until the bottom line shows <b>BUMP</b>.`, sub: 'AIR CAL → AUTO CAL → ONE CAL → BUMP', hl: { keys: ['up'] }, done: a => M(a).mode === 'menu' && M(a).items()[st(a).i] === 'BUMP' },
      { t: `Press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'bump' },
      { t: 'The test-gas values are shown: CH4 50 · O2 12.0 · CO 50 · H2S 25.0 (test time 30 s).', sub: 'These must match the cylinder label.', ack: true },
      ...gasSteps('MIX4'),
      connectMeter(),
      { t: `Press ${k('POWER/ENTER')} to start the bump test.`, sub: 'The bottom line alternates BUMP ⇄ APPLY with a countdown.', hl: { keys: ['enter'] }, done: a => M(a).mode === 'bump' && st(a).phase !== 'conc' },
      { t: 'Keep the gas flowing… the readings rise towards the test values.', sub: a => st(a).t != null ? `About ${Math.max(0, Math.ceil(st(a).t))} s left` : '', done: a => M(a).mode !== 'bump' || st(a).phase === 'result' },
      { t: `Result: <b>P</b> = pass, <b>F</b> = fail. Press ${k('▲/AIR')} to see the measured values.`, sub: 'If a sensor failed, the meter auto-calibrates it (BUMP/CAL).', hl: { keys: ['up'] }, done: a => M(a).mode !== 'bump' || st(a).view >= 1 },
      { t: `Press ${k('POWER/ENTER')} to finish.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'menu' },
      disconnectMeter(),
      { t: `Press ${k('▲/AIR')} until <b>NORMAL</b>, then ${k('POWER/ENTER')} to return to detection mode.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'detect' },
      final('Bump test complete ✔ — record the result in the gas detector log.'),
    ],
  },
  {
    id: 'autocal', title: 'Span calibration – all gases (AUTO CAL)', setup: { power: 'on', cyl: 'N2' },
    steps: [
      { t: `Hold ${k('▼/RESET')} and press ${k('DISPLAY')} → Calibration mode.`, hl: { keys: ['down', 'mode'] }, done: a => M(a).mode === 'menu' },
      { t: `First a fresh air calibration: with <b>AIR CAL</b> shown, press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'air' },
      { t: `Hold ${k('▲/AIR')} until <b>RELEASE</b> appears, then let go.`, hl: { keys: ['up'] }, done: a => M(a).mode === 'menu' && Math.abs(M(a).S('O2').value() - 20.9) < 0.15 },
      { t: `Press ${k('▲/AIR')} to show <b>AUTO CAL</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'autocal' },
      { t: 'Span-gas values: CH4 50 · O2 12.0 · CO 50 · H2S 25.0. They must match the cylinder label.', sub: `If not, hold ▼ and press DISPLAY to edit them.`, ack: true },
      { t: `Press ${k('DISPLAY')}: AUTO CAL blinks and live readings are shown.`, hl: { keys: ['mode'] }, done: a => M(a).mode === 'autocal' && st(a).phase === 'supply' },
      ...gasSteps('MIX4'),
      connectMeter(),
      waitStable(60),
      { t: `Readings are stable. Press ${k('POWER/ENTER')} to calibrate.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'autocal' || ['adj', 'pass'].includes(st(a).phase) },
      { t: '<b>PASS</b> — all four sensors adjusted.', done: a => M(a).mode === 'menu' },
      disconnectMeter(),
      { t: `Press ${k('▲/AIR')} until <b>NORMAL</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'detect' },
      final('Span calibration done ✔ — do it at least every 6 months, or when a bump test fails.'),
    ],
  },
  {
    id: 'onecal', title: 'Single gas calibration (ONE CAL – CO)', setup: { power: 'on', cal: 'aircal', cyl: 'N2' },
    steps: [
      { t: `Hold ${k('▼/RESET')} and press ${k('DISPLAY')} → Calibration mode.`, hl: { keys: ['down', 'mode'] }, done: a => M(a).mode === 'menu' },
      { t: `Press ${k('▲/AIR')} until <b>ONE CAL</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'onecal' },
      { t: `Press ${k('▲/AIR')} to choose the gas until the CO position shows <b>---</b>.`, sub: 'Order: CH4 → O2 → H2S → CO → ESCAPE', hl: { keys: ['up'] }, done: a => M(a).mode === 'onecal' && st(a).sel === 3 },
      { t: `Press ${k('POWER/ENTER')}: the CO reading blinks, waiting for gas.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' },
      ...gasSteps('MIX4'),
      connectMeter(),
      waitStable(60, 'CO reading'),
      { t: `Use ${k('▲/AIR')} / ${k('▼/RESET')} to set the CO reading to the cylinder value: <b>50 ppm</b>.`, sub: a => `Now showing ${M(a).mode === 'onecal' && st(a).phase === 'adjust' ? M(a).oneCalDisplay() : '-'} ppm`, hl: { keys: ['up', 'down'] }, done: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' && M(a).oneCalDisplay() === 50 },
      { t: `Press ${k('POWER/ENTER')} to adjust → END.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'onecal' || st(a).phase !== 'adjust' },
      disconnectMeter(),
      { t: `Press ${k('▲/AIR')} until <b>ESCAPE</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'menu' },
      { t: `Press ${k('▲/AIR')} until <b>NORMAL</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'detect' },
      final('CO span adjusted ✔ — repeat the same way for any other gas.'),
    ],
  },
  {
    id: 'gasalarm', title: 'Gas alarm check (with test gas)', setup: { power: 'on', cal: 'perfect', cyl: 'N2' },
    steps: [
      { t: 'Alarm setpoints: CH4 10/50 %LEL · O2 19.5 low / 23.5 high · CO 25/50 ppm · H2S 5/30 ppm.', sub: 'You will expose the meter to test gas in normal detection mode.', ack: true },
      ...gasSteps('MIX4'),
      connectMeter(),
      { t: 'Watch the readings rise: first <b>WARNING</b>, then <b>ALARM</b>. Lamps flash, buzzer sounds, alarming values blink.', done: a => M(a).topAlarm() >= 2 },
      { t: 'CH4 50 and CO 50 reach ALARM; H2S 25 and O2 12 % (low) reach WARNING.', sub: 'Gas alarms are self-latching.', ack: true },
      disconnectMeter(),
      { t: 'Wait in fresh air until the readings return to normal (O2 20.9, others 0).', done: a => M(a).sensors.every(s => s.alarmLevel(s.reading()) === 0) },
      { t: `The alarm is still latched. Press ${k('▼/RESET')} to reset it.`, hl: { keys: ['down'] }, done: a => M(a).topAlarm() === 0 },
      final('Gas alarm check done ✔'),
    ],
  },
  {
    id: 'alarmset', title: 'Change alarm setpoints (Maintenance mode)', setup: { power: 'off' },
    steps: [
      { t: `Meter OFF: hold ${k('▲/AIR')} + ${k('▼/RESET')} together, then also press ${k('POWER/ENTER')}. Release when it beeps.`, sub: 'Use two fingers (or keyboard Q + A + Enter).', hl: { keys: ['up', 'down', 'enter'] }, done: a => M(a).mode === 'pw' },
      { t: `Enter the password <b>0 0 0 8</b>: ${k('▲/AIR')}/${k('▼/RESET')} change the blinking digit, ${k('POWER/ENTER')} moves to the next.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'menu' },
      { t: `Maintenance menu (DATE). Press ${k('▲/AIR')} until <b>ALARM-P</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'alarmset' },
      { t: `Press ${k('▲/AIR')} until the CO position shows <b>---</b>, then ${k('POWER/ENTER')}.`, sub: 'Order: CH4 → O2 → H2S → CO → ESCAPE', hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'alarmset' && st(a).phase === 'edit' && st(a).sel === 3 },
      { t: `WARNING blinks (25 ppm). Use ${k('▲/AIR')} to set <b>30</b> ppm, then ${k('POWER/ENTER')}.`, sub: 'Only change setpoints as required by your company SMS.', hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'alarmset' && (st(a).phase !== 'edit' || st(a).fi >= 1) },
      { t: `ALARM, STEL and TWA follow — press ${k('POWER/ENTER')} for each to keep them.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'alarmset' && st(a).phase !== 'edit' },
      { t: `END. Press ${k('▲/AIR')} until <b>ESCAPE</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'menu' },
      { t: `Press ${k('▲/AIR')} until <b>START</b>, then ${k('POWER/ENTER')} — the meter starts up.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'start' || M(a).mode === 'detect' },
      { t: 'During start-up check the WARNING screen: CO now shows 30.', done: a => M(a).mode === 'detect' },
      final(a => `New CO WARNING setpoint: ${M(a).S('CO').alarm.w} ppm ✔`),
    ],
  },
  {
    id: 'off', title: 'Power OFF', setup: { power: 'on', cal: 'aircal' },
    steps: [
      { t: 'Before switching off, let the meter draw fresh air until all readings are back to normal.', ack: true },
      { t: `Hold ${k('POWER/ENTER')} for about 3 seconds until the display goes off.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'off' },
      final('Meter off ✔ — recharge the battery after use.'),
    ],
  },
];

// ---------------------------------------------------------------- RX-8000
const RX8000 = [
  {
    id: 'start', title: 'Power ON, filter check & warm-up', setup: { power: 'off' },
    steps: [
      { t: `Press and <b>hold</b> ${k('POWER/ENTER')} for about 3 seconds.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'off' },
      { t: 'Self-test, date/time, battery, gas names (HC · O2), full scale and ID are shown…', done: a => M(a).mode === 'filter' },
      { t: `<b>FILTER CHECK</b>: confirm the filter tube and dust filter are fitted, then press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'warmup' },
      { t: 'Warm-up: about 30 s countdown…', done: a => M(a).mode === 'detect' },
      final('Detection mode ✔ — HC in %LEL (switches to vol% above 100 %LEL) and O2 in %.', '“NO ALARM” means the optional gas alarms are not set on this unit.'),
    ],
  },
  {
    id: 'air', title: 'Fresh air calibration (AIR CAL)', setup: { power: 'on' },
    steps: [
      { t: 'In clean air the meter shows HC above 0 and O2 about 20.6 % — it needs an air calibration.', ack: true },
      { t: `Press and <b>hold</b> ${k('▲/AIR')}: the display shows <b>AdJ – HOLD AIR</b>.`, hl: { keys: ['up'] }, done: a => M(a).mode === 'air' },
      { t: `Keep holding until <b>RELEASE</b> appears, then let go.`, hl: { keys: ['up'] }, done: a => M(a).mode === 'detect' && Math.abs(M(a).S('O2').value() - 20.9) < 0.15 },
      final('Air calibration done ✔ — HC 0.0 %LEL, O2 20.9 %.'),
    ],
  },
  {
    id: 'spanhc', title: 'Span calibration HC %LEL (ONE CAL)', setup: { power: 'on', cal: 'aircal', cyl: 'N2' },
    steps: [
      { t: `Press ${k('▲/AIR')} and ${k('▼/PUMP')} <b>together</b> and hold about 1 s → span mode (ONE CAL).`, sub: 'Two fingers on a phone, or keyboard Q + A.', hl: { keys: ['up', 'down'] }, done: a => M(a).mode === 'onecal' },
      { t: `<b>HC ---  %LEL</b> is selected. Press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' && st(a).sel === 0 },
      ...gasSteps('HC50'),
      connectMeter(),
      waitStable(60, 'HC reading'),
      { t: `Use ${k('▲/AIR')} / ${k('▼/PUMP')} to set the reading to <b>50.0 %LEL</b> (cylinder value).`, sub: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' ? `Now showing ${M(a).oneCalDisplay().toFixed(1)} %LEL` : '', hl: { keys: ['up', 'down'] }, done: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' && M(a).oneCalDisplay() === 50 },
      { t: `Press ${k('POWER/ENTER')} → END.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'onecal' || st(a).phase !== 'adjust' },
      disconnectMeter(),
      { t: `Press ${k('▲/AIR')} until <b>ESCAPE</b>, then ${k('POWER/ENTER')} → detection mode.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'detect' },
      final('HC %LEL span done ✔'),
    ],
  },
  {
    id: 'spano2', title: 'O2 calibration with nitrogen (ONE CAL)', setup: { power: 'on', cal: 'aircal', cyl: 'HC50' },
    steps: [
      { t: `Hold ${k('▲/AIR')} + ${k('▼/PUMP')} together ~1 s → ONE CAL.`, hl: { keys: ['up', 'down'] }, done: a => M(a).mode === 'onecal' },
      { t: `Press ${k('▲/AIR')} until <b>O2 ---</b> is shown, then ${k('POWER/ENTER')}.`, sub: 'HC %LEL → HC vol% → O2 → ESCAPE', hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' && st(a).sel === 2 },
      ...gasSteps('N2'),
      connectMeter(),
      waitStable(45, 'O2 reading'),
      { t: `Set the O2 reading to <b>0.0 %</b> with ${k('▼/PUMP')} / ${k('▲/AIR')}.`, sub: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' ? `Now showing ${M(a).oneCalDisplay().toFixed(1)} %` : '', hl: { keys: ['down', 'up'] }, done: a => M(a).mode === 'onecal' && st(a).phase === 'adjust' && M(a).oneCalDisplay() === 0 },
      { t: `Press ${k('POWER/ENTER')} → END.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'onecal' || st(a).phase !== 'adjust' },
      disconnectMeter(),
      { t: `${k('▲/AIR')} to <b>ESCAPE</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode === 'detect' },
      final('O2 span done ✔ — the meter now reads 0 % in inert gas and 20.9 % in air.'),
    ],
  },
  {
    id: 'check', title: 'Gas response check (before use)', setup: { power: 'on', cal: 'aircal', cyl: 'N2' },
    steps: [
      { t: 'Before entering tanks, check the meter responds correctly to a known gas.', ack: true },
      ...gasSteps('HC50'),
      connectMeter(),
      waitStable(60, 'HC reading'),
      { t: a => `Reading: <b>${M(a).S('HC').text()} %LEL</b> — the cylinder is 50 %LEL. Within about ±10 %? If not, calibrate.`, ack: true },
      disconnectMeter(),
      { t: 'Wait until HC returns to 0 in fresh air.', done: a => M(a).S('HC').reading() < 2 },
      final('Response check done ✔'),
    ],
  },
  {
    id: 'pump', title: 'PEAK display & pump stop', setup: { power: 'on', cal: 'aircal' },
    steps: [
      { t: `Press ${k('PEAK/ESC')} to show the <b>PEAK</b> values.`, sub: 'Highest HC / lowest O2 since power-on.', hl: { keys: ['mode'] }, done: a => M(a).mode === 'disp' },
      { t: `Press ${k('PEAK/ESC')} again to step through CLOCK, ID, REC.DATA and back to detection.`, hl: { keys: ['mode'] }, done: a => M(a).mode === 'detect' },
      { t: `Hold ${k('▼/PUMP')} for about 3 s → the pump stops (PUMP OFF).`, hl: { keys: ['down'] }, done: a => M(a).mode === 'pumpoff' },
      { t: 'With the pump off no gas is drawn and nothing is detected! The meter beeps every 3 min to remind you.', ack: true },
      { t: `Press ${k('▼/PUMP')} to restart the pump.`, hl: { keys: ['down'] }, done: a => M(a).mode === 'detect' },
      final('Done ✔'),
    ],
  },
  {
    id: 'off', title: 'Power OFF', setup: { power: 'on', cal: 'aircal' },
    steps: [
      { t: `Hold ${k('POWER/ENTER')} for about 3 seconds until the display goes off.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'off' },
      final('Meter off ✔'),
    ],
  },
];

// ---------------------------------------------------------------- GX-9000
const userModeSteps = [
  { t: `Switch the meter <b>OFF</b>: hold ${k('POWER/ENTER')} for about 3 s.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'off' },
  { t: `User mode: hold ${k('POWER/ENTER')} and ${k('▲/AIR')} <b>together</b> until it blips.`, sub: 'Two fingers on a phone, or keyboard Enter + Q.', hl: { keys: ['enter', 'up'] }, done: a => M(a).mode === 'user' },
];

const GX9000 = [
  {
    id: 'start', title: 'Power ON & self-check', setup: { power: 'off' },
    steps: [
      { t: `Press and <b>hold</b> ${k('POWER/ENTER')} (about 3 s) until it blips.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'off' },
      { t: 'LCD fully lit, lamps and buzzer work. Then DATE → BATTERY → ALARM TYPE → NEXT MAINT DATE → GAS NAME.', done: a => M(a).mode !== 'start' || st(a).i >= 6 },
      { t: 'FULL SCALE → WARNING → ALARM → STEL → TWA setpoints, then USER ID and STATION ID.', sub: 'O2 19.5/23.5 % · H2S 1.0/10.0 ppm · CO 25/50 ppm · CH4 10/50 %LEL', done: a => M(a).mode === 'meas' },
      final('Measurement mode ✔ — O2 | H2S | CO on top, CH4 %LEL bottom right.', 'Do a fresh air adjustment next.'),
    ],
  },
  {
    id: 'air', title: 'Fresh air adjustment (AIR CAL)', setup: { power: 'on' },
    steps: [
      { t: 'In clean air O2 shows about 20.6 % and CO/CH4 are not 0 — adjust in fresh air.', ack: true },
      { t: `Hold ${k('▲/AIR')}: “HOLD AIR BUTTON” is shown.`, hl: { keys: ['up'] }, done: a => M(a).mode === 'air' },
      { t: `Keep holding until <b>RELEASE</b> appears, then let go.`, hl: { keys: ['up'] }, done: a => M(a).mode === 'air' && ['adj', 'pass', 'after'].includes(st(a).phase) },
      { t: '<b>PASS</b> — then the adjusted readings are shown.', done: a => M(a).mode === 'meas' },
      final('Fresh air adjustment done ✔'),
    ],
  },
  {
    id: 'alarmtest', title: 'Alarm test (lamps & buzzer)', setup: { power: 'on', cal: 'aircal' },
    steps: [
      { t: `Press ${k('DISP/ESC')} several times until <b>ALARM POINTS</b> is shown.`, sub: 'PEAK → STEL → TWA → USER ID → STATION ID → REC DATA → DATE → GAS NAME → ALARM POINTS', hl: { keys: ['mode'] }, done: a => M(a).mode === 'disp' && st(a).item === 8 },
      { t: `Press ${k('POWER/ENTER')}: FULL SCALE is shown.`, hl: { keys: ['enter'] }, done: a => st(a).sub === 'ap' },
      { t: `Press ${k('▲/AIR')} to show the <b>WARNING</b> setpoints.`, hl: { keys: ['up'] }, done: a => st(a).sub === 'ap' && st(a).view === 1 },
      { t: `Press ${k('POWER/ENTER')} to test the WARNING alarm.`, hl: { keys: ['enter'] }, done: a => M(a).alarmTest && M(a).alarmTest.level === 1 },
      { t: `Lamps and buzzer work? Press ${k('RESET/▼')} to stop.`, hl: { keys: ['down'] }, done: a => !M(a).alarmTest },
      { t: `Press ${k('▲/AIR')} for <b>ALARM</b>, then ${k('POWER/ENTER')} to test it.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).alarmTest && M(a).alarmTest.level === 2 },
      { t: `Press ${k('RESET/▼')} to stop.`, hl: { keys: ['down'] }, done: a => !M(a).alarmTest },
      { t: `Press ${k('DISP/ESC')} to go back, then ${k('DISP/ESC')} until measurement mode.`, hl: { keys: ['mode'] }, done: a => M(a).mode === 'meas' },
      final('Alarm test done ✔'),
    ],
  },
  {
    id: 'bump', title: 'Bump test (User mode)', setup: { power: 'on', cal: 'aircal', cyl: 'N2' },
    steps: [
      ...userModeSteps,
      { t: `<b>>BUMP TEST</b> is selected. Press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'bumpmenu' },
      { t: 'CYLINDER A shows the test gas: O2 12.0 · H2S 25.0 · CO 50 · CH4 50. Check against the cylinder label.', ack: true },
      ...gasSteps('MIX4'),
      connectMeter(),
      { t: `Press ${k('POWER/ENTER')} to start the bump test.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'bumprun' },
      { t: 'Keep the gas flowing — remaining time is shown bottom right.', done: a => M(a).mode !== 'bumprun' || st(a).phase === 'result' },
      { t: `RESULT: P = pass, F = fail. ${k('RESET/▼')} shows the values. Press ${k('POWER/ENTER')} to finish.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'bumpmenu' },
      disconnectMeter(),
      { t: `Press ${k('RESET/▼')} until <b>START MEASURE</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'start' || M(a).mode === 'meas' },
      final('Bump test complete ✔ — the meter returns to measurement after the start-up screens.'),
    ],
  },
  {
    id: 'span', title: 'Span calibration (User mode GAS CAL)', setup: { power: 'on', cyl: 'N2' },
    steps: [
      ...userModeSteps,
      { t: `Press ${k('RESET/▼')} to <b>GAS CAL</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'gascal' },
      { t: `<b>>AIR CAL</b> first — press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'uair' },
      { t: `Hold ${k('▲/AIR')} until RELEASE, then let go → PASS.`, hl: { keys: ['up'] }, done: a => M(a).mode === 'gascal' && Math.abs(M(a).S('O2').value() - 20.9) < 0.15 },
      { t: `Press ${k('RESET/▼')} to <b>SPAN CAL</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'spanmenu' },
      { t: `CYLINDER A (O2 12.0 · H2S 25.0 · CO 50 · CH4 50). Press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'spanrun' },
      ...gasSteps('MIX4'),
      connectMeter(),
      waitStable(60),
      { t: `Press ${k('POWER/ENTER')} to adjust.`, hl: { keys: ['enter'] }, done: a => M(a).mode !== 'spanrun' || st(a).phase !== 'supply' },
      { t: 'ADJUSTING → <b>PASS</b>.', done: a => M(a).mode === 'spanmenu' },
      disconnectMeter(),
      { t: `Press ${k('RESET/▼')} to <b>START MEASURE</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'start' || M(a).mode === 'meas' },
      final('Span calibration done ✔'),
    ],
  },
  {
    id: 'alarmset', title: 'Change alarm setpoints (User mode)', setup: { power: 'on', cal: 'aircal' },
    steps: [
      ...userModeSteps,
      { t: `Press ${k('RESET/▼')} to <b>ALARM SETTING</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'alarmmenu' },
      { t: `<b>>ALARM POINTS</b> — press ${k('POWER/ENTER')}.`, hl: { keys: ['enter'] }, done: a => M(a).mode === 'alarmpts' },
      { t: `Press ${k('RESET/▼')} to select <b>CO</b> (O2 → H2S → CO), then ${k('POWER/ENTER')}.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'alarmpts' && st(a).phase === 'edit' && st(a).sel === 2 },
      { t: `WARNING (25 ppm) blinks. Press ${k('▲/AIR')} to set <b>30</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['up', 'enter'] }, done: a => M(a).mode !== 'alarmpts' || st(a).phase !== 'edit' || st(a).fi >= 1 },
      { t: `ALARM, STEL, TWA: press ${k('POWER/ENTER')} for each to keep them → END.`, hl: { keys: ['enter'] }, done: a => (M(a).mode === 'alarmpts' && st(a).phase === 'sel') },
      { t: `Press ${k('DISP/ESC')} twice to go back to the USER MODE menu.`, hl: { keys: ['mode'] }, done: a => M(a).mode === 'user' },
      { t: `Press ${k('RESET/▼')} to <b>START MEASURE</b>, then ${k('POWER/ENTER')}.`, hl: { keys: ['down', 'enter'] }, done: a => M(a).mode === 'start' || M(a).mode === 'meas' },
      final(a => `New CO WARNING setpoint: ${M(a).S('CO').alarm.w} ppm ✔`),
    ],
  },
  {
    id: 'gasalarm', title: 'Gas alarm check (with test gas)', setup: { power: 'on', cal: 'perfect', cyl: 'N2' },
    steps: [
      { t: 'Setpoints: O2 19.5 low / 23.5 high · H2S 1.0/10.0 · CO 25/50 · CH4 10/50 %LEL.', ack: true },
      ...gasSteps('MIX4'),
      connectMeter(),
      { t: 'Watch the readings rise into <b>WARNING</b> and <b>ALARM</b> — alarming cells flash.', done: a => M(a).topAlarm() >= 2 },
      disconnectMeter(),
      { t: 'Wait in fresh air until all readings are normal again.', done: a => M(a).sensors.every(s => s.alarmLevel(s.reading()) === 0) },
      { t: `Press ${k('RESET/▼')} to reset the latched alarm.`, hl: { keys: ['down'] }, done: a => M(a).topAlarm() === 0 },
      final('Gas alarm check done ✔'),
    ],
  },
];

export const TASKS = { 'GX-8000': GX8000, 'RX-8000': RX8000, 'GX-9000': GX9000 };
