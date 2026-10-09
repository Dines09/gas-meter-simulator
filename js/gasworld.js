import { AIR } from './meter-base.js';
import { clamp, esc } from './util.js';

// Calibration cylinders. Concentrations: vol% for O2/N2/CH4/iC4H10, ppm for CO/H2S.
export const CYLINDERS = {
  MIX4: {
    chip: '4-gas mix', title: '4-gas calibration mix', body: '#d9dde0', band: '#f2c230',
    comp: { CH4: 2.5, O2: 12.0, CO: 50, H2S: 25, N2: 85.5 },
    lines: ['CAL GAS', 'CH4 2.5%', '(50 %LEL)', 'O2 12.0%', 'CO 50 ppm', 'H2S 25 ppm', 'bal. N2'],
  },
  HC50: {
    chip: 'HC 50 %LEL', title: 'Isobutane 50 %LEL in air', body: '#d9dde0', band: '#e8742c',
    comp: { iC4H10: 0.9, O2: 20.7, N2: 78.4 },
    lines: ['CAL GAS', 'i-C4H10', '0.90 vol%', '(50 %LEL)', 'bal. AIR'],
  },
  HCV: {
    chip: 'HC 30 vol%', title: 'Isobutane 30 vol% in N2', body: '#d9dde0', band: '#b5452f',
    comp: { iC4H10: 30, N2: 70, O2: 0 },
    lines: ['CAL GAS', 'i-C4H10', '30.0 vol%', 'bal. N2'],
  },
  N2: {
    chip: 'N2 99.99%', title: 'Nitrogen 99.99 % (O2 zero)', body: '#3d4851', band: '#20272d',
    comp: { N2: 100, O2: 0 },
    lines: ['NITROGEN', 'N2 99.99%', '(O2 0.0%)'],
  },
  ZAIR: {
    chip: 'Zero air', title: 'Zero air (clean air)', body: '#d9dde0', band: '#5aa0d8',
    comp: { ...AIR },
    lines: ['ZERO AIR', 'O2 20.9%', 'no HC/CO', 'no H2S'],
  },
};

const BAG_CAP = 2.0;      // L
const FILL_FLOW = 2.0;    // L/min from the fixed-flow regulator
const PUMP_FLOW = 0.75;   // L/min drawn by the detector pump

const SPECIES = ['O2', 'N2', 'CH4', 'iC4H10', 'CO', 'H2S'];

// snap (quick-connect) coupling welded into the bag edge; dir = -1 points left, 1 points right
function coupler(x, y, dir) {
  const d = dir;
  const X = v => x + d * v;
  const r = (a, b) => [Math.min(X(a), X(b)), Math.abs(b - a)];
  const [bx, bw] = r(-6, 6), [sx, sw] = r(6, 20), [nx, nw] = r(20, 29);
  let ribsS = '';
  for (let i = 0; i < 4; i++) ribsS += `<rect x="${Math.min(X(8 + i * 3), X(9.5 + i * 3))}" y="${y - 7}" width="1.5" height="14" fill="rgba(0,0,0,.35)"/>`;
  return `<g>
    <rect x="${bx}" y="${y - 9}" width="${bw}" height="18" rx="2" fill="#1f2a33" stroke="#0e1418"/>
    <rect x="${sx}" y="${y - 7}" width="${sw}" height="14" rx="2" fill="url(#metalH)" stroke="#59626a" stroke-width=".8"/>
    ${ribsS}
    <rect x="${nx}" y="${y - 4}" width="${nw}" height="8" rx="2" fill="url(#metalG)" stroke="#59626a" stroke-width=".8"/>
  </g>`;
}

export class GasWorld {
  constructor(app, host, chipsHost, statusHost) {
    this.app = app;
    this.host = host;
    this.chipsHost = chipsHost;
    this.statusHost = statusHost;
    this.cylList = [];
    this.cylId = null;
    this.reg = { open: false };
    this.pressure = {};
    this.bag = { vol: 0, amt: {} };
    this.warnT = {};
    this.directWarned = false;
    this.hl = new Set();
    this.drawn = 0;
  }

  get cyl() { return CYLINDERS[this.cylId]; }

  setCylinders(list) {
    this.cylList = list;
    for (const id of list) if (this.pressure[id] == null) this.pressure[id] = 1;
    this.cylId = list[0];
    this.build();
  }

