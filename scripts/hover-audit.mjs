// Hover audit: drives a real (virtual) pointer over cards and reports problems.
//   node scripts/hover-audit.mjs deadzone   pointer comes down from the row above onto each row's cards
//   node scripts/hover-audit.mjs ring       hovers cards in the visible grid and checks the highlight isn't clipped
// Needs the dev app running with the remote debugging port.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cdp = fileURLToPath(new URL("./cdp.mjs", import.meta.url));
const run = (...a) => execFileSync(process.execPath, [cdp, ...a]).toString().trim();
const ev = (js) => JSON.parse(run("eval", `JSON.stringify(${js})`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , mode = "deadzone"] = process.argv;
const PAGE = `[...document.querySelectorAll('.page-host[style*=block] .page')].find(p => p.offsetParent)`;

if (mode === "deadzone") {
  const rows = ev(`(() => { const p = ${PAGE}; return [...p.querySelectorAll('.row')].map((r, i) => i); })()`);
  const out = [];
  for (const i of rows.slice(1)) {
    // Centre the row pair, then find a card in the row above and one in this row.
    const g = ev(`(() => { const p = ${PAGE}; const rows = [...p.querySelectorAll('.row')]; const r = rows[${i}], prev = rows[${i} - 1];
      r.scrollIntoView({ block: 'center' });
      const card = r.querySelector('.row-track > *'), above = prev.querySelector('.row-track > *');
      if (!card || !above) return null;
      const c = card.getBoundingClientRect(), a = above.getBoundingClientRect();
      return { title: r.querySelector('.row-title').textContent.trim().slice(0, 28), ax: a.left + a.width / 2, ay: a.top + a.height / 2, cx: c.left + c.width / 2, ctop: c.top, ch: c.height }; })()`);
    if (!g) continue;
    await sleep(150);
    run("hover", "5", "5");
    await sleep(120);
    run("hover", String(Math.round(g.ax)), String(Math.round(g.ay))); // on the card above
    await sleep(500);
    // Come down in steps to 12 px inside the top of this row's card.
    const y1 = Math.round(g.ctop + 12);
    for (let y = Math.round(g.ay); y < y1; y += 24) run("hover", String(Math.round(g.cx)), String(y));
    run("hover", String(Math.round(g.cx)), String(y1));
    await sleep(120);
    const hit = ev(`(() => { const e = document.elementFromPoint(${Math.round(g.cx)}, ${y1}); const row = e?.closest('.row'); return { tag: (e?.className || e?.tagName || '').toString().slice(0, 40), row: row?.querySelector('.row-title')?.textContent.trim().slice(0, 28) ?? null, onCard: !!e?.closest('.row-track > *') }; })()`);
    out.push({ row: g.title, ok: hit.onCard && hit.row === g.title, hit: hit.tag, hitRow: hit.row });
  }
  run("hover", "5", "5");
  for (const o of out) console.log(JSON.stringify(o));
  console.log(`dead zones: ${out.filter((o) => !o.ok).length} of ${out.length}`);
} else {
  // For each of the first cards in every grid/row on screen: hover, wait for the transition, then compare the
  // highlight's box (card art plus its 2px ring and lift) with every clipping ancestor.
  const cards = ev(`(() => { const p = ${PAGE}; const sel = '.pgrid .pcard, .pgrid .dcard .pcard, .row-track .pcard, .row-track .ecard, .row-track .scard, .tl-tile, .coll-tile';
    const all = [...p.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top > 80 && r.bottom < innerHeight - 10 && r.left >= 0 && r.right <= innerWidth; });
    const pick = []; const seen = new Set();
    for (const e of all) { const box = e.closest('.pgrid, .row-track, .tl-grid, .coll-grid'); const k = box; const n = [...seen].filter(x => x === k).length; if (!pick.some(x => x.box === box && x.n >= 3)) { const prev = pick.filter(x => x.box === box).length; if (prev < 4) pick.push({ e, box, n: prev }); } }
    window.__audit = pick.map(x => x.e);
    return pick.map(x => { const r = x.e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 80) }; }); })()`);
  const bad = [];
  for (let i = 0; i < cards.length; i++) {
    run("hover", String(Math.round(cards[i].x)), String(Math.round(cards[i].y)));
    await sleep(380);
    const r = ev(`(() => { const e = window.__audit[${i}]; const art = e.querySelector('.pcard-art, .ecard-art, .scard-art, .tl-art, .coll-art') ?? e;
      const hovered = e.matches(':hover'); const a = art.getBoundingClientRect(); const ring = 2;
      const need = { l: a.left - ring, t: a.top - ring, r: a.right + ring, b: a.bottom + ring };
      let clip = null;
      for (let n = art.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const clips = /(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY) || cs.contain.includes('paint') || cs.contentVisibility === 'auto';
        if (!clips) continue;
        const b = n.getBoundingClientRect();
        const cut = Math.max(b.left - need.l, b.top - need.t, need.r - b.right, need.b - b.bottom);
        if (cut > 0.5) { clip = { by: (n.className || n.tagName).toString().slice(0, 30), cutPx: Math.round(cut * 10) / 10 }; break; }
      }
      return { name: (e.textContent || '').trim().slice(0, 24), hovered, shadow: getComputedStyle(art).boxShadow !== 'none', clip }; })()`);
    if (!r.hovered || r.clip) bad.push(r);
  }
  run("hover", "5", "5");
  for (const b of bad) console.log(JSON.stringify(b));
  console.log(`checked ${cards.length} cards, problems: ${bad.length}`);
}
