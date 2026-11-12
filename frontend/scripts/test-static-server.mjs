// Isolated static preview for Playwright; not part of production deployment.
import { createServer, request as httpRequest } from "node:http";
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
      // Only CI acceptance mode may proxy to a disposable API on loopback.
      // No user-supplied upstream host, production deployment or external port.
      if (process.env.E2E_FULLSTACK === "true") {
        const upstream = httpRequest({
          hostname: "127.0.0.1", port: 8082,
          path: req.url, method: req.method,
          headers: { ...req.headers, host: "127.0.0.1:8082" }
        }, (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        });
        upstream.on("error", () => {
          if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Disposable API unavailable");
        });
        req.pipe(upstream);
        return;
      }
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
