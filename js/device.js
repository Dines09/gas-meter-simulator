// Front-panel artwork for the simulated detectors (pure SVG, scales with the viewport).

const LCD_X = 158, LCD_Y = 92, LCD_W = 244, LCD_H = 152;

// ribbed, spring-like translucent lens (side alarm LED arrays)
function coil(x, y, w, h, n) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="url(#coilG)" stroke="#5c6369" stroke-width="1"/>`;
  for (let i = 1; i < n; i++) {
    const yy = y + (i * h) / n;
    s += `<path d="M${x + 1} ${yy} q${w / 2} ${-3} ${w - 2} 0" fill="none" stroke="rgba(40,45,50,.55)" stroke-width="1.6"/>`;
    s += `<path d="M${x + 1} ${yy + 1.4} q${w / 2} ${-3} ${w - 2} 0" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="0.9"/>`;
  }
  return s;
}

function ribs(x, y, w, h, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<rect x="${x + (i * w) / n}" y="${y}" width="${(w / n) * 0.45}" height="${h}" fill="rgba(0,0,0,.28)"/>`;
  return s;
}

function key({ key, x, y, l1, l2, small }) {
  const font = 'Barlow Condensed, Arial Narrow, Arial, sans-serif';
  const fs = small ? 13.5 : 15;
  return `
  <g class="dev-key" data-key="${key}" transform="translate(${x},${y})">
    <circle class="ring" r="41"/>
    <circle r="35" fill="#08090a"/>
    <g class="cap">
      <circle class="face" r="32" fill="url(#keyG)"/>
      <circle class="rim" r="27.5" fill="none" stroke="#f2f4f5" stroke-width="2"/>
      <path d="M-22 -16 A27 27 0 0 1 22 -16" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="5" stroke-linecap="round"/>
      <text y="${l2 ? -2 : 5}" text-anchor="middle" font-family="${font}" font-weight="700" font-size="${fs}" fill="#f6f7f8">${l1}</text>
      ${l2 ? `<text y="14" text-anchor="middle" font-family="${font}" font-weight="700" font-size="${fs}" fill="#f6f7f8">${l2}</text>` : ''}
    </g>
    <circle r="46" fill="transparent"/>
  </g>`;
}

