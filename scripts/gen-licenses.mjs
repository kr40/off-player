// Writes src/generated/licenses.json: every npm package shipped in the app
// (production dependencies, recursively), every Rust crate compiled into it,
// and the bundled native components. Shown in Settings → About.
//   node scripts/gen-licenses.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = new Map();
const add = (name, version, license) => out.set(`${name}@${version}`, { name, version, license: license || "See package" });

// npm: walk production dependencies.
const seen = new Set();
function walk(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const p = join(root, "node_modules", name, "package.json");
  if (!existsSync(p)) return;
  const pkg = JSON.parse(readFileSync(p, "utf8"));
  const lic = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type).join(" OR ");
  add(pkg.name, pkg.version, lic);
  for (const d of Object.keys(pkg.dependencies ?? {})) walk(d);
}
const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const d of Object.keys(app.dependencies ?? {})) walk(d);

// Rust: cargo metadata for the crates in the build.
try {
  const cargo = process.env.CARGO ?? "cargo";
  const meta = JSON.parse(
    execFileSync(cargo, ["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc", "--manifest-path", join(root, "src-tauri", "Cargo.toml")], {
      maxBuffer: 1 << 28,
      env: { ...process.env, PATH: `${process.env.USERPROFILE}\\.cargo\\bin;${process.env.PATH}` },
    }).toString(),
  );
  const used = new Set((meta.resolve?.nodes ?? []).map((n) => n.id));
  for (const p of meta.packages) if (p.name !== "off-player" && (!used.size || used.has(p.id))) add(p.name, p.version, p.license);
} catch (e) {
  console.warn("cargo metadata unavailable; Rust crates not listed:", e.message);
}

// Native components shipped next to the app.
add("mpv (libmpv)", "0.42", "LGPL-2.1-or-later");
add("FFmpeg (ffmpeg, ffprobe)", "9.0 (LGPL shared build)", "LGPL-2.1-or-later");

const list = [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(join(root, "src", "generated"), { recursive: true });
writeFileSync(join(root, "src", "generated", "licenses.json"), JSON.stringify(list, null, 0));
console.log(`licenses.json: ${list.length} components`);
