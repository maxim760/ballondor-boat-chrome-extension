const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Script } = require("node:vm");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const scripts = [...new Set(manifest.content_scripts.flatMap(entry => entry.js))];
const files = ["manifest.json", ...scripts];
for (const file of files) {
  if (path.basename(file) !== file) throw new Error(`Unsupported package path: ${file}`);
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (file.endsWith(".js")) new Script(source, { filename: file });
}
if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error("Invalid manifest version");

const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const staging = fs.mkdtempSync(path.join(dist, ".build-"));
try {
  for (const file of files) fs.copyFileSync(path.join(root, file), path.join(staging, file));
  // macOS includes zip. Explicit files exclude tests, README, .DS_Store and build tools.
  const archive = `ballondor2026-${manifest.version}.zip`;
  try {
    execFileSync("zip", ["-q", "-X", path.join(staging, archive), ...files], {
      cwd: staging, stdio: "pipe"
    });
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Нужна утилита zip (в macOS она встроена).");
    throw error;
  }
  const unpacked = path.join(dist, "unpacked");
  fs.mkdirSync(unpacked, { recursive: true });
  // Preserve the directory Chrome has registered; update packaged files in place.
  for (const file of files) fs.copyFileSync(path.join(staging, file), path.join(unpacked, file));
  fs.renameSync(path.join(staging, archive), path.join(dist, archive));
  console.log(`Папка для Chrome: ${unpacked}\nZIP: ${path.join(dist, archive)}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
