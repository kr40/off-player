// TMDB access for build scripts: runs requests inside the dev app (which holds
// the user's key and enforces the host pin) over the WebView2 debug port.
// Requires the dev app started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9229.
export async function connect(port = process.env.CDP_PORT ?? 9229) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page" && /localhost:1420/.test(t.url)) ?? targets.find((t) => t.type === "page");
  if (!page) throw new Error("No dev app page; start it with the debug port.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (d) => {
        const r = d.result;
        if (d.error || r?.exceptionDetails) reject(new Error(JSON.stringify(d.error ?? r.exceptionDetails.exception?.description ?? r.exceptionDetails)));
        else resolve(r.result.value);
      });
      ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  const tmdb = (path, params = {}) => evaluate(`window.__offplayer.tmdb(${JSON.stringify(path)}, ${JSON.stringify(params)})`);
  return { tmdb, evaluate, close: () => ws.close() };
}

export const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
