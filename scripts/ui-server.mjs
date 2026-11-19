import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function resolvePath(pathname) {
  const rel = pathname === "/" ? "ui/index.html" : pathname.replace(/^\/+/, "");
  const underUi = rel === "ui" || rel.startsWith("ui/");
  const underDist = rel === "dist" || rel.startsWith("dist/");
  if (!underUi && !underDist) return null;
  const file = normalize(join(root, rel));
  const uiRoot = join(root, "ui") + sep;
  const distRoot = join(root, "dist") + sep;
  if (!file.startsWith(uiRoot) && !file.startsWith(distRoot)) return null;
  return file;
}

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    const file = resolvePath(pathname);
    if (file === null) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const body = await readFile(file);
    const type = types[extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(body);
  } catch (err) {
    const missing = err !== null && typeof err === "object" && err.code === "ENOENT";
    res.writeHead(missing ? 404 : 400);
    res.end(missing ? "not found" : "bad request");
  }
});

server.on("error", (err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`UI at http://127.0.0.1:${port}/\n`);
});