  reset({ cyl } = {}) {
    this.reg.open = false;
    this.bag = { vol: 0, amt: {} };
    for (const id of this.cylList) this.pressure[id] = 1;
    if (cyl && this.cylList.includes(cyl)) this.cylId = cyl;
    this.build();
  }

  selectCylinder(id) {
    if (id === this.cylId) return;
    if (this.reg.open) {
      this.app.toast('Close the regulator before changing the cylinder.');
      return;
    }
    this.cylId = id;
    this.build();
    if (this.bag.vol > 0.05) this.app.toast('Cylinder changed. Squeeze the bag out before filling it with the new gas.');
  }

  // ---------------- bench drawing ----------------
  build() {
    this.chipsHost.innerHTML = this.cylList.map(id =>
      `<button class="cyl-chip${id === this.cylId ? ' on' : ''}" data-cyl="${id}">${esc(CYLINDERS[id].chip)}</button>`).join('');
    this.chipsHost.querySelectorAll('.cyl-chip').forEach(b => {
      b.onclick = () => this.selectCylinder(b.dataset.cyl);
    });

    const c = this.cyl;
    const lines = c.lines.map((t, i) =>
      `<text x="63" y="${132 + i * 12}" text-anchor="middle" font-size="${i === 0 ? 9 : 8.4}" font-weight="${i === 0 ? 800 : 600}" fill="#1b1b1b" font-family="Inter, Arial, sans-serif">${esc(t)}</text>`).join('');

    this.host.innerHTML = `
<svg viewBox="0 0 400 270" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="cylG" x1="0" x2="1">
      <stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".35" stop-color="#fff" stop-opacity=".35"/>
      <stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".4"/>
    </linearGradient>
    <linearGradient id="metalG" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#aab3ba"/><stop offset="1" stop-color="#6c767e"/>
    </linearGradient>
    <linearGradient id="metalH" x1="0" x2="1">
      <stop offset="0" stop-color="#7d878f"/><stop offset=".45" stop-color="#eef1f3"/><stop offset="1" stop-color="#6c767e"/>
    </linearGradient>
    <radialGradient id="bagG" cx=".38" cy=".3" r=".85">
      <stop offset="0" stop-color="#cfe6fb" stop-opacity=".55"/><stop offset=".55" stop-color="#3f79ad" stop-opacity=".38"/>
      <stop offset="1" stop-color="#1d3d5c" stop-opacity=".55"/>
    </radialGradient>
  </defs>

  <!-- floor shadow -->
  <ellipse cx="325" cy="262" rx="44" ry="6" fill="#000" opacity=".35"/>

  <!-- cylinder -->
  <g transform="translate(262,0)">
  <g id="cylinder">
    <path d="M28 96 Q28 74 63 70 Q98 74 98 96 L98 250 Q98 258 90 258 L36 258 Q28 258 28 250 Z" fill="${c.body}"/>
    <path d="M28 96 Q28 74 63 70 Q98 74 98 96 L98 250 Q98 258 90 258 L36 258 Q28 258 28 250 Z" fill="url(#cylG)"/>
    <rect x="28" y="104" width="70" height="12" fill="${c.band}"/>
    <rect x="33" y="120" width="60" height="${Math.max(44, c.lines.length * 12 + 6)}" rx="3" fill="#fbfbf6" stroke="#9aa" stroke-width=".6"/>
    ${lines}
    <rect x="54" y="58" width="18" height="14" fill="url(#metalH)"/>
  </g>

  <!-- regulator -->
  <g id="regulator">
    <rect x="44" y="30" width="38" height="30" rx="5" fill="url(#metalH)" stroke="#59626a" stroke-width="1"/>
    <rect x="24" y="38" width="22" height="9" fill="url(#metalG)" stroke="#59626a" stroke-width=".8"/>
    <path d="M12 40 L24 39 L24 46 L12 45 Z" fill="url(#metalG)" stroke="#59626a" stroke-width=".8"/>
    <g id="gauge" transform="translate(54,0)">
      <circle cx="36" cy="46" r="15" fill="#e9eef1" stroke="#4a545c" stroke-width="2.5"/>
      <path d="M26 52 A11 11 0 1 1 46 52" fill="none" stroke="#2e7d32" stroke-width="2.5"/>
      <path d="M26 52 A11 11 0 0 1 25.5 42" fill="none" stroke="#c62828" stroke-width="2.5"/>
      <line id="needle" x1="36" y1="46" x2="36" y2="35" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="36" cy="46" r="2" fill="#111"/>
      <text x="36" y="58" text-anchor="middle" font-size="4.5" fill="#333" font-family="Inter, Arial, sans-serif">MPa</text>
    </g>
    <g id="knob" class="tap">
      <circle cx="63" cy="20" r="22" fill="transparent"/>
      <rect x="51" y="20" width="24" height="12" fill="url(#metalH)"/>
      <circle cx="63" cy="16" r="13" fill="#222a30" stroke="#0e1215" stroke-width="1.5"/>
      <g id="knobMark"><rect x="61.5" y="4" width="3" height="9" rx="1.5" fill="#ffd23f"/></g>
      <text id="regLbl" x="63" y="19.5" text-anchor="middle" font-size="6.6" font-weight="800" fill="#fff" font-family="Inter, Arial, sans-serif">OFF</text>
    </g>
  </g>
  </g>
  <circle id="port-reg" cx="272" cy="42.5" r="3" fill="none"/>
  <g id="regHint" class="reg-hint" style="display:none">
    <rect x="226" y="4" width="78" height="22" rx="7" fill="#ffd23f"/>
    <path d="M304 10 l9 5 l-9 5 z" fill="#ffd23f"/>
    <text id="regHintTxt" x="265" y="19" text-anchor="middle" font-size="10.5" font-weight="900" fill="#1b1300" font-family="Inter, Arial, sans-serif">TAP: OPEN</text>
  </g>

  <!-- gas sampling bag: plain tinted plastic bag with self-sealing snap couplings -->
  <g id="bagGroup">
    <path id="bagBody" d="" fill="url(#bagG)" stroke="#5f86a8" stroke-width="1.4"/>
    <path id="bagSeam" d="" fill="none" stroke="#7fa6c7" stroke-width="5" opacity=".45"/>
    <text id="bagTxt" x="145" y="170" text-anchor="middle" font-size="13" font-weight="800" fill="#e6f0f8" font-family="Inter, Arial, sans-serif"></text>
    <text id="bagSub" x="145" y="184" text-anchor="middle" font-size="8.5" font-weight="600" fill="#b9cfe0" font-family="Inter, Arial, sans-serif"></text>
    <text x="100" y="246" text-anchor="middle" font-size="8.5" font-weight="700" fill="#7f97a8" font-family="Inter, Arial, sans-serif">GAS SAMPLING BAG · 2 L</text>
    ${coupler(52, 165, -1)}
    ${coupler(238, 165, 1)}
    <text x="256" y="152" text-anchor="middle" font-size="8" font-weight="800" fill="#9fb0bc" font-family="Inter, Arial, sans-serif">IN</text>
    <text x="34" y="152" text-anchor="middle" font-size="8" font-weight="800" fill="#9fb0bc" font-family="Inter, Arial, sans-serif">OUT</text>
    <g id="emptyBtn" class="tap">
      <rect x="172" y="234" width="62" height="24" rx="7" fill="#232c33" stroke="#3d4b55"/>
      <text x="203" y="250" text-anchor="middle" font-size="9.5" font-weight="700" fill="#cfd8de" font-family="Inter, Arial, sans-serif">Squeeze out</text>
    </g>
  </g>
  <circle id="port-bagIn" cx="269" cy="165" r="3" fill="none"/>
  <circle id="port-bagOut" cx="21" cy="165" r="3" fill="none"/>
</svg>`;

    this.svg = this.host.querySelector('svg');
    this.el = {
      needle: this.svg.querySelector('#needle'),
      knobMark: this.svg.querySelector('#knobMark'),
      regLbl: this.svg.querySelector('#regLbl'),
      bagBody: this.svg.querySelector('#bagBody'),
      bagSeam: this.svg.querySelector('#bagSeam'),
      bagTxt: this.svg.querySelector('#bagTxt'),
      bagSub: this.svg.querySelector('#bagSub'),
      knob: this.svg.querySelector('#knob'),
      regHint: this.svg.querySelector('#regHint'),
      regHintTxt: this.svg.querySelector('#regHintTxt'),
      emptyBtn: this.svg.querySelector('#emptyBtn'),
      cylinder: this.svg.querySelector('#cylinder'),
    };
    this.el.knob.addEventListener('click', () => this.toggleRegulator());
    this.el.emptyBtn.addEventListener('click', () => this.emptyBag());

    const t = this.app.tubes;
    t.registerPort('reg', this.svg.querySelector('#port-reg'), [-1, 0]);
    t.registerPort('bagIn', this.svg.querySelector('#port-bagIn'), [1, 0]);
    t.registerPort('bagOut', this.svg.querySelector('#port-bagOut'), [-1, 0]);
    this.render(true);
  }

