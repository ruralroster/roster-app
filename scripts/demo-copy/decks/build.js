// Builds the Rstar and DR Roster staff feature decks.
const pptxgen = require('pptxgenjs');
const React = require('react');
const RDS = require('react-dom/server');
const sharp = require('sharp');
const fs = require('fs');
const Md = require('react-icons/md');
const { applyTheme } = require('./apply_theme');

const W = 10, X0 = 0.5, FULL = 9, Y0 = 1.3, YMAX = 5.0;
// Content width: the full slide, or what's left beside a screenshot.
let CW = FULL;
const GREY = '4B5563', MUTED = '6B7280', INK = '1F2937';

const iconCache = {};
async function icon(name, hex) {
  const key = name + hex;
  if (!iconCache[key]) {
    const Comp = Md[name] || Md.MdCircle;
    const svg = RDS.renderToStaticMarkup(React.createElement(Comp, { color: '#' + hex, size: 256 }));
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    iconCache[key] = 'image/png;base64,' + buf.toString('base64');
  }
  return iconCache[key];
}

async function build(spec, file) {
  const P = spec.palette; // dark, primary, accent, light, soft
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  pres.title = spec.name;
  pres.author = 'Rural Roster';
  const THEME = {
    name: spec.name,
    headFontFace: 'Calibri',
    bodyFontFace: 'Calibri',
    colors: {
      dk1: INK, lt1: 'FFFFFF', dk2: P.dark, lt2: P.light,
      accent1: P.primary, accent2: P.accent, accent3: '22C55E', accent4: 'EF4444', accent5: '8B5CF6', accent6: MUTED,
      hlink: P.primary, folHlink: P.dark,
    },
  };
  pres.theme = { headFontFace: 'Calibri', bodyFontFace: 'Calibri' };

  pres.defineSlideMaster({
    title: 'TITLE', background: { color: P.dark },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 1.55, w: 8.6, h: 1.2, fontSize: 48, bold: true, color: 'FFFFFF', valign: 'bottom', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 2.9, w: 8.6, h: 1.0, fontSize: 20, color: P.soft, valign: 'top', margin: 0 }, text: '' } },
    ],
  });
  pres.defineSlideMaster({
    title: 'DIVIDER', background: { color: P.primary },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 1.8, w: 8.6, h: 1.0, fontSize: 40, bold: true, color: 'FFFFFF', valign: 'bottom', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 2.95, w: 8.6, h: 0.7, fontSize: 20, color: 'FFFFFF', valign: 'top', margin: 0 }, text: '' } },
    ],
  });
  pres.defineSlideMaster({
    title: 'CONTENT', background: { color: 'FFFFFF' },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: X0, y: 0.32, w: FULL, h: 0.75, fontSize: 32, bold: true, color: P.dark, valign: 'middle', margin: 0 }, text: '' } },
      { text: { text: spec.footer, options: { x: X0, y: 5.22, w: 5, h: 0.25, fontSize: 10, color: MUTED, margin: 0 } } },
    ],
    slideNumber: { x: 9.0, y: 5.22, w: 0.5, h: 0.25, fontSize: 10, color: MUTED, align: 'right' },
  });

  let section = null;
  for (const s of spec.slides) {
    if (s.section && s.section !== section) { section = s.section; pres.addSection({ title: section }); }
    const master = s.type === 'title' || s.type === 'closing' ? 'TITLE' : s.type === 'divider' ? 'DIVIDER' : 'CONTENT';
    const slide = pres.addSlide({ masterName: master, sectionTitle: section });
    slide.addText(s.title, { placeholder: 'title' });
    CW = FULL;
    let layout = s.type;
    if (s.shot && fs.existsSync(`shots/${s.shot}.png`)) {
      const left = await screenshot(slide, `shots/${s.shot}.png`);
      CW = left - 0.35 - X0;
      if (layout === 'flow') layout = 'steps'; // four boxes don't fit beside a phone
    }
    await LAYOUTS[layout](pres, slide, { ...s, shotted: CW < FULL }, P);
    slide.addNotes(s.notes || notesFor(s));
  }

  await pres.writeFile({ fileName: file });
  await applyTheme(file, THEME);
  console.log('wrote', file, spec.slides.length, 'slides');
}

function notesFor(s) {
  const parts = [s.title + '.'];
  if (s.sub) parts.push(s.sub);
  if (s.lead) parts.push(s.lead);
  for (const it of s.items || []) parts.push([it.h, it.t].filter(Boolean).join(': ') + '.');
  for (const side of [s.left, s.right]) if (side) parts.push(side.h + ': ' + side.items.join('; ') + '.');
  if (s.big) parts.push(s.big + ' ' + (s.bigLabel || ''));
  if (s.note) parts.push(s.note);
  return parts.join('\n');
}

const tb = (o) => ({ isTextBox: true, margin: 0, fontFace: 'Calibri', ...o });

// A screenshot in a dark device frame on the right: phone-shaped ones full
// height, laptop ones wider and centred. Returns the frame's left edge.
async function screenshot(slide, file) {
  const { width, height } = await sharp(file).metadata();
  const ratio = width / height, pad = 0.07;
  let h, w;
  if (ratio < 1) { h = YMAX + 0.05 - (Y0 - 0.1); w = h * ratio; }
  else { w = 4.5; h = w / ratio; }
  const x = X0 + FULL - w, y = ratio < 1 ? Y0 - 0.1 : Y0 + (YMAX - Y0 - h) / 2;
  slide.addShape('roundRect', { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad, fill: { color: '1F2937' }, line: { color: '1F2937' }, rectRadius: 0.12,
    shadow: { type: 'outer', color: '000000', opacity: 0.25, blur: 6, offset: 2, angle: 90 } });
  const buf = await sharp(file).resize({ width: Math.min(width, 1200) }).png().toBuffer();
  slide.addImage({ data: 'image/png;base64,' + buf.toString('base64'), x, y, w, h, altText: 'Screenshot of the app' });
  return x - pad;
}

async function iconCircle(slide, name, x, y, d, fill, fg) {
  slide.addShape('ellipse', { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill } });
  const pad = d * 0.22;
  slide.addImage({ data: await icon(name, fg), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad });
}

function lead(slide, text, y = Y0, P) {
  if (!text) return Y0;
  slide.addText(text, tb({ x: X0, y, w: CW, h: 0.55, fontSize: 16, color: GREY, valign: 'top' }));
  return y + 0.65;
}

function note(slide, text, P, y = 4.45) {
  if (!text) return;
  slide.addShape('roundRect', { x: X0, y, w: CW, h: 0.55, fill: { color: P.light }, line: { color: P.light }, rectRadius: 0.08 });
  slide.addText(text, tb({ x: X0 + 0.2, y, w: CW - 0.4, h: 0.55, fontSize: 14, color: INK, valign: 'middle' }));
}

