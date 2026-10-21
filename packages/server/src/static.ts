import { existsSync, statSync, createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/**
 * Serves the built client from `dir` so one process is enough. Anything that
 * is not a file and has no extension gets index.html (the app routes itself);
 * a path that climbs out of `dir` never reaches the disk. Returns a request
 * handler; socket.io answers its own /socket.io/ paths before this is asked.
 */
export function createStaticHandler(dir: string) {
  const root = resolve(dir);
  const send = (res: ServerResponse, status: number, body: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      return send(res, 400, 'bad request');
    }
    if (pathname.includes('\0')) return send(res, 400, 'bad request');

    let file = resolve(join(root, normalize(pathname)));
    if (file !== root && !file.startsWith(root + sep)) return send(res, 403, 'forbidden');
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (extname(pathname)) return send(res, 404, 'not found');
      file = join(root, 'index.html');
      if (!existsSync(file)) return send(res, 404, 'the client has not been built (npm run build)');
    }

    const rel = file.slice(root.length + 1).split(sep).join('/');
    const hashed = rel.startsWith('assets/'); // vite names these by content hash
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  };
}