  toggleRegulator() {
    this.reg.open = !this.reg.open;
    this.app.buzzer.click();
    if (this.reg.open) {
      const p = this.app.tubes.peer('reg');
      if (!p || p === 'free') this.app.toast('Regulator open but no tube connected: gas is being wasted!');
    }
  }

  emptyBag() {
    if (this.bag.vol < 0.01) { this.app.toast('The bag is already empty.'); return; }
    this.bag.vol = 0; this.bag.amt = {};
    this.app.toast('Bag squeezed empty.', true);
  }

  warn(key, msg, every = 6) {
    const now = performance.now() / 1000;
    if (this.warnT[key] && now - this.warnT[key] < every) return;
    this.warnT[key] = now;
    this.app.toast(msg);
  }

  bagComp() {
    const v = this.bag.vol;
    if (v <= 1e-6) return null;
    const c = {};
    for (const s of SPECIES) c[s] = (this.bag.amt[s] || 0) / v;
    return c;
  }

  addToBag(comp, liters) {
    for (const s of SPECIES) this.bag.amt[s] = (this.bag.amt[s] || 0) + (comp[s] || 0) * liters;
    this.bag.vol += liters;
  }

  takeFromBag(liters) {
    const v = this.bag.vol;
    if (v <= 0) return;
    const f = Math.max(0, (v - liters) / v);
    for (const s of SPECIES) this.bag.amt[s] = (this.bag.amt[s] || 0) * f;
    this.bag.vol = Math.max(0, v - liters);
  }