const LAYOUTS = {
  async title(pres, slide, s) {
    slide.addText(s.sub, { placeholder: 'body' });
  },
  async divider(pres, slide, s) {
    slide.addText(s.sub, { placeholder: 'body' });
  },
  async closing(pres, slide, s, P) {
    slide.addText(s.items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < s.items.length - 1 } })),
      tb({ x: 0.7, y: 2.95, w: 8.6, h: 2.1, fontSize: 18, color: P.soft, valign: 'top', paraSpaceAfter: 6 }));
  },

  // Numbered steps down the left, a large icon on the right.
  async steps(pres, slide, s, P) {
    const y0 = lead(slide, s.lead, Y0, P);
    const n = s.items.length;
    const rowH = Math.min(0.85, (YMAX - y0) / n);
    s.items.forEach((it, i) => {
      const y = y0 + i * rowH;
      slide.addShape('ellipse', { x: X0, y: y + 0.02, w: 0.42, h: 0.42, fill: { color: P.primary }, line: { color: P.primary } });
      slide.addText(String(i + 1), tb({ x: X0, y: y + 0.02, w: 0.42, h: 0.42, fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' }));
      const tw = s.shotted ? CW - 0.6 : 6.0;
      slide.addText(it.h, tb({ x: X0 + 0.6, y, w: tw, h: 0.3, fontSize: 16, bold: true, color: INK, valign: 'top' }));
      slide.addText(it.t, tb({ x: X0 + 0.6, y: y + 0.3, w: tw, h: rowH - 0.32, fontSize: 14, color: GREY, valign: 'top' }));
    });
    if (!s.shotted) await iconCircle(slide, s.icon || 'MdCheckCircle', 7.45, 1.75, 2.0, P.light, P.primary);
  },

  // A grid of cards, each with an icon, heading and a line of text.
  async cards(pres, slide, s, P) {
    const y0 = lead(slide, s.lead, Y0, P);
    const n = s.items.length;
    const cols = s.cols || (s.shotted ? (n <= 4 ? 1 : 2) : n <= 3 ? n : n === 4 ? 2 : 3);
    const rows = Math.ceil(n / cols);
    const gap = s.shotted ? 0.2 : 0.3;
    const cw = (CW - gap * (cols - 1)) / cols;
    const ch = Math.min(2.4, (YMAX - y0 - gap * (rows - 1)) / rows);
    for (let i = 0; i < n; i++) {
      const it = s.items[i];
      const x = X0 + (i % cols) * (cw + gap);
      const y = y0 + Math.floor(i / cols) * (ch + gap);
      slide.addShape('roundRect', { x, y, w: cw, h: ch, fill: { color: P.light }, line: { color: P.light }, rectRadius: 0.1 });
      if (cols <= 2) {
        // Icon left, text right.
        const d = Math.min(0.55, ch - 0.3);
        await iconCircle(slide, it.icon, x + 0.2, y + 0.15, d, P.primary, 'FFFFFF');
        slide.addText(it.h, tb({ x: x + 0.4 + d, y: y + 0.12, w: cw - 0.55 - d, h: 0.3, fontSize: 16, bold: true, color: INK }));
        slide.addText(it.t, tb({ x: x + 0.4 + d, y: y + 0.44, w: cw - 0.55 - d, h: ch - 0.5, fontSize: 14, color: GREY, valign: 'top' }));
      } else {
        await iconCircle(slide, it.icon, x + 0.2, y + 0.18, 0.5, P.primary, 'FFFFFF');
        slide.addText(it.h, tb({ x: x + 0.85, y: y + 0.16, w: cw - 1.0, h: 0.56, fontSize: 16, bold: true, color: INK, valign: 'middle' }));
        slide.addText(it.t, tb({ x: x + 0.2, y: y + 0.8, w: cw - 0.4, h: ch - 0.9, fontSize: 14, color: GREY, valign: 'top' }));
      }
    }
  },

  // Two side-by-side panels, each with an icon, heading and bullets.
  async twoCol(pres, slide, s, P) {
    const y0 = lead(slide, s.lead, Y0, P);
    const stack = CW < 5.5, gap = stack ? 0.2 : 0.4;
    const cw = stack ? CW : (CW - gap) / 2, ch = stack ? (YMAX - y0 - gap) / 2 : YMAX - y0;
    const small = s.shotted;
    for (const [i, side] of [s.left, s.right].entries()) {
      const x = stack ? X0 : X0 + i * (cw + gap), y = stack ? y0 + i * (ch + gap) : y0;
      const dark = i === 0, d = small ? 0.5 : 0.6;
      slide.addShape('roundRect', { x, y, w: cw, h: ch, fill: { color: dark ? P.dark : P.light }, line: { color: dark ? P.dark : P.light }, rectRadius: 0.1 });
      await iconCircle(slide, side.icon, x + 0.25, y + 0.2, d, dark ? P.accent : P.primary, 'FFFFFF');
      slide.addText(side.h, tb({ x: x + 0.4 + d, y: y + 0.15, w: cw - 0.6 - d, h: Math.max(d, 0.62), fontSize: small ? 17 : 20, bold: true, color: dark ? 'FFFFFF' : INK, valign: 'middle' }));
      slide.addText(side.items.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < side.items.length - 1 } })),
        tb({ x: x + 0.25, y: y + d + 0.28, w: cw - 0.5, h: ch - d - 0.33, fontSize: small ? 14 : 15, color: dark ? 'FFFFFF' : INK, valign: 'top', paraSpaceAfter: small ? 4 : 8 }));
    }
  },

  // Colour swatches with what each means, as in the app.
  async swatches(pres, slide, s, P) {
    const n = s.items.length;
    // A long key beside a laptop screenshot needs the lead's room.
    const y0 = lead(slide, s.shotted && CW < 6 && n > 5 ? null : s.lead, Y0, P);
    const twoCols = n > 4 && CW >= 6;
    const perCol = twoCols ? Math.ceil(n / 2) : n;
    const colW = twoCols ? (CW - 0.4) / 2 : Math.min(5.6, CW);
    const rowH = Math.min(0.8, (YMAX - y0) / perCol);
    s.items.forEach((it, i) => {
      const col = twoCols ? Math.floor(i / perCol) : 0;
      const x = X0 + col * (colW + 0.4);
      const y = y0 + (i % perCol) * rowH;
      const sq = 0.5;
      const colors = it.colors || [it.color];
      const border = { color: it.border || colors[0], width: 1 };
      if (colors.length === 1) {
        slide.addShape('roundRect', { x, y, w: sq, h: sq, fill: { color: colors[0] }, line: border, rectRadius: 0.06 });
      } else {
        colors.forEach((c, k) => slide.addShape('rect', { x: x + (k * sq) / colors.length, y, w: sq / colors.length, h: sq, fill: { color: c }, line: { color: c } }));
      }
      if (it.strike) slide.addShape('line', { x: x + 0.05, y: y + sq / 2, w: sq - 0.1, h: 0, line: { color: '6B7280', width: 1.5 } });
      if (it.mark) slide.addText(it.mark, tb({ x, y, w: sq, h: sq, fontSize: 12, bold: true, color: it.markColor || 'FFFFFF', align: 'center', valign: 'middle' }));
      slide.addText(it.h, tb({ x: x + 0.7, y: y - 0.02, w: colW - 0.75, h: 0.28, fontSize: 16, bold: true, color: INK }));
      slide.addText(it.t, tb({ x: x + 0.7, y: y + 0.27, w: colW - 0.75, h: rowH - 0.3, fontSize: 14, color: GREY, valign: 'top' }));
    });
    if (!twoCols && s.side && !s.shotted) {
      slide.addShape('roundRect', { x: 6.6, y: y0, w: 2.9, h: YMAX - y0, fill: { color: P.dark }, line: { color: P.dark }, rectRadius: 0.1 });
      await iconCircle(slide, s.sideIcon || 'MdInfoOutline', 6.85, y0 + 0.25, 0.55, P.accent, 'FFFFFF');
      slide.addText(s.side, tb({ x: 6.85, y: y0 + 1.0, w: 2.4, h: YMAX - y0 - 1.2, fontSize: 15, color: 'FFFFFF', valign: 'top' }));
    }
  },

  // Left-to-right process with arrows.
  async flow(pres, slide, s, P) {
    const y0 = lead(slide, s.lead, Y0, P) + 0.1;
    const n = s.items.length, arrow = 0.35;
    const bw = (CW - arrow * (n - 1)) / n, bh = YMAX - y0 - (s.note ? 0.75 : 0);
    for (let i = 0; i < n; i++) {
      const it = s.items[i];
      const x = X0 + i * (bw + arrow);
      const last = i === n - 1;
      slide.addShape('roundRect', { x, y: y0, w: bw, h: bh, fill: { color: last ? P.dark : P.light }, line: { color: last ? P.dark : P.light }, rectRadius: 0.1 });
      await iconCircle(slide, it.icon, x + 0.2, y0 + 0.2, 0.55, last ? P.accent : P.primary, 'FFFFFF');
      slide.addText(it.h, tb({ x: x + 0.2, y: y0 + 0.88, w: bw - 0.4, h: 0.8, fontSize: 16, bold: true, color: last ? 'FFFFFF' : INK, valign: 'top' }));
      slide.addText(it.t, tb({ x: x + 0.2, y: y0 + 1.7, w: bw - 0.4, h: bh - 1.8, fontSize: 14, color: last ? 'E5E7EB' : GREY, valign: 'top' }));
      if (!last) slide.addShape('rightArrow', { x: x + bw + 0.06, y: y0 + bh / 2 - 0.15, w: arrow - 0.12, h: 0.3, fill: { color: P.accent }, line: { color: P.accent } });
    }
    note(slide, s.note, P, y0 + bh + 0.2);
  },

  // Big numbers with labels.
  async stats(pres, slide, s, P) {
    const y0 = lead(slide, s.lead, Y0, P) + 0.1;
    const n = s.items.length, gap = 0.3;
    const cw = (CW - gap * (n - 1)) / n, ch = YMAX - y0 - (s.note ? 0.75 : 0);
    s.items.forEach((it, i) => {
      const x = X0 + i * (cw + gap);
      slide.addShape('roundRect', { x, y: y0, w: cw, h: ch, fill: { color: P.light }, line: { color: P.light }, rectRadius: 0.1 });
      const narrow = cw < 2.6, band = narrow ? 0.7 : 0.95;
      slide.addText(it.h, tb({ x: x + 0.2, y: y0 + 0.2, w: cw - 0.4, h: band, fontSize: narrow ? (it.h.length > 4 ? 26 : 36) : it.h.length > 4 ? 36 : 48, bold: true, color: P.primary, valign: 'middle' }));
      slide.addText(it.t, tb({ x: x + 0.2, y: y0 + band + 0.3, w: cw - 0.4, h: ch - band - 0.4, fontSize: narrow ? 14 : 15, color: INK, valign: 'top' }));
    });
    note(slide, s.note, P, y0 + ch + 0.2);
  },

  // A big stat panel on the left, numbered steps on the right.
  async statSteps(pres, slide, s, P) {
    const pw = s.shotted ? 2.2 : 3.0;
    slide.addShape('roundRect', { x: X0, y: Y0, w: pw, h: YMAX - Y0, fill: { color: P.dark }, line: { color: P.dark }, rectRadius: 0.1 });
    slide.addText(s.big, tb({ x: X0 + 0.3, y: Y0 + 0.4, w: pw - 0.6, h: 1.2, fontSize: s.shotted ? 36 : 44, bold: true, color: P.accent, valign: 'middle' }));
    slide.addText(s.bigLabel, tb({ x: X0 + 0.3, y: Y0 + (s.shotted ? 1.5 : 1.75), w: pw - 0.6, h: s.shotted ? 2.05 : 1.8, fontSize: s.shotted ? 15 : 16, color: 'FFFFFF', valign: 'top' }));
    const x0 = X0 + pw + 0.4, tw = CW - pw - 0.4 - 0.6;
    const rowH = Math.min(0.9, (YMAX - Y0) / s.items.length);
    s.items.forEach((it, i) => {
      const y = Y0 + i * rowH;
      slide.addShape('ellipse', { x: x0, y: y + 0.02, w: 0.42, h: 0.42, fill: { color: P.primary }, line: { color: P.primary } });
      slide.addText(String(i + 1), tb({ x: x0, y: y + 0.02, w: 0.42, h: 0.42, fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' }));
      slide.addText(it.h, tb({ x: x0 + 0.6, y, w: tw, h: 0.3, fontSize: 16, bold: true, color: INK }));
      slide.addText(it.t, tb({ x: x0 + 0.6, y: y + 0.3, w: tw, h: rowH - 0.32, fontSize: 14, color: GREY, valign: 'top' }));
    });
  },

  // A simple two-column table.
  async table(pres, slide, s, P) {
    const y0 = lead(slide, s.lead, Y0, P);
    const head = s.head.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: P.primary } } }));
    const rows = s.rows.map((r, i) => r.map(c => ({ text: c, options: { color: INK, fill: { color: i % 2 ? 'FFFFFF' : P.light } } })));
    slide.addTable([head, ...rows], { x: X0, y: y0, w: CW, colW: s.colW && !s.shotted ? s.colW : [CW / 2, CW / 2], fontSize: 14, fontFace: 'Calibri', rowH: 0.42, valign: 'middle', margin: [0.04, 0.12, 0.04, 0.12], border: { type: 'solid', pt: 0.5, color: 'E5E7EB' } });
    note(slide, s.note, P, y0 + 0.42 * (rows.length + 1) + 0.2);
  },

  // Your list on the left, a mock Crossover week on the right.
  async crossover(pres, slide, s, P) {
    slide.addText(s.items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < s.items.length - 1 } })),
      tb({ x: X0, y: Y0, w: 4.6, h: YMAX - Y0, fontSize: 16, color: INK, valign: 'top', paraSpaceAfter: 10 }));
    const gx = 5.5, gy = 1.55, cw = 0.55, gap = 0.04;
    slide.addShape('roundRect', { x: gx - 0.25, y: Y0, w: 4.25, h: 3.0, fill: { color: P.light }, line: { color: P.light }, rectRadius: 0.1 });
    slide.addText('Crossover: you and Sam', tb({ x: gx, y: gy - 0.05, w: 3.8, h: 0.3, fontSize: 14, bold: true, color: INK }));
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const state = ['work', 'work', '', 'off', 'work', 'off', ''];
    days.forEach((d, i) => {
      const x = gx + i * (cw + gap);
      slide.addText(d, tb({ x, y: gy + 0.4, w: cw, h: 0.25, fontSize: 11, color: MUTED, align: 'center' }));
      const fill = state[i] === 'work' ? '22C55E' : state[i] === 'off' ? 'D1D5DB' : 'FFFFFF';
      slide.addShape('roundRect', { x, y: gy + 0.7, w: cw, h: 0.75, fill: { color: fill }, line: { color: state[i] ? fill : 'D1D5DB' }, rectRadius: 0.05 });
      if (state[i]) slide.addText(state[i] === 'work' ? 'Work' : 'Off', tb({ x, y: gy + 0.7, w: cw, h: 0.75, fontSize: 11, bold: true, color: state[i] === 'work' ? 'FFFFFF' : INK, align: 'center', valign: 'middle' }));
    });
    slide.addText('Work: you\'re both rostered. Off: neither of you is. Blank: one of you is working.', tb({ x: gx, y: gy + 1.65, w: 3.8, h: 0.7, fontSize: 12, color: GREY, valign: 'top' }));
  },
};

