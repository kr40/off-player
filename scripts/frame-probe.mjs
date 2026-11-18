// Records frame times while a scripted interaction runs in the dev app
// (launched with the remote debugging port), and reports the budget.
//   node scripts/frame-probe.mjs scroll        smooth-scroll the current page down and up
//   node scripts/frame-probe.mjs idle 5000     just record for 5 s (e.g. during an import)
//   node scripts/frame-probe.mjs rowscroll     page a row of cards right and back
//   node scripts/frame-probe.mjs order         switch a collection's order back and forth
//   node scripts/frame-probe.mjs menu          open and close the Categories/filter menu
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cdp = fileURLToPath(new URL("./cdp.mjs", import.meta.url));
const run = (...a) => execFileSync(process.execPath, [cdp, ...a]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , mode = "scroll", arg] = process.argv;

run("eval", `(() => { window.__fr = []; window.__frOn = true; const loop = (t) => { if (!window.__frOn) return; window.__fr.push(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop); return 'rec'; })()`);
const page = "document.querySelector('.page-host[style*=block] .page:not([style*=none])')";
const visiblePage = `([...document.querySelectorAll('.page-host[style*=block] .page')].find(p => p.offsetParent !== null))`;

if (mode === "scroll") {
  for (const dir of [1, -1]) {
    run("eval", `(async () => { const p = ${visiblePage}; for (let i = 0; i < 40; i++) { p.scrollBy({ top: ${dir} * 260 }); await new Promise(r => requestAnimationFrame(r)); } return 'ok'; })()`);
    await sleep(400);
  }
} else if (mode === "rowscroll") {
  for (const dir of [1, -1, 1, -1]) {
    run("eval", `(() => { const t = ${visiblePage}.querySelector('.row-track'); t.scrollBy({ left: ${dir} * t.clientWidth * 0.82, behavior: 'smooth' }); return 'ok'; })()`);
    await sleep(700);
  }
} else if (mode === "order") {
  for (const label of ["Release order", "Story order", "Timeline order", "Release order"]) {
    run("eval", `(() => { const b = [...document.querySelectorAll('.page-host[style*=block] .order-tabs button')].find(b => b.textContent === ${JSON.stringify(label)}); if (b) b.click(); return 'ok'; })()`);
    await sleep(600);
  }
} else if (mode === "menu") {
  for (let i = 0; i < 4; i++) {
    run("eval", `(() => { const b = document.querySelector('.page-host[style*=block] .catmenu-btn, .page-host[style*=block] .fbtn'); b?.click(); return 'ok'; })()`);
    await sleep(450);
  }
} else {
  await sleep(Number(arg ?? 4000));
}

const fr = JSON.parse(run("eval", "window.__frOn = false; JSON.stringify(window.__fr)"));
const dts = fr.slice(1).map((t, i) => t - fr[i]);
const s = [...dts].sort((a, b) => a - b);
const q = (p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(1);
console.log(JSON.stringify({ mode, frames: fr.length, median: q(0.5), p95: q(0.95), max: q(1), over25ms: dts.filter((d) => d > 25).length, over100ms: dts.filter((d) => d > 100).length }));