  isBagPort(p) { return p === 'bagIn' || p === 'bagOut'; }

  // ---------------- gas flows ----------------
  update(dt) {
    const tubes = this.app.tubes;
    const regPeer = tubes.peer('reg');
    const min = dt / 60;
    if (this.reg.open && this.pressure[this.cylId] > 0) {
      if (this.isBagPort(regPeer)) {
        if (this.bag.vol < BAG_CAP) {
          const add = Math.min(FILL_FLOW * min, BAG_CAP - this.bag.vol);
          this.addToBag(this.cyl.comp, add);
          this.pressure[this.cylId] = Math.max(0, this.pressure[this.cylId] - add * 0.004);
        } else {
          this.warn('full', 'Bag is full: close the regulator now.');
        }
      } else if (regPeer !== 'meterIn') {
        this.pressure[this.cylId] = Math.max(0, this.pressure[this.cylId] - FILL_FLOW * min * 0.004);
        this.warn('vent', 'Gas is venting from the regulator: connect the tube or close the regulator.', 8);
      } else {
        this.pressure[this.cylId] = Math.max(0, this.pressure[this.cylId] - FILL_FLOW * min * 0.004);
      }
    }
  }

  // Called by the meter every tick. Returns what the pump draws in.
  meterDraw(dt, pumping) {
    if (!pumping) return { comp: null, blocked: false };
    const p = this.app.tubes.peer('meterIn');
    if (!p || p === 'free') return { comp: AIR, blocked: false };
    if (p === 'reg') {
      if (!this.directWarned) {
        this.directWarned = true;
        this.app.toast('Tip: the manual connects the meter to a gas sampling bag, not straight to the cylinder.');
      }
      return this.reg.open && this.pressure[this.cylId] > 0 ? { comp: this.cyl.comp, blocked: false } : { comp: null, blocked: true };
    }
    if (this.isBagPort(p)) {
      const other = p === 'bagIn' ? 'bagOut' : 'bagIn';
      const otherPeer = this.app.tubes.peer(other);
      if (otherPeer === 'free') return { comp: AIR, blocked: false }; // pump pulls room air through the loose tube
      if (this.bag.vol <= 0.02) return { comp: null, blocked: true };
      const comp = this.bagComp();
      this.takeFromBag(PUMP_FLOW * dt / 60);
      this.drawn += PUMP_FLOW * dt / 60;
      return { comp, blocked: false };
    }
    return { comp: AIR, blocked: false };
  }

