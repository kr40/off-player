// Drive the running dev app through the WebView2 DevTools protocol, without
// touching the real mouse or keyboard. Start the app with:
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9229
//
//   node scripts/cdp.mjs eval "document.title"
//   node scripts/cdp.mjs hover 470 690          (CSS pixels in the page)
//   node scripts/cdp.mjs click 303 523
//   node scripts/cdp.mjs key Escape | key n | key ArrowRight
//   node scripts/cdp.mjs wheel 640 400 -120
//   node scripts/cdp.mjs shot out.png           (page only; mpv video is behind it)
import { writeFileSync } from "node:fs";

const [, , cmd, ...args] = process.argv;
const port = process.env.CDP_PORT ?? 9229;

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page =
  targets.find((t) => t.type === "page" && /localhost:1420|tauri\.localhost/.test(t.url)) ??
  targets.find((t) => t.type === "page");
if (!page) throw new Error("No page target; is the app running with remote debugging?");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (d) => (d.error ? reject(new Error(`${method}: ${JSON.stringify(d.error)}`)) : resolve(d.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

const KEYS = {
  Escape: ["Escape", 27], Enter: ["Enter", 13], Backspace: ["Backspace", 8], " ": ["Space", 32],
  ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40],
  PageDown: ["PageDown", 34], PageUp: ["PageUp", 33], Home: ["Home", 36], End: ["End", 35],
};

async function key(k) {
  const known = KEYS[k];
  const code = known ? known[0] : /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : k;
  const vk = known ? known[1] : k.toUpperCase().charCodeAt(0);
  const text = known && k !== " " ? undefined : k;
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, text });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
}

const n = (i) => Number(args[i]);
switch (cmd) {
  case "eval": {
    const r = await send("Runtime.evaluate", { expression: args[0], awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    else console.log(typeof r.result.value === "string" ? r.result.value : JSON.stringify(r.result.value, null, 1));
    break;
  }
  case "hover":
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: n(0), y: n(1) });
    break;
  case "click":
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: n(0), y: n(1) });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: n(0), y: n(1), button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: n(0), y: n(1), button: "left", clickCount: 1 });
    break;
  case "wheel":
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: n(0), y: n(1), deltaX: 0, deltaY: n(2) });
    break;
  case "key":
    for (const k of args) await key(k);
    break;
  case "shot": {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(args[0], Buffer.from(r.data, "base64"));
    console.log("saved", args[0]);
    break;
  }
  default:
    console.error("commands: eval | hover x y | click x y | wheel x y dy | key K... | shot file.png");
    process.exitCode = 2;
}
ws.close();
