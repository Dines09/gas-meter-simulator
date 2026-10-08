// Segment-LCD glyph renderers (SVG strings) used by the GX-8000 and RX-8000 displays.

const S7 = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg',
  '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  A: 'abcefg', a: 'abcdeg', b: 'cdefg', B: 'cdefg', C: 'adef', c: 'deg', d: 'bcdeg', D: 'bcdeg',
  E: 'adefg', e: 'abdefg', F: 'aefg', f: 'aefg', G: 'acdef', g: 'abcdfg', H: 'bcefg', h: 'cefg',
  I: 'ef', i: 'e', J: 'bcde', j: 'bcd', K: 'bcefg', k: 'cefg', L: 'def', l: 'ef', M: 'aceg', m: 'aceg',
  N: 'abcef', n: 'ceg', O: 'abcdef', o: 'cdeg', P: 'abefg', p: 'abefg', Q: 'abcfg', q: 'abcfg',
  R: 'eg', r: 'eg', S: 'acdfg', s: 'acdfg', T: 'defg', t: 'defg', U: 'bcdef', u: 'cde',
  V: 'bcdef', v: 'cde', W: 'bdf', w: 'bdf', X: 'bcefg', x: 'bcefg', Y: 'bcdfg', y: 'bcdfg',
  Z: 'abdeg', z: 'abdeg', '-': 'g', '_': 'd', '=': 'dg', '°': 'abfg', ' ': '', '[': 'adef', ']': 'abcd',
};

// Parse a display string into cells. A '.' or ':' attaches to the previous cell.
export function cells(str) {
  const out = [];
  for (const ch of String(str)) {
    if ((ch === '.' || ch === ':') && out.length && !out[out.length - 1][ch === '.' ? 'dp' : 'colon']) {
      out[out.length - 1][ch === '.' ? 'dp' : 'colon'] = true;
    } else if (ch === '.') {
      out.push({ ch: ' ', dp: true });
    } else {
      out.push({ ch });
    }
  }
  return out;
}

const SK = 0.11; // italic slant of LCD glyphs

function sk(x, y, x0, y0, h) {
  return `${(x0 + x + (h - y) * SK).toFixed(2)},${(y0 + y).toFixed(2)}`;
}

function hseg(x0, y0, h, xa, xb, y, t) {
  const p = [[xa, y], [xa + t / 2, y - t / 2], [xb - t / 2, y - t / 2], [xb, y], [xb - t / 2, y + t / 2], [xa + t / 2, y + t / 2]];
  return p.map(([x, yy]) => sk(x, yy, x0, y0, h)).join(' ');
}
function vseg(x0, y0, h, x, ya, yb, t) {
  const p = [[x, ya], [x + t / 2, ya + t / 2], [x + t / 2, yb - t / 2], [x, yb], [x - t / 2, yb - t / 2], [x - t / 2, ya + t / 2]];
  return p.map(([xx, y]) => sk(xx, y, x0, y0, h)).join(' ');
}

function seg7Polys(x0, y0, h) {
  const w = h * 0.52, t = h * 0.135, g = t * 0.22, m = h / 2;
  return {
    a: hseg(x0, y0, h, t / 2 + g, w - t / 2 - g, t / 2, t),
    g: hseg(x0, y0, h, t / 2 + g, w - t / 2 - g, m, t),
    d: hseg(x0, y0, h, t / 2 + g, w - t / 2 - g, h - t / 2, t),
    f: vseg(x0, y0, h, t / 2, t / 2 + g, m - g, t),
    b: vseg(x0, y0, h, w - t / 2, t / 2 + g, m - g, t),
    e: vseg(x0, y0, h, t / 2, m + g, h - t / 2 - g, t),
    c: vseg(x0, y0, h, w - t / 2, m + g, h - t / 2 - g, t),
    w, t,
  };
}

/**
 * Draw a row of 7-segment cells.
 * @param {number} x left of first cell, @param {number} y top, @param {number} h digit height
 * @param {string|Array} str text or pre-parsed cells
 * @param {object} o { pitch, n (cells, right-aligned), on, ghost, align }
 */
