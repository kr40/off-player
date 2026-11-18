// Print the centre of the first visible element matching a selector (optionally
// containing some text), for use with `cdp.mjs click`.
//   node scripts/at.mjs ".pcard" "Star Trek"
import { execFileSync } from "node:child_process";

const [, , selector, text = ""] = process.argv;
const js = `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .filter(e => e.offsetParent !== null && e.textContent.includes(${JSON.stringify(text)}));
  const e = els[0];
  if (!e) return "none";
  e.scrollIntoView({ block: "center" });
  const r = e.getBoundingClientRect();
  return Math.round(r.x + r.width / 2) + " " + Math.round(r.y + r.height / 2);
})()`;
process.stdout.write(
  execFileSync(process.execPath, [new URL("./cdp.mjs", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "eval", js]).toString().trim(),
);