// ---------- Rstar ----------
const rostar = {
  name: 'Rstar: staff feature tour',
  footer: 'Rstar · feature tour',
  palette: { dark: '0F3D3E', primary: '0F766E', accent: 'F59E0B', light: 'E6F2F0', soft: 'A7D7CF' },
  slides: [
    { type: 'title', section: 'Welcome', title: 'Rstar', sub: 'Your roster, on your phone · a quick tour for staff' },
    { type: 'cards', section: 'Welcome', title: "What's in Rstar", items: [
      { icon: 'MdToday', h: 'Day & Week', t: "Your shifts, and who's on with you" },
      { icon: 'MdPhone', h: 'Phone Book', t: 'On-call roster and tap-to-call numbers' },
      { icon: 'MdSwapHoriz', h: 'Variation', t: 'Pick up a shift, swap one, or call in sick' },
      { icon: 'MdLocalCafe', h: 'Coffee', t: 'The morning order, sorted for you' },
      { icon: 'MdEventAvailable', h: 'Availability', t: "Mark the days you can't work" },
      { icon: 'MdNotificationsActive', h: 'Notifications', t: 'Email, and phone alerts if you want them' },
    ] },
    { type: 'steps', section: 'Getting started', title: 'Getting started', icon: 'MdPhoneIphone', items: [
      { h: 'Accept your invite', t: 'Set your password from the email link, or use the one-time password your officer gives you' },
      { h: 'Install Rstar', t: 'Add it to your home screen so it opens like an app' },
      { h: 'Check your profile', t: 'Settings → Profile: your phone and email (your email is also your sign-in)' },
      { h: 'Two-factor (optional)', t: 'Settings → Security → Turn on, then scan the QR code with an authenticator app' },
    ] },
    { type: 'twoCol', section: 'Getting started', title: 'Install it on your phone',
      left: { icon: 'MdPhoneIphone', h: 'iPhone', items: ['Open Rstar in Safari', 'Tap Share', 'Tap Add to Home Screen', 'Needed for phone notifications'] },
      right: { icon: 'MdAndroid', h: 'Android', items: ['Open Rstar in Chrome', 'Tap Install App on the sign-in screen', 'Or menu → Add to Home screen', 'It appears as Rstar'] } },
    { type: 'steps', section: 'Your roster', title: 'Your day and week', icon: 'MdViewWeek', items: [
      { h: 'Day', t: "Your allocation first, then who's on in the Morning, Afternoon and Night" },
      { h: 'Week', t: 'Monday to Sunday, one card per day' },
      { h: 'Jump to a date', t: 'Use the arrows, or type a date in the box beside them' },
      { h: "Who's with you", t: "Tap the arrow on your allocation to see who's at your location" },
    ] },
    { type: 'crossover', section: 'Your roster', title: 'Starred colleagues and Crossover', items: [
      'Search for a colleague, open their card, tap the star (up to 10)',
      'Starred names appear on your Week tab',
      'Crossover compares your weeks side by side',
      "It never shows anyone's leave or the reason",
    ] },
    { type: 'twoCol', section: 'Your roster', title: 'Phone Book and calendar export',
      left: { icon: 'MdPhone', h: 'Phone Book', items: ["This week's on-call, by type", 'Tap a name to call or email', 'Useful numbers your officer adds'] },
      right: { icon: 'MdFileDownload', h: 'Export', items: ['Lists weeks with your shifts (up to 26)', 'Tick the weeks you want', 'Open the .ics file to add shifts and on-call to your calendar'] } },
    { type: 'swatches', section: 'Settings', title: 'Set your availability', lead: 'Settings → Availability. Tap a day to cycle through the colours.',
      side: "New accounts start available every day, so you only mark the days you can't work.", sideIcon: 'MdEventAvailable',
      items: [
        { color: 'F3F4F6', border: 'D1D5DB', h: 'Not set', t: 'Tap to start' },
        { color: '22C55E', h: 'Available', t: 'Can be rostered and offered shifts' },
        { color: 'EF4444', h: 'Unavailable', t: 'Leave or a day off; DR Roster can still offer you a shift' },
        { color: '4B5563', h: 'Working elsewhere', t: 'Unavailable here, and DR Roster offers you nothing' },
      ] },
    { type: 'flow', section: 'Variation', title: 'Pick up an extra shift', items: [
      { icon: 'MdCampaign', h: 'Officer offers a gap', t: "You're emailed if you can do it" },
      { icon: 'MdCalendarMonth', h: 'Available Shifts', t: 'Purple days to volunteer, amber for a swap' },
      { icon: 'MdPanTool', h: 'Volunteer', t: 'One tap puts your hand up' },
      { icon: 'MdCheckCircle', h: 'Officer accepts', t: "You're booked onto the roster" },
    ], note: 'Eligible = senior enough, holding any required skill, not restricted, and marked available that day.' },
    { type: 'statSteps', section: 'Variation', title: 'Swap a shift, one for one', big: '1 for 1', bigLabel: "A swap never lowers anyone's shift count or FTE. Needs a DR Roster account.", items: [
      { h: 'Offer for swap', t: 'Variation → Swap a shift, last on the tab (tap to open)' },
      { h: 'Say when you could work', t: 'Tick at least one day or night that pay fortnight' },
      { h: 'Widen the pool (optional)', t: "Tick I'd take a shift in return at another site" },
      { h: 'Officer approves', t: 'Bookings swap over. Until then, you still work it' },
    ] },
    { type: 'steps', section: 'Variation', title: 'Calling in sick', icon: 'MdHealing', items: [
      { h: 'Notify Sick', t: 'Under My Variations, when you have a shift today' },
      { h: 'Check the message', t: 'It is pre-filled; edit it if you like. It shows who will get it' },
      { h: "Who's told", t: "Officers, the ED on-call now, and tomorrow's 08:00 ED consultant" },
      { h: "It's a pop-up, not a text", t: "They see it when they next open the app. Phone the on-call if it's urgent" },
    ] },
    { type: 'stats', section: 'Coffee', title: 'Coffee, sorted', lead: 'Set your order once in Settings → Coffee Preferences. Tap Coffee to check today\'s list, then Text order.', items: [
      { h: '8:15', t: 'On-call nudged if anyone has no order' },
      { h: '9:00', t: 'Order emailed to the ED late consultant' },
      { h: '10:25', t: 'Pick up, or delivery at 10:30' },
    ], note: 'Untick anyone not having one, or add a locum or visitor. Changes are shared for today only.' },
    { type: 'table', section: 'Settings', title: "What you'll be told", lead: 'Phone alerts: Settings → Notifications → Send me a test. On iPhone, open Rstar from the Home Screen.', head: ['When', 'Who hears'], rows: [
      ['A shift you can do is offered', 'Staff who could take it'],
      ['Someone volunteers', 'Officers'],
      ['Someone calls in sick', 'Officers and the ED on-call (pop-up)'],
      ['The morning coffee order', 'The ED late consultant, 9:00'],
      ['A swap is offered or decided', 'The doctors and officers involved'],
    ] },
    { type: 'steps', section: 'Variation', title: 'Callbacks and overtime', icon: 'MdTimer', items: [
      { h: 'Callback or Overtime', t: "Buttons appear while you're on call, and from 30 min before your shift ends to 4 h after" },
      { h: 'A timer that keeps going', t: "Saved on the server, so it runs if you close the app. Tap Complete when you're done" },
      { h: 'Patient details stay with you', t: 'An MRN or name only downloads to your phone; the app never stores it' },
      { h: 'My Variations', t: 'Your list for the payroll form: fix a time, download, delete once submitted' },
    ] },
    { type: 'cards', section: 'Settings', title: 'Your Settings', lead: 'Everything about you is under Settings, one tab each.', items: [
      { icon: 'MdPerson', h: 'Profile', t: 'Phone and email (your sign-in)' },
      { icon: 'MdBlock', h: 'Activity Restrictions', t: "Activities you can't or won't do" },
      { icon: 'MdLocalCafe', h: 'Coffee Preferences', t: 'Your usual order, or No Coffee' },
      { icon: 'MdEventAvailable', h: 'Availability', t: 'Tap a day to cycle its colour' },
      { icon: 'MdNotificationsActive', h: 'Notifications', t: 'Phone alerts on this device, and a test' },
      { icon: 'MdLock', h: 'Security', t: 'Password and two-factor' },
    ] },
    { type: 'twoCol', section: 'Settings', title: 'Restrictions and skills',
      left: { icon: 'MdBlock', h: 'Restrictions (you)', items: ['Settings → Activity Restrictions', "Opt out of activities you can't or won't do", "You're not offered those shifts"] },
      right: { icon: 'MdVerifiedUser', h: 'Skills (your officer)', items: ['e.g. Anaesthetics, Obstetrics, Endoscopy', 'Shifts needing one go only to people who hold it', "Missing a shift you'd expect? Ask your officer"] } },
    { type: 'steps', section: 'Settings', title: 'Security and two-factor', icon: 'MdLock', items: [
      { h: 'Change your password', t: 'Settings → Security, any time' },
      { h: 'Turn on two-factor', t: 'Scan the QR code with an authenticator app, enter the 6-digit code, Verify & enable' },
      { h: 'One login, both apps', t: 'The same sign-in and two-factor work in DR Roster' },
      { h: 'Lost that phone?', t: 'The administrator clears two-factor; your officer can give a one-time password' },
    ] },
    { type: 'divider', section: 'For officers', title: 'For officers', sub: 'Build the week, offer the gaps, let the district cover the rest' },
    { type: 'swatches', section: 'For officers', title: 'Calendar coverage colours', lead: 'Four weeks at a time. Tap any day to open it.', items: [
      { color: '22C55E', h: 'Green', t: 'Fully covered' },
      { color: 'F97316', h: 'Orange', t: 'On-call short (letters say which)', mark: 'A/O' },
      { color: 'EF4444', h: 'Red', t: 'Required job empty, not offered' },
      { color: '3B82F6', h: 'Blue', t: 'Offered, nobody yet' },
      { color: '8B5CF6', h: 'Purple', t: 'A volunteer is waiting for you' },
      { color: 'E5E7EB', h: 'Grey', t: 'Nothing required that day' },
    ] },
    { type: 'twoCol', section: 'For officers', title: 'The Planner in two steps',
      left: { icon: 'MdViewModule', h: '1 · Lay out jobs', items: ['Tap + on each day a job runs', 'Save as a template'] },
      right: { icon: 'MdPersonAdd', h: '2 · Fill places', items: ['Pick a person; places go green', 'Numbers: their best jobs, 1 first'] } },
    { type: 'flow', section: 'For officers', title: 'Offer a gap, get it filled', items: [
      { icon: 'MdCampaign', h: 'Offer', t: 'Offer senior or any grade; the day turns blue' },
      { icon: 'MdPanTool', h: 'Volunteers', t: 'The day turns purple' },
      { icon: 'MdCheckCircle', h: 'Accept', t: 'Booked; the day goes green' },
      { icon: 'MdTravelExplore', h: 'Nobody local?', t: 'After 72 hours it goes to DR Roster' },
    ], note: 'A district doctor approved on DR Roster lands on your card by themselves, marked From DR Roster.' },
    { type: 'cards', section: 'For officers', title: 'More officer tools', items: [
      { icon: 'MdUploadFile', h: 'Excel import', t: 'Dry run, then write week by week' },
      { icon: 'MdPayments', h: 'Payroll export', t: 'Any fortnight as an Excel file' },
      { icon: 'MdHealing', h: 'Sick calls', t: 'Approve or deny from Day view' },
      { icon: 'MdManageAccounts', h: 'Staff accounts', t: 'Invite, resend, one-time passwords' },
      { icon: 'MdVerifiedUser', h: 'Ranks & skills', t: 'Decide who is offered what' },
      { icon: 'MdAssessment', h: 'Reports', t: 'Case mix, fairness, rule violations' },
    ] },
    { type: 'steps', section: 'For officers', title: 'Marking a service disruption', icon: 'MdReportProblem', items: [
      { h: 'Offer the gap', t: 'From the Planner, Calendar or Day view' },
      { h: 'Tick Service disruption', t: 'Unfilled means the service closes' },
      { h: 'Staff see it flagged', t: 'On their Available shifts, and in the email and phone alert' },
      { h: 'It travels with the shift', t: 'Marked the same in DR Roster' },
    ] },
    { type: 'cards', section: 'For officers', title: 'Day-to-day officer tools', items: [
      { icon: 'MdHealing', h: 'Sick calls', t: 'Approve or deny from the red banner on Day view' },
      { icon: 'MdPanTool', h: 'Volunteering panel', t: 'Open offers, and unfilled gaps for 30 days' },
      { icon: 'MdPhoneInTalk', h: 'On-call slots', t: 'Pick a name for each, under every day' },
      { icon: 'MdContentCopy', h: 'Copy a week', t: 'Any Monday onto any other' },
      { icon: 'MdPayments', h: 'Payroll export', t: 'Any fortnight as an Excel file' },
      { icon: 'MdFileDownload', h: 'Excel export', t: 'The roster back out as a spreadsheet' },
    ] },
    { type: 'cards', section: 'Settings', title: 'Where Settings lives', lead: "In the order you'd set up a department. My Account is your own password.", items: [
      { icon: 'MdApartment', h: 'Department', t: 'Pay centre and session times' },
      { icon: 'MdPlace', h: 'Locations & Activities', t: 'Locations, activities, Planner jobs' },
      { icon: 'MdSchedule', h: 'Shifts & Rules', t: 'Shifts, fatigue rules, on-call, leave' },
      { icon: 'MdBuild', h: 'Rostering Tools', t: 'Week templates, Excel import and export' },
      { icon: 'MdGroups', h: 'Staff & Contacts', t: 'Ranks, staff, accounts, Phone Book' },
      { icon: 'MdAssessment', h: 'Reports & Compliance', t: 'Case mix, fairness, pay, rules' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Locations, activities and jobs', icon: 'MdPlace', items: [
      { h: 'Locations', t: 'Supervision, senior-and-junior, sick-call alerts' },
      { h: 'Activities', t: 'Which run where, and any skill one needs' },
      { h: 'Jobs (Planner)', t: 'Hours and Places: role, grade, skills, minimum' },
      { h: 'Session Times', t: 'Where Morning, Afternoon and Night begin' },
    ] },
    { type: 'cards', section: 'Settings', title: 'Shifts, rules and on-call', items: [
      { icon: 'MdSchedule', h: 'Shifts', t: 'Named shifts and their hours' },
      { icon: 'MdBedtime', h: 'Shift Pattern Rules', t: 'Fatigue rules the roster is checked against' },
      { icon: 'MdPhoneInTalk', h: 'Duty Types', t: 'On-call slots: abbreviation, skill, sick-call alerts' },
      { icon: 'MdBeachAccess', h: 'Leave Types', t: 'The kinds of leave you record' },
      { icon: 'MdVerifiedUser', h: 'Advanced Skills', t: 'Anaesthetics, Obstetrics, Endoscopy…' },
    ] },
    { type: 'steps', section: 'Settings', title: "Who's offered what", icon: 'MdMilitaryTech', items: [
      { h: 'Ranks', t: 'Your own list, in order' },
      { h: 'Requires supervision', t: 'By a higher rank' },
      { h: 'Can cover senior', t: 'Sees senior offers' },
      { h: 'Skills', t: 'No skill, no offer' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Staff and accounts', icon: 'MdManageAccounts', items: [
      { h: 'Staff and Availability', t: 'Rank, FTE, email, skills and day-by-day availability' },
      { h: 'Staff Accounts', t: 'Invites, one-time passwords, officer or staff' },
      { h: 'Ready straight away', t: 'New staff start available every day, so they show in every picker' },
      { h: 'Phone Book', t: 'The Coffee Place number, and any other tap-to-call numbers' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Excel import, step by step', icon: 'MdUploadFile', items: [
      { h: 'Upload', t: 'Rostering Tools → Excel Roster Import' },
      { h: 'Check for Missing Staff', t: 'Anyone on the sheet without a record, ready to create' },
      { h: 'Dry Run, then Write to Roster', t: 'Week by week. On-call and leave are never touched' },
      { h: 'Map… once', t: 'Unknown codes are never guessed; map once' },
    ] },
    { type: 'cards', section: 'Settings', title: 'Reports and compliance', items: [
      { icon: 'MdPieChart', h: 'Case Mix', t: 'Who did what, over 12 months' },
      { icon: 'MdBalance', h: 'Fairness', t: 'Share of on-call and weekends' },
      { icon: 'MdTimer', h: 'Pay Variations', t: 'Callback and overtime times' },
      { icon: 'MdGavel', h: 'Rule Violations', t: 'ED rules over any dates' },
    ] },
    // ----- Staff: Variation, item by item in the order the tab shows them.
    { type: 'cards', section: 'Variation', title: 'Variation at a glance', lead: 'Everything that changes your day from the roster, top to bottom.', items: [
      { icon: 'MdPhoneInTalk', h: 'Callback', t: "While you're on call" },
      { icon: 'MdMoreTime', h: 'Overtime', t: 'When your shift runs over' },
      { icon: 'MdListAlt', h: 'My Variations', t: 'Your list for the payroll form' },
      { icon: 'MdHealing', h: 'Notify Sick', t: "Can't make a shift today" },
      { icon: 'MdCalendarMonth', h: 'Available Shifts', t: 'Volunteer, or take a swap' },
      { icon: 'MdSwapHoriz', h: 'Swap a shift', t: 'Offer one of yours' },
    ] },
    { type: 'steps', section: 'Variation', title: 'Callbacks while on call', icon: 'MdPhoneInTalk', items: [
      { h: 'A button per on-call slot', t: "Only while you're on call" },
      { h: 'Tap it when called in', t: 'The timer starts' },
      { h: 'Two slots at once?', t: 'Two buttons: pick the right one' },
      { h: 'Nothing to fill in', t: 'Date and slot are set for you' },
    ] },
    { type: 'steps', section: 'Variation', title: 'The callback timer', icon: 'MdTimer', items: [
      { h: 'It keeps running', t: 'Saved on the server; close the app' },
      { h: 'Call Complete', t: "Tap it when you're done" },
      { h: 'Under 15 minutes?', t: 'It asks: record it or not' },
      { h: 'Longer', t: 'Recorded by itself' },
    ] },
    { type: 'steps', section: 'Variation', title: 'Saving a patient detail', icon: 'MdNoteAdd', items: [
      { h: 'Optional', t: 'An MRN, or last and first name' },
      { h: 'Download to phone', t: 'A text file, on your phone only' },
      { h: 'Never stored', t: 'The app keeps times, not patients' },
      { h: 'Or Skip', t: 'The callback is still recorded' },
    ] },
    { type: 'steps', section: 'Variation', title: 'The fatigue notice', icon: 'MdBedtime', items: [
      { h: 'Shown for 10 seconds', t: 'After every callback or overtime' },
      { h: '10 hours after you finished', t: "Don't come back before this time" },
      { h: 'Plan the morning', t: 'Tell your officer if it clashes' },
      { h: 'Then it closes', t: 'The callback is in My Variations' },
    ] },
    { type: 'steps', section: 'Variation', title: 'Overtime', icon: 'MdMoreTime', items: [
      { h: 'Overtime button', t: '30 min before your shift ends, to 4 h after' },
      { h: 'Tapped early?', t: 'It starts by itself at shift end' },
      { h: 'Tapped late?', t: 'It asks if you have been on since' },
      { h: 'Overtime Complete', t: 'Then the same steps as a callback' },
    ] },
    { type: 'steps', section: 'Variation', title: 'My Variations', icon: 'MdListAlt', items: [
      { h: 'Your recorded times', t: 'Callbacks and overtime' },
      { h: 'Wrong time?', t: 'The pencil fixes it; officers see it was edited' },
      { h: 'Download', t: 'For your payroll variation form' },
      { h: 'Delete once submitted', t: 'Officers see times, never patients' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Coffee preferences', icon: 'MdLocalCafe', items: [
      { h: 'Settings → Coffee Preferences', t: 'Coffee, milk, extra shot' },
      { h: 'Set it once', t: "It's on the order each day you work" },
      { h: 'No Coffee', t: "Pick it if you don't want one" },
      { h: 'Just for today?', t: 'Change it on the Coffee tab' },
    ] },
    // ----- Officers: setting up jobs, building a week, and one slide per
    // item of each overview.
    { type: 'steps', section: 'Setting up', title: 'Locations and activities', icon: 'MdPlace', items: [
      { h: 'Location: where', t: 'Supervision, senior-and-junior, sick-call alerts' },
      { h: 'Activity: what', t: 'Any skill it needs; Case Mix counts it' },
      { h: 'Every job is one of each', t: 'They also set the job colour' },
      { h: 'Fairness counts them', t: 'Who did which activity, 12 months' },
    ] },
    { type: 'steps', section: 'Setting up', title: 'Designing a job', icon: 'MdWork', items: [
      { h: 'Name it', t: 'ED Day, Paediatric Dental List, Ward 1' },
      { h: 'Location and activity', t: 'Where it runs and what it is' },
      { h: 'Hours', t: 'When the service runs' },
      { h: 'Then its Places', t: 'Who it needs before it counts as covered' },
    ] },
    { type: 'steps', section: 'Setting up', title: 'Places on a job', icon: 'MdGroups', items: [
      { h: 'Role', t: 'e.g. Anaesthetist, Emergency SMO' },
      { h: 'Staff, visitor, or either', t: 'Visitor only: a surgeon or dentist' },
      { h: 'Grade', t: 'Senior: seniors only. Junior or Any: anyone' },
      { h: 'How many, and skills', t: 'A minimum; needs any one skill ticked' },
    ] },
    { type: 'steps', section: 'Building a week', title: 'Start with a blank week', icon: 'MdViewWeek', items: [
      { h: '1 · Lay out jobs', t: 'On the Planner tab' },
      { h: 'Go to the week', t: 'Arrows, or the date box' },
      { h: 'The palette', t: 'Your jobs, grouped by colour' },
      { h: 'On-call slots', t: 'Under each day' },
    ] },
    { type: 'steps', section: 'Building a week', title: 'Place the jobs', icon: 'MdAddBox', items: [
      { h: 'Tap a job', t: 'In the palette' },
      { h: '+ on every day', t: 'Tap + on each day it runs' },
      { h: 'Next job', t: 'Pick another, and repeat' },
      { h: 'Done?', t: 'Tap the job again; × removes a card' },
    ] },
    { type: 'steps', section: 'Building a week', title: 'A laid-out week', icon: 'MdViewModule', items: [
      { h: 'Each card', t: 'Hours, and its places, still empty' },
      { h: '0/2', t: 'Places filled, of places needed' },
      { h: 'Offer from the card', t: 'Offer senior, or any grade' },
      { h: 'Up to 4 weeks', t: 'Use + beside 1 week' },
    ] },
    { type: 'steps', section: 'Building a week', title: 'Save it as a template', icon: 'MdBookmarkAdd', items: [
      { h: 'Lay out a typical week', t: 'Once, here on the Planner' },
      { h: 'Save week as template', t: 'And give it a name' },
      { h: 'Any other week', t: 'Template…, pick it, Apply' },
      { h: 'Easier than Settings', t: 'Rostering Tools lists and renames them' },
    ] },
    { type: 'steps', section: 'Building a week', title: 'Fill the places', icon: 'MdPersonAdd', items: [
      { h: '2 · Fill places', t: 'People are listed along the bottom' },
      { h: 'Pick a person', t: 'Their places go green; tap one to book' },
      { h: 'Amber place', t: 'Type a visitor’s name' },
      { h: 'Tap the name again', t: 'To stop. With nobody picked, tap a name to remove it' },
    ] },
    { type: 'twoCol', section: 'Building a week', title: 'Who can go where',
      left: { icon: 'MdFilterList', h: 'Who is listed', items: ['Everyone, Seniors, Juniors, or one rank', 'Staff only hides 0 FTE locums', 'Days booked / FTE target by each name'] },
      right: { icon: 'MdCheckCircle', h: 'A place goes green if', items: ["Their grade fits the place's", 'They hold a skill it needs', 'Available, and no clash that day'] } },
    { type: 'steps', section: 'Building a week', title: 'Who to book, and where', icon: 'MdStars', items: [
      { h: 'Most in need first', t: 'Available, then furthest under FTE share' },
      { h: 'Pick one', t: 'Their jobs are numbered 1, 2, 3' },
      { h: '1 = done least', t: 'For their fair share of that activity' },
      { h: 'Evens out over time', t: 'In proportion to FTE' },
    ] },
    { type: 'steps', section: 'Day to day', title: 'Sick calls', icon: 'MdHealing', items: [
      { h: 'Staff tap Notify Sick', t: 'A message, to you and the on-call' },
      { h: 'A red banner', t: 'On your Day view' },
      { h: 'Approve or deny', t: 'Staff see your answer in Rstar' },
      { h: 'Then fill the gap', t: 'Book someone, or offer it' },
    ] },
    { type: 'steps', section: 'Day to day', title: 'The Volunteering panel', icon: 'MdPanTool', items: [
      { h: 'On the Calendar', t: 'Above the four weeks' },
      { h: 'Volunteers waiting', t: 'Review opens the day to accept' },
      { h: 'Offered, nobody yet', t: 'Withdraw it if plans change' },
      { h: 'Unfilled, not offered', t: 'The next 30 days; offer in a tap' },
    ] },
    { type: 'steps', section: 'Day to day', title: 'On-call slots', icon: 'MdPhoneInTalk', items: [
      { h: 'Under every day', t: 'On the Planner and Day view' },
      { h: 'Pick a person, tap a slot', t: 'Pink: they can take it' },
      { h: 'Skills count', t: 'Anaesthetics on-call needs the skill' },
      { h: 'Feeds the Phone Book', t: 'And who hears about sick calls' },
    ] },
    { type: 'steps', section: 'Day to day', title: 'Copy a week', icon: 'MdContentCopy', items: [
      { h: 'Calendar, at the bottom', t: 'Copy from week starting' },
      { h: 'Pick any Monday', t: 'Its jobs, not its people' },
      { h: 'Copy on a week row', t: 'Nothing already there changes' },
      { h: 'Or a template', t: 'Pick a template to apply' },
    ] },
    { type: 'steps', section: 'Day to day', title: 'Payroll export', icon: 'MdPayments', items: [
      { h: 'Export to Payroll', t: 'At the bottom of the Calendar' },
      { h: 'Pick the fortnight', t: 'The current one is marked' },
      { h: 'An Excel file', t: 'The whole department, 14 days' },
      { h: 'Callbacks and overtime', t: 'Are in Reports → Pay Variations' },
    ] },
    { type: 'steps', section: 'Day to day', title: 'Excel export', icon: 'MdFileDownload', items: [
      { h: 'Rostering Tools', t: 'Excel Roster Export' },
      { h: 'Start date and weeks', t: 'One sheet per week' },
      { h: 'Download', t: 'SMO, registrar and intern sections' },
      { h: 'A plain recreation', t: 'Not your original file' },
    ] },
    { type: 'steps', section: 'Settings', title: 'My Account', icon: 'MdLock', items: [
      { h: 'Notifications', t: 'Email, phone alerts, Send me a test' },
      { h: 'Password', t: 'Change it any time' },
      { h: 'Two-factor', t: 'An authenticator app code' },
      { h: 'Yours only', t: 'Same login as DR Roster' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Department', icon: 'MdApartment', items: [
      { h: 'Pay Centre Number', t: 'For the payroll export' },
      { h: 'Session Times', t: 'Morning, Afternoon, Night' },
      { h: 'Used for', t: 'Day view groups, and coffee' },
      { h: 'Can cross midnight', t: 'e.g. 20:00 to 08:00' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Shifts', icon: 'MdSchedule', items: [
      { h: 'Named shifts', t: 'e.g. Day, ED Late, Night' },
      { h: 'Hours and days', t: 'Weekday or weekend' },
      { h: 'A length', t: 'Full day, half day, night' },
      { h: 'Deactivate', t: 'Old ones stay in history' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Shift Pattern Rules', icon: 'MdBedtime', items: [
      { h: 'Fatigue rules', t: 'Checked as you book' },
      { h: 'A 7-day window', t: 'The 6 days before, and today' },
      { h: 'Allow, warn or block', t: 'You choose for each rule' },
      { h: 'Any Shift', t: 'Leave a day blank to ignore it' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Duty Types', icon: 'MdPhoneInTalk', items: [
      { h: 'On-call slots', t: 'Name and short code, e.g. AN' },
      { h: 'Counts as on call', t: 'Fairness report and fatigue' },
      { h: 'Hours and skills', t: 'Who can take it' },
      { h: 'Sick-call alerts', t: 'Tick to tell whoever is on' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Leave Types', icon: 'MdBeachAccess', items: [
      { h: 'The leave you record', t: 'Annual, study, RDO…' },
      { h: 'A code each', t: 'e.g. AL, as on your roster' },
      { h: 'Booked on the day', t: 'In place of a shift' },
      { h: 'Never shown', t: 'Colleagues never see the reason' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Advanced Skills', icon: 'MdVerifiedUser', items: [
      { h: 'Your list', t: 'Anaesthetics, Obstetrics, Endoscopy' },
      { h: 'Tag people', t: 'In Staff and Availability' },
      { h: 'Require one', t: 'On an activity, place or on-call slot' },
      { h: 'A hard rule', t: 'No skill, no booking or offer' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Week Templates', icon: 'MdViewWeek', items: [
      { h: 'Rostering Tools', t: 'Your saved weeks' },
      { h: 'Rename or delete', t: 'Edit a template here' },
      { h: 'Build in the Planner', t: 'Then Save week as template' },
      { h: 'Apply anywhere', t: 'Planner, or Calendar row' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Staff and Availability', icon: 'MdPerson', items: [
      { h: 'Pick a person', t: 'Or + Add Staff' },
      { h: 'Rank and FTE', t: 'FTE sets their fair share' },
      { h: 'Email and skills', t: 'Email is their sign-in' },
      { h: 'Availability', t: 'Day by day, or a pattern' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Phone Book', icon: 'MdContactPhone', items: [
      { h: 'Coffee Place', t: 'Where the coffee order is texted' },
      { h: 'Useful numbers', t: 'Switch, social work, other sites' },
      { h: 'Everyone sees them', t: 'Tap to call' },
      { h: 'On-call names', t: 'Come from the roster itself' },
    ] },
    { type: 'steps', section: 'Settings', title: 'Your profile', icon: 'MdPerson', items: [
      { h: 'Settings → Profile', t: 'Your phone and email' },
      { h: 'Colleagues see them', t: 'In the Phone Book and search' },
      { h: 'Your email', t: 'Is also how you sign in' },
      { h: 'Keep them current', t: 'So the on-call can reach you' },
    ] },
    { type: 'closing', section: 'Questions', title: 'Questions?', items: [
      'Settings → Walkthrough: the staff tour, in the app',
      'The How-To Guide covers every screen, by role',
      'No alerts? Settings → Notifications → Send me a test',
      'Anything else: ask your rostering officer',
    ] },
  ],
};

// ---------- DR Roster ----------
const dr = {
  name: 'DR Roster: feature tour',
  footer: 'DR Roster · feature tour',
  palette: { dark: '23362B', primary: '2F6B4F', accent: 'D97706', light: 'EAF2EC', soft: 'B7D3C1' },
  slides: [
    { type: 'title', section: 'Welcome', title: 'DR Roster', sub: 'The district shift board · a quick tour for doctors and officers' },
    { type: 'flow', section: 'Welcome', title: 'How it fits with Rstar', items: [
      { icon: 'MdLocalHospital', h: 'Gap at a site', t: 'Offered to local staff in Rstar' },
      { icon: 'MdHourglassBottom', h: 'Nobody local', t: 'After 72 hours it comes to DR Roster' },
      { icon: 'MdPanTool', h: 'Doctors apply', t: 'District doctors who can do it' },
      { icon: 'MdCheckCircle', h: 'Officer approves', t: 'The doctor lands on the Rstar card' },
    ], note: 'Sites can also post straight to DR Roster. It uses the same login as Rstar.' },
    { type: 'steps', section: 'Getting started', title: 'Getting started', icon: 'MdPhoneIphone', items: [
      { h: 'Accept your invite', t: 'Set a password from the email; Rstar users keep the same login' },
      { h: 'Install it', t: 'iPhone: Safari → Share → Add to Home Screen. Android: Install app' },
      { h: 'Two-factor (optional)', t: 'The same setting as Rstar: on in one is on in both' },
      { h: 'Forgotten your password?', t: 'Use Forgot password on the sign-in page' },
    ] },
    { type: 'cards', section: 'Getting started', title: 'The tabs', items: [
      { icon: 'MdCalendarMonth', h: 'Calendar', t: 'Open shifts you can do, and applying' },
      { icon: 'MdSwapHoriz', h: 'Swaps', t: 'My shifts, listings and Find a swap' },
      { icon: 'MdPerson', h: 'My profile', t: 'Level, skills, sites and alerts' },
      { icon: 'MdHelpOutline', h: 'Help', t: 'How it all works, for your role' },
      { icon: 'MdDomain', h: 'Sites & Doctors', t: 'Officers: shift types, colours, invites' },
      { icon: 'MdAdminPanelSettings', h: 'Admin', t: 'Super admin: districts, sites, Rstar links' },
    ] },
    { type: 'cards', section: 'Doctors', title: 'Your profile decides what you see', items: [
      { icon: 'MdSchool', h: 'Level', t: 'Consultant to intern: you see your level and below' },
      { icon: 'MdMedicalServices', h: 'Skills', t: 'Anaesthetics, O&G, Endoscopy: shown if you hold it' },
      { icon: 'MdPlace', h: "Sites I'd work at", t: 'You only see, and hear about, these sites' },
      { icon: 'MdHome', h: 'Home site', t: 'Your primary site: used by the rest rule and for swaps' },
    ] },
    { type: 'swatches', section: 'Doctors', title: 'Reading the Calendar', lead: 'Shifts for me shows only open shifts you can actually do.', items: [
      { color: '0EA5E9', h: 'Site colour', t: 'Shifts you can apply for', mark: '2' },
      { colors: ['0EA5E9', 'E11D48', '0EA5E9', 'E11D48'], h: 'Striped', t: 'Shifts at more than one site' },
      { color: 'F59E0B', h: 'Amber', t: "You've applied" },
      { color: '22C55E', h: 'Green', t: "You're booked" },
      { color: 'F9FAFB', border: 'D1D5DB', h: 'Pale grey', t: "You're working that day", mark: '14', markColor: '9CA3AF' },
      { color: 'E5E7EB', border: 'D1D5DB', h: 'Struck through', t: "You've marked it not available", strike: true },
      { color: 'FFFFFF', border: 'D1D5DB', h: 'White', t: 'Nothing for you' },
    ] },
    { type: 'twoCol', section: 'Doctors', title: 'Look across sites',
      left: { icon: 'MdTravelExplore', h: 'Ticked (default)', items: ["Every site you'd work at", 'The point of DR Roster: more sites, more shifts'] },
      right: { icon: 'MdHome', h: 'Unticked', items: ["Only your home site's shifts", 'Shifts you applied for or are booked on always show', 'Swaps are the other way round: off unless you tick it'] } },
    { type: 'flow', section: 'Doctors', title: 'Applying for a shift', items: [
      { icon: 'MdTouchApp', h: 'Tap a day', t: 'See its shifts, and why' },
      { icon: 'MdEdit', h: 'Apply', t: 'Add a note for the officer if you like' },
      { icon: 'MdHourglassBottom', h: 'Officer decides', t: 'You can withdraw while it waits' },
      { icon: 'MdCheckCircle', h: "You're told", t: 'Approved shifts from Rstar put you on the card' },
    ], note: 'If it says no, it says why: a clash, the rest rule, your level or skills, or a blocked day.' },
    { type: 'twoCol', section: 'Doctors', title: 'Blocking days',
      left: { icon: 'MdBlock', h: 'Blocked', items: ["Tap a day → I'm not available this day", 'Or dark grey (working elsewhere) in Rstar', 'No shifts shown, no alerts'] },
      right: { icon: 'MdBeachAccess', h: 'Not blocked', items: ['A red leave or day-off in Rstar', "You're still offered shifts, in case you want one", 'A night into a blocked morning is blocked'] } },
    { type: 'stats', section: 'Doctors', title: "When you'll hear about shifts", lead: "Only shifts you can do, at sites you'd work at, and each thing only once.", items: [
      { h: 'Now', t: 'New shifts posted on DR Roster go straight to doctors who can do them' },
      { h: 'Mon 9:00', t: 'One summary of shifts passed up from Rstar, next 6 weeks' },
      { h: '6–21h', t: 'Checked every 30 minutes, so nothing arrives overnight' },
    ] },
    { type: 'statSteps', section: 'Swaps', title: 'Swaps are one for one', big: '1 for 1', bigLabel: "Nobody's shift count or FTE can drop. To work more, apply for open shifts.", items: [
      { h: 'You list a shift', t: 'And tick at least one day or night you could work in return' },
      { h: 'Someone offers theirs', t: 'On one of your days, in the same pay fortnight' },
      { h: 'The officer approves', t: 'Bookings swap over, Rstar included' },
      { h: 'Until then', t: 'You still work your shift, so the site never loses cover' },
    ] },
    { type: 'twoCol', section: 'Swaps', title: 'My shifts',
      left: { icon: 'MdViewList', h: 'List', items: ['Every shift you work: DR Roster plus your Rstar roster', 'List for swap and Find a swap on each'] },
      right: { icon: 'MdCalendarMonth', h: 'Calendar', items: ['Four weeks; swipe or use the arrows', 'Coloured by site; striped amber when listed', 'Tap a day to see its shifts'] } },
    { type: 'steps', section: 'Swaps', title: 'Listing a shift', icon: 'MdPostAdd', items: [
      { h: 'List for swap', t: "On the shift in My shifts, or in Rstar's Variation tab" },
      { h: 'Days you could work', t: 'Tick at least one day or night in that pay fortnight' },
      { h: 'Other sites (optional)', t: "Tick it if you'd take a shift in return at another site" },
      { h: "Who's told", t: 'Only doctors who could actually close the swap' },
    ] },
    { type: 'twoCol', section: 'Swaps', title: 'Finding a swap',
      left: { icon: 'MdStorefront', h: 'Up for swap', items: ['Only listings you could close', 'Swap for one of mine'] },
      right: { icon: 'MdSearch', h: 'Find a swap (n)', items: ['On each of your own shifts', 'Lists every listing you could trade it for', 'Offer swap: no need to list yours first'] } },
    { type: 'flow', section: 'Swaps', title: 'Swapping across sites', items: [
      { icon: 'MdPostAdd', h: 'Wattle Creek doctor lists', t: "Ticks I'd take a shift at another site" },
      { icon: 'MdTravelExplore', h: 'Banksia Bay doctor finds it', t: 'Ticks Look across sites' },
      { icon: 'MdGroups', h: 'Both officers approve', t: 'Each site is getting a different doctor' },
      { icon: 'MdSwapHoriz', h: 'Swap happens', t: 'On the second approval' },
    ], note: "Both doctors pass every rule, at sites each has ticked under Sites I'd work at." },
    { type: 'divider', section: 'For officers', title: 'For rostering officers', sub: 'Post shifts, pick applicants, approve swaps' },
    { type: 'cards', section: 'For officers', title: 'Posting shifts', items: [
      { icon: 'MdEdit', h: 'One at a time', t: 'Site, shift type, date, position and notes' },
      { icon: 'MdContentPaste', h: 'Paste a message', t: 'From email or WhatsApp' },
      { icon: 'MdTableChart', h: 'Spreadsheet', t: 'A tab per site; preview, post' },
      { icon: 'MdReportProblem', h: 'Service disruption', t: 'Tick it if the service closes when nobody takes it' },
    ] },
    { type: 'steps', section: 'For officers', title: 'Filling shifts and approving swaps', icon: 'MdTaskAlt', items: [
      { h: 'Approve an applicant', t: 'Books them, and tells everyone else who applied' },
      { h: 'Mark filled by…', t: 'Books a doctor without an application' },
      { h: 'Reopen or Cancel', t: 'Everyone involved is told' },
      { h: 'Approve a swap', t: 'Rules are re-checked; bookings move, Rstar included' },
    ] },
    { type: 'stats', section: 'For officers', title: "Gaps you'll hear about", items: [
      { h: '< 3 wks', t: 'Still open: flagged Locum might be required' },
      { h: '< 72 h', t: 'Still open: emailed and pushed to you at once' },
      { h: 'Weekly', t: 'Digest of open shifts and swaps, on the day(s) you choose' },
    ], note: 'Admins link each site to its Rstar department on the Admin tab. That link drives escalation and swaps.' },
    { type: 'closing', section: 'Questions', title: 'Questions?', items: [
      'The Help tab explains everything for your role',
      'Not seeing a shift? Check level, skills, sites and Look across sites',
      'No alerts? Send me a test; on iPhone open it from the Home Screen',
      'Anything else: ask your rostering officer',
    ] },
  ],
};

// Which screenshot (shots/<name>.png, from shots.js) goes on which slide.
const SHOTS = {
  rostar: {
    'Getting started': 'r_signin',
    'Your day and week': 'r_day',
    'Phone Book and calendar export': 'r_phonebook',
    'Set your availability': 'r_availability',
    'Pick up an extra shift': 'r_variation',
    'Callbacks and overtime': 'r_myvariations',
    'Restrictions and skills': 'r_restrictions',
    'Security and two-factor': 'r_security',
    'Marking a service disruption': 'o_offer',
    'Locations, activities and jobs': 'o_jobs',
    'Staff and accounts': 'o_accounts',
    'Excel import, step by step': 'o_import',
    'Swap a shift, one for one': 'r_swapform',
    'Calling in sick': 'r_sick',
    'Coffee, sorted': 'r_coffee',
    "What you'll be told": 'r_notifications',
    'Calendar coverage colours': 'o_calendar',
    'The Planner in two steps': 'o_planner',
    'Offer a gap, get it filled': 'o_day',
    'Callbacks while on call': 'r_callback',
    'The callback timer': 'r_short',
    'Saving a patient detail': 'r_patient',
    'The fatigue notice': 'r_fatigue',
    'My Variations': 'r_myvariations',
    'Coffee preferences': 'r_coffeeprefs',
    'Locations and activities': 'o_locations',
    'Designing a job': 'o_jobs',
    'Places on a job': 'o_places',
    'Start with a blank week': 'o_blank',
    'Place the jobs': 'o_pick',
    'A laid-out week': 'o_layout',
    'Save it as a template': 'o_template',
    'Fill the places': 'o_fill',
    'Who to book, and where': 'o_rank',
    'Sick calls': 'r_sick',
    'The Volunteering panel': 'o_volunteering',
    'On-call slots': 'o_day',
    'Copy a week': 'o_caltools',
    'Payroll export': 'o_payroll',
    'Excel export': 'o_export',
    'My Account': 'o_myaccount',
    'Department': 'o_department',
    'Shifts': 'o_shifts',
    'Shift Pattern Rules': 'o_patternrules',
    'Duty Types': 'o_duties',
    'Leave Types': 'o_leave',
    'Advanced Skills': 'o_skills',
    'Week Templates': 'o_weektemplates',
    'Staff and Availability': 'o_staff',
    'Phone Book': 'o_phonebook',
    'Your profile': 'r_profile',
    "Who's offered what": 'o_ranks',
    'Reports and compliance': 'o_reports',
  },
  dr: {
    'Getting started': 'd_signin',
    'Your profile decides what you see': 'd_profile',
    'Reading the Calendar': 'd_calendar',
    'Look across sites': 'd_calendar_home',
    'Applying for a shift': 'd_day',
    'Blocking days': 'd_block',
    'Swaps are one for one': 'd_myshifts_cal',
    'My shifts': 'd_myshifts_list',
    'Listing a shift': 'd_listform',
    'Finding a swap': 'd_findswap',
    'Swapping across sites': 'd_across',
    'Posting shifts': 'do_post',
    'Filling shifts and approving swaps': 'do_day',
    "Gaps you'll hear about": 'do_account',
  },
};

// One deck per audience: the title slide, the chosen slides in order (each
// with its spoken notes), then the closing slide.
function variant(v) {
  const base = { rostar, dr }[v.base];
  const byTitle = Object.fromEntries(base.slides.map(s => [s.title, s]));
  const pick = (t) => {
    if (!byTitle[t]) throw new Error(`${v.file}: no slide "${t}"`);
    if (!v.notes[t]) throw new Error(`${v.file}: no notes for "${t}"`);
    return { ...byTitle[t], notes: v.notes[t], shot: (v.shots || {})[t] || SHOTS[v.base][t] };
  };
  const first = base.slides[0], last = base.slides[base.slides.length - 1];
  return {
    ...base,
    slides: [
      { ...first, sub: v.sub, notes: v.titleNotes },
      ...v.take.map(pick),
      { ...last, title: 'Need a hand?', notes: v.closing },
    ],
  };
}

(async () => {
  for (const v of require('./variants')) await build(variant(v), v.file);
})().catch(e => { console.error(e); process.exit(1); });
