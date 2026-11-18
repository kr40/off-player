// Measures the Home "Your series" card hover: moves a virtual pointer across
// the cards, recording every animation frame. Reports frame times, whether any
// card's box moved (cards must not shift or cover their neighbours), and
// whether the hovered card's outline stays inside the row's clipping area.
// Needs the dev app running with the remote debugging port (see README).
//   node scripts/hover-probe.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cdp = fileURLToPath(new URL("./cdp.mjs", import.meta.url));
const run = (...args) => execFileSync(process.execPath, [cdp, ...args]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

run("eval", `(() => { const page = [...document.querySelectorAll('.page-host[style*=block] .page')].find(p => p.offsetParent);
  const row = [...page.querySelectorAll('.row')].find(r => r.querySelector('.tcard')); row.scrollIntoView({ block: 'center' }); window.__hrow = row; return 1; })()`);
await sleep(800);
const setup = `(() => {
  const row = window.__hrow;
  const cards = [...row.querySelectorAll('.tcard')];
  window.__rec = [];
  window.__recOn = true;
  const loop = (t) => {
    if (!window.__recOn) return;
    window.__rec.push([t, ...cards.flatMap(c => { const r = c.getBoundingClientRect(); const a = c.querySelector('.tcard-art').getBoundingClientRect(); return [r.left, r.right, a.left, a.right, a.top]; })]);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const track = row.querySelector('.row-track').getBoundingClientRect();
  return JSON.stringify({ track: [track.left, track.top, track.right], pts: cards.map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), r.left, r.right, r.top]; }) });
})()`;

const info = JSON.parse(run("eval", setup));
const pts = info.pts;
run("hover", "900", "150"); // away
await sleep(400);
for (const i of [0, 1, 2, 1, 0]) {
  if (!pts[i]) continue;
  run("hover", String(pts[i][0]), String(pts[i][1]));
  await sleep(700);
}
run("hover", "900", "150");
await sleep(400);
const rec = JSON.parse(run("eval", "window.__recOn = false; JSON.stringify(window.__rec)"));

const dts = rec.slice(1).map((f, i) => f[0] - rec[i][0]);
const sorted = [...dts].sort((a, b) => a - b);
const n = pts.length;
let boxDrift = 0, overlap = 0, minTop = Infinity;
for (const f of rec) {
  for (let c = 0; c < n; c++) {
    const [l, r, al, ar, at] = f.slice(1 + c * 5, 6 + c * 5);
    boxDrift = Math.max(boxDrift, Math.abs(l - pts[c][2]), Math.abs(r - pts[c][3]));
    minTop = Math.min(minTop, at);
    // The art (with its 2px outline) must never reach into the next card.
    if (c + 1 < n) overlap = Math.max(overlap, ar + 2 - f[1 + (c + 1) * 5 + 2]);
  }
}
console.log(JSON.stringify({
  frames: rec.length,
  frameMs: { median: +sorted[Math.floor(sorted.length / 2)].toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), max: +sorted[sorted.length - 1].toFixed(1), over25ms: dts.filter((d) => d > 25).length },
  maxCardShiftPx: +boxDrift.toFixed(1),
  overlapIntoNeighbourPx: +Math.max(0, overlap).toFixed(1),
  outlineClearOfRowTopPx: +(minTop - 2 - info.track[1]).toFixed(0),
}, null, 1));
