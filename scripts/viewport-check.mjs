// Emulates window sizes in the dev app and checks each main page for
// horizontal scrolling, cards overflowing their grid cell, and overlapping
// grid items. Saves a screenshot per page and size.
//   node scripts/viewport-check.mjs <out-dir> [1024x640 3840x2160 …]
import { writeFileSync, mkdirSync } from "node:fs";

const [, , outDir = ".", ...sizes] = process.argv;
const SIZES = sizes.length ? sizes : ["1024x640", "3840x2160"];
mkdirSync(outDir, { recursive: true });
const targets = await (await fetch("http://127.0.0.1:9229/json")).json();
const page = targets.find((t) => t.type === "page" && /localhost:1420/.test(t.url)) ?? targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, (d) => res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ["Home", ".nav-links button", "Home"],
  ["Library", ".nav-links button", "Library"],
  ["For You", ".subnav button", "For You", ".nav-links button", "Discover"],
  ["Browse", ".subnav button", "Browse"],
  ["Top Lists", ".subnav button", "Top Lists"],
  ["Collections", ".subnav button", "Collections"],
  ["Coming Soon", ".subnav button", "Coming Soon"],
  ["My List", ".nav-links button", "My List"],
];
const click = (sel, text) =>
  ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.offsetParent && e.textContent.trim().startsWith(${JSON.stringify(text)})); if (b) b.click(); return !!b; })()`);

const report = [];
for (const size of SIZES) {
  const [w, h] = size.split("x").map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  for (const [name, sel, text, preSel, preText] of PAGES) {
    if (preSel) (await click(preSel, preText), await sleep(800));
    await click(sel, text);
    await sleep(2200);
    const r = await ev(`(() => {
      const p = [...document.querySelectorAll('.page-host[style*=block] .page')].find(x => x.offsetParent);
      const hscroll = p ? p.scrollWidth - p.clientWidth : -1;
      const docOver = document.documentElement.scrollWidth - innerWidth;
      let overflow = 0, overlap = 0;
      for (const g of p.querySelectorAll('.pgrid, .coll-grid, .tl-grid')) {
        const kids = [...g.children].filter(k => k.offsetParent).slice(0, 60).map(k => k.getBoundingClientRect());
        const gr = g.getBoundingClientRect();
        for (const k of kids) if (k.right > gr.right + 1) overflow++;
        for (let i = 1; i < kids.length; i++) if (Math.abs(kids[i].top - kids[i-1].top) < 2 && kids[i].left < kids[i-1].right - 1) overlap++;
      }
      const nav = document.querySelector('.topnav-main'); const navOver = nav ? nav.scrollWidth - nav.clientWidth : 0;
      return { hscroll, docOver, overflow, overlap, navOver };
    })()`);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outDir}/${size}-${name.replace(/\s+/g, "-").toLowerCase()}.png`, Buffer.from(shot.data, "base64"));
    report.push({ size, name, ...r });
  }
}
await send("Emulation.clearDeviceMetricsOverride");
ws.close();
for (const r of report) console.log(JSON.stringify(r));