  // ---------------- per-frame visuals ----------------
  bagPath(inf) {
    const x0 = 56, x1 = 234, yT = 124, yB = 206;
    const midY = (yT + yB) / 2;
    const bulge = 1 + inf * 20;
    const pinch = inf * 8;
    return `M${x0 + pinch} ${yT + 3}
      Q${(x0 + x1) / 2} ${yT - bulge} ${x1 - pinch} ${yT + 3}
      Q${x1 + 2 + inf * 5} ${midY} ${x1 - pinch} ${yB - 3}
      Q${(x0 + x1) / 2} ${yB + bulge} ${x0 + pinch} ${yB - 3}
      Q${x0 - 2 - inf * 5} ${midY} ${x0 + pinch} ${yT + 3} Z`;
  }

  render(force = false) {
    if (!this.el) return;
    const p = this.pressure[this.cylId] ?? 1;
    const ang = -120 + p * 240;
    this.el.needle.setAttribute('transform', `rotate(${ang.toFixed(1)} 36 46)`);
    this.el.knobMark.setAttribute('transform', `rotate(${this.reg.open ? 90 : 0} 63 16)`);
    this.el.regLbl.textContent = this.reg.open ? 'ON' : 'OFF';
    this.el.regLbl.setAttribute('fill', this.reg.open ? '#7dff9a' : '#fff');

    const inf = clamp(this.bag.vol / BAG_CAP, 0, 1);
    if (force || Math.abs(inf - (this._inf ?? -1)) > 0.002) {
      this._inf = inf;
      this.el.bagBody.setAttribute('d', this.bagPath(inf));
      this.el.bagSeam.setAttribute('d', this.bagPath(inf));
    }
    this.el.bagTxt.textContent = this.bag.vol > 0.005 ? `${this.bag.vol.toFixed(2)} L` : 'empty';
    this.el.bagSub.textContent = this.bag.vol > 0.005 ? this.bagLabel() : 'flat — fill from the cylinder';

    for (const [k, node] of Object.entries({ knob: this.el.knob, empty: this.el.emptyBtn, cylinder: this.el.cylinder })) {
      node.classList.toggle('hl-target', this.hl.has(k));
    }
    this.chipsHost.querySelectorAll('.cyl-chip').forEach(b => {
      b.classList.toggle('on', b.dataset.cyl === this.cylId);
      b.classList.toggle('hl', this.hl.has('cyl:' + b.dataset.cyl));
    });

    const regPeer = this.app.tubes.peer('reg');
    // guide the user to the cylinder valve: open it when the bag is connected but empty, close it when full
    const needOpen = !this.reg.open && this.isBagPort(regPeer) && this.bag.vol < 1.5;
    const needClose = this.reg.open && (this.bag.vol >= BAG_CAP - 0.05 || !regPeer || regPeer === 'free');
    const hint = needOpen ? 'TAP: OPEN' : needClose ? 'TAP: CLOSE' : '';
    if (hint !== this._hint) {
      this._hint = hint;
      this.el.regHint.style.display = hint ? '' : 'none';
      this.el.regHintTxt.textContent = hint;
    }
    const status = [
      `Cylinder: <b>${esc(this.cyl.title)}</b>`,
      `Regulator <b>${this.reg.open ? 'OPEN' : 'closed'}</b>${this.reg.open && this.isBagPort(regPeer) ? ' · filling bag' : ''}`,
    ];
    if (needOpen) status.push('<b style="color:#ffd23f">→ open the cylinder valve (tap the knob)</b>');
    else if (needClose) status.push('<b style="color:#ffd23f">→ close the cylinder valve</b>');
    this.statusHost.innerHTML = status.join(' · ');
  }

  bagLabel() {
    const c = this.bagComp();
    if (!c) return '';
    let best = null, bestD = Infinity;
    for (const id of this.cylList) {
      const cc = CYLINDERS[id].comp;
      let d = 0;
      for (const s of SPECIES) d += Math.abs((c[s] || 0) - (cc[s] || 0)) / (s === 'CO' || s === 'H2S' ? 50 : 10);
      if (d < bestD) { bestD = d; best = id; }
    }
    return bestD < 0.15 ? CYLINDERS[best].chip : 'mixed gas';
  }
}
