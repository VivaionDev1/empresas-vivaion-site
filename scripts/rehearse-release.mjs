#!/usr/bin/env node
// Rehearse an atomic HML release pointer switch and rollback IN THIS WORKSPACE ONLY.
// Does not touch Apache, systemd, production, or the host's HML directory.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rehearsalRoot = join(root, ".release-rehearsal");
const bundleArg = process.argv[2];
if (!bundleArg) throw new Error("Provide .release-out/empresas-hml-<sha> directory");
const bundle = resolve(root, bundleArg);
if (!bundle.startsWith(join(root, ".release-out") + "/") || !/^empresas-hml-[a-f0-9]{40}$/.test(basename(bundle))) {
  throw new Error("Only packages generated in this workspace are accepted");
}
const name = basename(bundle);
const tarball = join(bundle, name + ".tgz");
const exec = (cmd, args) => execFileSync(cmd, args, {cwd:root,stdio:["ignore","pipe","pipe"],encoding:"utf8"}).trim();
const marker = async (link) => (await readFile(join(link, "rehearsal-marker.txt"), "utf8")).trim();

async function main() {
  exec("node", ["scripts/release-candidate.mjs", "verify", bundleArg]);
  await mkdir(rehearsalRoot, {recursive:true});
  const session = await mkdtemp(join(rehearsalRoot, "session-"));
  try {
    const releases = join(session, "releases");
    await mkdir(releases);
    for (const slot of ["baseline", "candidate"]) {
      const path = join(releases, slot);
      await mkdir(path);
      exec("tar", ["-xzf", tarball, "--no-same-owner", "--no-same-permissions", "-C", path]);
      const manifest = JSON.parse(await readFile(join(path,"release-manifest.json"),"utf8"));
      if (manifest.channel !== "hml" || manifest.publicSiteLive !== false) throw new Error("Unsafe HML manifest");
      await readFile(join(path,"frontend/dist/index.html"),"utf8");
      await readFile(join(path,"backend/dist/src/server.js"),"utf8");
      await writeFile(join(path, "rehearsal-marker.txt"), slot);
    }
    const current = join(session, "current");
    const switchTo = async (slot) => {
      const next = join(session, "next");
      await symlink(join("releases", slot), next);
      await rename(next, current);
      if (await marker(current) !== slot) throw new Error("Activation mismatch: " + slot);
      return {link: await readlink(current), marker: await marker(current)};
    };
    await symlink("releases/baseline", current);
    if (await marker(current) !== "baseline") throw new Error("Baseline unhealthy");
    const switched = await switchTo("candidate");
    const rolledBack = await switchTo("baseline");
    if (rolledBack.marker !== "baseline" || switched.marker !== "candidate") throw new Error("Rollback assertion failed");
    console.log(JSON.stringify({
      status:"passed", scope:"workspace-rootless-only", sourceSha:name.slice("empresas-hml-".length),
      baseline:"baseline", switch:switched, rollback:rolledBack,
      note:"This does not test HML host systemd/Apache or its real backups."
    },null,2));
  } finally { await rm(session, {recursive:true,force:true}); }
}
main().catch((e)=>{console.error(e.message);process.exitCode=1;});