export function draw7(x, y, h, str, o = {}) {
  const pitch = o.pitch || h * 0.72;
  let cs = Array.isArray(str) ? str : cells(str);
  const n = o.n || cs.length;
  if (cs.length < n) {
    const padCells = Array.from({ length: n - cs.length }, () => ({ ch: ' ' }));
    cs = o.align === 'left' ? cs.concat(padCells) : padCells.concat(cs);
  } else if (cs.length > n) cs = cs.slice(cs.length - n);
  const on = o.on || 'var(--seg-on)';
  let s = '';
  cs.forEach((c, i) => {
    const P = seg7Polys(x + i * pitch, y, h);
    const lit = S7[c.ch] ?? S7[String(c.ch).toUpperCase()] ?? '';
    for (const k of 'abcdefg') {
      if (lit.includes(k)) s += `<polygon points="${P[k]}" fill="${on}"/>`;
      else if (o.ghost) s += `<polygon points="${P[k]}" fill="var(--seg-ghost)"/>`;
    }
    if (c.dp || o.ghost) {
      const cx = x + i * pitch + P.w + P.t * 0.55, cy = y + h - P.t / 2;
      s += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(P.t * 0.6).toFixed(2)}" fill="${c.dp ? on : 'var(--seg-ghost)'}"/>`;
    }
    if (c.colon) {
      const cx = x + i * pitch + P.w + P.t * 0.9 + h * 0.05;
      s += `<circle cx="${(cx + h * 0.06).toFixed(2)}" cy="${(y + h * 0.3).toFixed(2)}" r="${(P.t * 0.55).toFixed(2)}" fill="${on}"/>`;
      s += `<circle cx="${cx.toFixed(2)}" cy="${(y + h * 0.72).toFixed(2)}" r="${(P.t * 0.55).toFixed(2)}" fill="${on}"/>`;
    }
  });
  return s;
}

// ---- 14-segment alphanumerics (bottom message line) ----
const S14 = {
  A: 'A B C E F G1 G2', B: 'A B C D I L G2', C: 'A D E F', D: 'A B C D I L', E: 'A D E F G1 G2', F: 'A E F G1',
  G: 'A C D E F G2', H: 'B C E F G1 G2', I: 'A D I L', J: 'B C D E', K: 'E F G1 J M', L: 'D E F',
  M: 'B C E F H J', N: 'B C E F H M', O: 'A B C D E F', P: 'A B E F G1 G2', Q: 'A B C D E F M',
  R: 'A B E F G1 G2 M', S: 'A C D F G1 G2', T: 'A I L', U: 'B C D E F', V: 'E F K J', W: 'B C E F K M',
  X: 'H J K M', Y: 'H J L', Z: 'A D J K',
  '0': 'A B C D E F J K', '1': 'B C J', '2': 'A B D E G1 G2', '3': 'A B C D G2', '4': 'B C F G1 G2',
  '5': 'A C D F G1 G2', '6': 'A C D E F G1 G2', '7': 'A B C', '8': 'A B C D E F G1 G2', '9': 'A B C D F G1 G2',
  '-': 'G1 G2', '_': 'D', '/': 'J K', '+': 'G1 G2 I L', '*': 'G1 G2 H I J K L M', '%': 'C F J K G1 G2',
  '<': 'J M', '>': 'H K', '=': 'D G1 G2', "'": 'I', ' ': '',
};