export function deviceSVG(opts) {
  const { model, theme, keys, lcdBg, lcdViewBox, extra = '' } = opts;
  const red = theme === 'red';
  const bumper = red ? '#c8261d' : '#1d2124';
  const bumperHi = red ? '#ee4a3d' : '#3a4045';
  const face = red ? '#14171a' : '#121416';

  return `
<svg viewBox="0 0 580 372" preserveAspectRatio="xMidYMid meet" aria-label="${model} front panel">
  <defs>
    <radialGradient id="keyG" cx=".42" cy=".35" r=".8">
      <stop offset="0" stop-color="#2c3136"/><stop offset=".7" stop-color="#121417"/><stop offset="1" stop-color="#08090a"/>
    </radialGradient>
    <linearGradient id="bumpG" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${bumperHi}"/><stop offset=".25" stop-color="${bumper}"/><stop offset="1" stop-color="${bumper}" stop-opacity=".92"/>
    </linearGradient>
    <linearGradient id="coilG" x1="0" x2="1">
      <stop offset="0" stop-color="#6d757b"/><stop offset=".45" stop-color="#d9dee1"/><stop offset="1" stop-color="#7d858b"/>
    </linearGradient>
    <linearGradient id="nozG" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#a7b0b7"/><stop offset="1" stop-color="#5c656c"/>
    </linearGradient>
    <linearGradient id="glassG" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="lampGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>

  <!-- body -->
  <rect x="26" y="22" width="504" height="340" rx="40" fill="#0d0f11"/>
  <rect id="devBody" x="20" y="14" width="504" height="340" rx="40" fill="url(#bumpG)"/>
  ${red ? '' : `<rect x="20" y="14" width="504" height="340" rx="40" fill="none" stroke="#2c3236" stroke-width="3"/>`}

  <!-- gas inlet / outlet on the right-hand side of the body -->
  <g>
    <text x="544" y="46" text-anchor="middle" font-size="12" font-weight="800" fill="#9fb0bc" font-family="Inter, Arial, sans-serif">GAS IN</text>
    <rect x="518" y="58" width="24" height="20" rx="3" fill="#2a2f33"/>
    <path d="M540 61 L560 63 L560 73 L540 75 Z" fill="url(#nozG)" stroke="#555" stroke-width="1"/>
    <circle id="port-meterIn" cx="562" cy="68" r="3" fill="none"/>
    <rect x="518" y="92" width="24" height="18" rx="3" fill="#2a2f33"/>
    <circle cx="538" cy="101" r="5" fill="#0c0e10" stroke="#555"/>
    <text x="540" y="128" text-anchor="middle" font-size="9" font-weight="700" fill="#6c7a84" font-family="Inter, Arial, sans-serif">GAS OUT</text>
  </g>

  <!-- alarm lamps: top lens + ribbed side lenses -->
  <g id="lamps">
    <rect x="232" y="4" width="80" height="24" rx="6" fill="#5a1410"/>
    <rect class="lamp" data-off="#7a1c14" x="236" y="7" width="72" height="18" rx="4" fill="#7a1c14"/>
    ${ribs(236, 7, 72, 18, 12)}
    ${coil(12, 132, 15, 104, 13)}
    ${coil(517, 132, 15, 104, 13)}
    <rect class="lamp" data-off="rgba(255,40,30,0)" x="12" y="132" width="15" height="104" rx="7.5" fill="rgba(255,40,30,0)"/>
    <rect class="lamp" data-off="rgba(255,40,30,0)" x="517" y="132" width="15" height="104" rx="7.5" fill="rgba(255,40,30,0)"/>
    <rect id="lampGlow" x="216" y="-6" width="112" height="44" rx="20" fill="#ff3b2f" opacity="0" filter="url(#lampGlow)"/>
  </g>

  <!-- face plate -->
  <rect x="48" y="40" width="448" height="292" rx="26" fill="${face}"/>
  ${theme === 'black' ? `<rect x="56" y="48" width="432" height="276" rx="20" fill="none" stroke="#d42a20" stroke-width="3"/>` : ''}
  ${opts.stripes || ''}
  <rect x="72" y="58" width="28" height="24" rx="3" fill="#8b949b"/><rect x="76" y="62" width="20" height="16" rx="2" fill="#c3cad0"/>
  <g transform="translate(110,66)" fill="#3a4147">${[0, 1, 2].map(i => `<circle cx="${i * 7}" cy="0" r="2"/><circle cx="${i * 7}" cy="7" r="2"/>`).join('')}</g>
  <g transform="translate(280,74)">
    <path d="M-74 -9 l9 0 l-6 9 l6 9 l-9 0 l-6 -9z" fill="#e8ecef"/>
    <path d="M-62 -9 l6 0 l-6 9 l6 9 l-6 0 l-6 -9z" fill="${red ? '#e8ecef' : '#d42a20'}"/>
    <text x="10" y="7" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="22" letter-spacing="1.5" fill="#f1f4f6">RIKEN KEIKI</text>
  </g>

  <!-- LCD -->
  <rect x="${LCD_X - 10}" y="${LCD_Y - 8}" width="${LCD_W + 20}" height="${LCD_H + 16}" rx="10" fill="#2c3237"/>
  <rect id="lcdBg" x="${LCD_X}" y="${LCD_Y}" width="${LCD_W}" height="${LCD_H}" rx="4" fill="${lcdBg}"/>
  <svg id="lcd" x="${LCD_X}" y="${LCD_Y}" width="${LCD_W}" height="${LCD_H}" viewBox="${lcdViewBox}" preserveAspectRatio="none"></svg>
  <rect x="${LCD_X}" y="${LCD_Y}" width="${LCD_W}" height="${LCD_H}" rx="4" fill="url(#glassG)" pointer-events="none"/>
  <text x="280" y="${LCD_Y + LCD_H + 34}" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-style="italic" font-weight="700" font-size="25" letter-spacing="1" fill="#eef1f3">${model}</text>
  ${extra}
  ${keys.map(key).join('')}
</svg>`;
}

export const KEYPOS = {
  leftTop: { x: 108, y: 160 },
  leftBot: { x: 108, y: 252 },
  rightTop: { x: 452, y: 172 },
  rightBot: { x: 452, y: 262 },
};
