// Isolated static preview for Playwright; not part of production deployment.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep, join } from "node:path";

const root = resolve(process.cwd(), "dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};
const server = createServer(async (req, res) => {
  try {
    if ((req.url ?? "").startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_available_in_static_preview" }));
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1:4322");
    const raw = decodeURIComponent(url.pathname);
    if (raw.includes("\0") || raw.split("/").includes("..")) { res.writeHead(400); res.end(); return; }
    let file = resolve(root, "." + raw);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    createReadStream(file).pipe(res);
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Static preview error");
  }
});
server.listen(4322, "127.0.0.1", () => console.info("Playwright test preview ready at http://127.0.0.1:4322"));
