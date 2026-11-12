#!/usr/bin/env node
/**
 * Build and verify a NOINDEX HML release bundle. No production publishing.
 * Uses only explicit allowlisted paths; never packages environment files or credentials.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, ".release-out");
const targets = [
  "package.json", "package-lock.json",
  "backend/package.json", "frontend/package.json", "contracts/package.json",
  "backend/dist", "frontend/dist", "contracts/dist", "backend/migrations",
  "data/catalog-v1.json", "data/course-details.json"
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const run = (args, cwd = root) => execFileSync(args[0], args.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitSha = () => {
  const sha = run(["git", "rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid source commit");
  return sha;
};
const safeRel = (path) => {
  if (!path || isAbsolute(path) || path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error("Unsafe package path: " + path);
  }
  return path;
};
const inside = (base, path) => {
  const rel = relative(base, path);
  if (rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) throw new Error("Path escapes release directory");
  return path;
};
async function listFiles(path, prefix = "") {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error("Symlinks are forbidden in release bundle: " + prefix);
  if (info.isFile()) return [prefix];
  if (!info.isDirectory()) throw new Error("Unsupported source type: " + prefix);
  const result = [];
  for (const entry of (await readdir(path)).sort()) {
    if (entry.startsWith(".")) throw new Error("Hidden file forbidden in release bundle: " + entry);
    result.push(...await listFiles(join(path, entry), prefix ? prefix + "/" + entry : entry));
  }
  return result;
}
async function hashFiles(base) {
  const files = (await listFiles(base)).sort();
  return Promise.all(files.map(async (path) => {
    safeRel(path);
    const data = await readFile(inside(base, join(base, path)));
    return { path, bytes: data.byteLength, sha256: sha256(data) };
  }));
}
async function build(allowDirty = false) {
  if (process.env.PUBLIC_SITE_LIVE === "true") throw new Error("Cannot release a live site through HML packaging");
  const sourceSha = gitSha();
  const sourceClean = run(["git", "status", "--porcelain", "--untracked-files=all"]) === "";
  if (!sourceClean && !allowDirty) throw new Error("Release requires a clean Git checkout; --allow-dirty only for local rehearsal");
  const index = await readFile(join(root, "frontend/dist/index.html"), "utf8");
  if (!index.includes('name="robots" content="noindex, nofollow"')) throw new Error("HML build must have noindex, nofollow");
  const bundleDir = join(outRoot, "empresas-hml-" + sourceSha);
  try { await lstat(bundleDir); throw new Error("Release output already exists; remove it explicitly before rebuilding"); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  await mkdir(bundleDir, { recursive: true });
  const stage = join(bundleDir, "payload");
  await mkdir(stage);
  for (const item of targets) {
    safeRel(item);
    const origin = inside(root, join(root, item));
    const files = await listFiles(origin, item);
    if (!files.length) throw new Error("Empty release component: " + item);
    for (const path of files) {
      const target = inside(stage, join(stage, path));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(root, path), target);
    }
  }
  const files = await hashFiles(stage);
  const manifest = {
    schemaVersion: 1,
    application: "vivaion-empresas",
    channel: "hml",
    publicSiteLive: false,
    payable: false,
    sourceSha,
    sourceClean,
    files
  };
  await writeFile(join(stage, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(stage, "SHA256SUMS"), files.map((item) => item.sha256 + "  " + item.path).join("\n") + "\n");
  const archiveName = "empresas-hml-" + sourceSha + ".tgz";
  const archivePath = join(bundleDir, archiveName);
  // GNU tar sorts entries, strips user/group identities and normalizes timestamps.
  run(["tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-czf", archivePath, "-C", stage, "."]);
  const archiveSha = sha256(await readFile(archivePath));
  await writeFile(join(bundleDir, archiveName + ".sha256"), archiveSha + "  " + archiveName + "\n");
  console.log(JSON.stringify({ status: "built", sourceSha, sourceClean, archive: archivePath, sha256: archiveSha, fileCount: files.length }, null, 2));
}
async function verify(input) {
  if (!input) throw new Error("Pass a release bundle directory (under .release-out)");
  const bundleDir = inside(outRoot, resolve(root, input));
  const name = basename(bundleDir);
  if (!/^empresas-hml-[0-9a-f]{40}$/.test(name)) throw new Error("Invalid bundle directory name");
  const archiveName = name + ".tgz";
  const archivePath = inside(bundleDir, join(bundleDir, archiveName));
  const [signature, archiveBytes] = await Promise.all([
    readFile(join(bundleDir, archiveName + ".sha256"), "utf8"),
    readFile(archivePath)
  ]);
  const expected = sha256(archiveBytes);
  if (signature.trim() !== expected + "  " + archiveName) throw new Error("Archive SHA-256 mismatch");
  const temp = await mkdtemp(join(tmpdir(), "empresas-hml-verify-"));
  try {
    const list = run(["tar", "-tzf", archivePath]).split("\n").filter(Boolean);
    for (const entry of list) {
      const rel = entry.replace(/^\.\//, "").replace(/\/$/, "");
      if (!rel) continue;
      safeRel(rel);
    }
    run(["tar", "-xzf", archivePath, "--no-same-owner", "--no-same-permissions", "-C", temp]);
    const manifest = JSON.parse(await readFile(join(temp, "release-manifest.json"), "utf8"));
    if (manifest.schemaVersion !== 1 || manifest.channel !== "hml" || manifest.publicSiteLive !== false ||
        manifest.payable !== false || manifest.sourceSha !== name.slice("empresas-hml-".length)) {
      throw new Error("Invalid release manifest");
    }
    const currentFiles = (await hashFiles(temp)).filter((f) => f.path !== "release-manifest.json" && f.path !== "SHA256SUMS");
    if (JSON.stringify(currentFiles) !== JSON.stringify(manifest.files)) throw new Error("File hashes do not match manifest");
    const sums = currentFiles.map((f) => f.sha256 + "  " + f.path).join("\n") + "\n";
    if (sums !== await readFile(join(temp, "SHA256SUMS"), "utf8")) throw new Error("SHA256SUMS mismatch");
    const index = await readFile(join(temp, "frontend/dist/index.html"), "utf8");
    if (!index.includes('name="robots" content="noindex, nofollow"')) throw new Error("Noindex missing");
    console.log(JSON.stringify({ status: "verified", sourceSha: manifest.sourceSha, sourceClean: manifest.sourceClean, files: currentFiles.length, archiveSha256: expected }, null, 2));
  } finally { await rm(temp, { recursive: true, force: true }); }
}
const [command, ...args] = process.argv.slice(2);
try {
  if (command === "build") await build(args.includes("--allow-dirty"));
  else if (command === "verify") await verify(args[0]);
  else throw new Error("Usage: node scripts/release-candidate.mjs build [--allow-dirty] | verify .release-out/empresas-hml-<sha>");
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