function seg14Lines(x0, y0, h) {
  const w = h * 0.6, t = h * 0.1, m = t * 0.95, g = t * 0.55, c = h / 2, cx = w / 2;
  const L = (xa, ya, xb, yb) => [xa, ya, xb, yb];
  return {
    w, t,
    A: L(m, t / 2, w - m, t / 2), D: L(m, h - t / 2, w - m, h - t / 2),
    F: L(t / 2, m, t / 2, c - g), B: L(w - t / 2, m, w - t / 2, c - g),
    E: L(t / 2, c + g, t / 2, h - m), C: L(w - t / 2, c + g, w - t / 2, h - m),
    G1: L(m, c, cx - g, c), G2: L(cx + g, c, w - m, c),
    I: L(cx, m + t * 0.3, cx, c - g), L: L(cx, c + g, cx, h - m - t * 0.3),
    H: L(t * 1.6, t * 1.6, cx - t * 0.8, c - t * 0.9), J: L(w - t * 1.6, t * 1.6, cx + t * 0.8, c - t * 0.9),
    K: L(cx - t * 0.8, c + t * 0.9, t * 1.6, h - t * 1.6), M: L(cx + t * 0.8, c + t * 0.9, w - t * 1.6, h - t * 1.6),
  };
}

export function draw14(x, y, h, str, o = {}) {
  const pitch = o.pitch || h * 0.78;
  const cs = cells(String(str).toUpperCase());
  const on = o.on || 'var(--seg-on)';
  let s = '';
  cs.forEach((c, i) => {
    const x0 = x + i * pitch;
    const G = seg14Lines(x0, y, h);
    const lit = (S14[c.ch] ?? '').split(' ').filter(Boolean);
    const segs = o.ghost ? Object.keys(G).filter(k => k !== 'w' && k !== 't') : lit;
    for (const k of segs) {
      const [xa, ya, xb, yb] = G[k];
      const a = sk(xa, ya, x0, y, h).split(','), b = sk(xb, yb, x0, y, h).split(',');
      s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${lit.includes(k) ? on : 'var(--seg-ghost)'}" stroke-width="${G.t.toFixed(2)}" stroke-linecap="round"/>`;
    }
    if (c.dp) {
      s += `<circle cx="${(x0 + G.w + G.t).toFixed(2)}" cy="${(y + h - G.t / 2).toFixed(2)}" r="${(G.t * 0.6).toFixed(2)}" fill="${on}"/>`;
    }
  });
  return s;
}

// Small helpers used by several LCDs ----------------------------------------------------------

export function heart(x, y, s, on) {
  return `<path transform="translate(${x},${y}) scale(${s})" d="M0 3 C0 -1 5 -1 5 2.5 C5 -1 10 -1 10 3 C10 6 6 8 5 10 C4 8 0 6 0 3Z" fill="${on ? 'var(--seg-on)' : 'var(--seg-ghost)'}"/>`;
}

export function fan(x, y, r, angle, on) {
  if (!on) return '';
  let s = `<g transform="translate(${x},${y}) rotate(${angle.toFixed(1)})" fill="var(--seg-on)">`;
  for (let i = 0; i < 4; i++) {
    s += `<path transform="rotate(${i * 90})" d="M0 0 C ${r * 0.2} ${-r * 0.5} ${r * 0.85} ${-r * 0.6} ${r} ${-r * 0.15} Z"/>`;
  }
  return s + `<circle r="${r * 0.18}"/></g>`;
}

export function battery(x, y, w, h, level, on = true) {
  const col = on ? 'var(--seg-on)' : 'var(--seg-ghost)';
  let s = `<rect x="${x + 2}" y="${y}" width="${w - 2}" height="${h}" fill="none" stroke="${col}" stroke-width="1.4"/>`;
  s += `<rect x="${x}" y="${y + h * 0.3}" width="2" height="${h * 0.4}" fill="${col}"/>`;
  const bars = 3;
  const bw = (w - 6) / bars;
  for (let i = 0; i < bars; i++) {
    if (i < level) s += `<rect x="${(x + w - 2 - (i + 1) * bw).toFixed(1)}" y="${y + 2}" width="${(bw - 1).toFixed(1)}" height="${h - 4}" fill="${col}"/>`;
  }
  return s;
}

export function text(x, y, size, str, o = {}) {
  const fill = o.fill || 'var(--seg-on)';
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${o.font || 'Inter, Arial, sans-serif'}" font-weight="${o.weight || 700}" ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.italic ? 'font-style="italic"' : ''}>${str}</text>`;
}
