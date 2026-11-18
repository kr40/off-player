// Layout-shift probe: opens a page by clicking a control, then records the
// position of every heading, card and section present at first paint and
// reports anything that moved more than 1 px while images and data loaded.
//   node scripts/shift-probe.mjs "<selector>" "<text>"   e.g. ".subnav button" "Top Lists"
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cdp = fileURLToPath(new URL("./cdp.mjs", import.meta.url));
const run = (...a) => execFileSync(process.execPath, [cdp, ...a]).toString().trim();
const [, , sel, text = ""] = process.argv;

const out = run(
  "eval",
  `(async () => {
  const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent && e.textContent.trim().startsWith(${JSON.stringify(text)}));
  if (!b) return 'control not found';
  b.click();
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await frame();
  const page = () => [...document.querySelectorAll('.page-host[style*=block] .page')].find(p => p.offsetParent);
  const pick = () => [...page().querySelectorAll('h1, h2, .row-title, .pcard, .coll-tile, .tl-tile, .tl-entry, .tab-head, .filterbar, .hero-body, .browse-head, .settings-nav')]
    .filter(e => e.offsetParent && !e.closest('.dskel'));
  const first = pick().map(e => [e, e.getBoundingClientRect()]);
  let worst = 0, moved = new Set();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    for (const [e, r0] of first) {
      if (!e.isConnected) continue;
      const r = e.getBoundingClientRect();
      const d = Math.max(Math.abs(r.left - r0.left), Math.abs(r.top - r0.top));
      // Elements that are animating in (rise-in, up to 11 × 30 ms stagger) settle by 8px; ignore the first 800 ms.
      if (i >= 8 && d > 1) { moved.add((e.className || e.tagName) + ':' + (e.textContent || '').trim().slice(0, 24)); worst = Math.max(worst, d); }
    }
  }
  return JSON.stringify({ tracked: first.length, moved: [...moved].slice(0, 8), movedCount: moved.size, worstPx: Math.round(worst) });
})()`,
);
console.log(`${sel} ${text}: ${out}`);
