import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, isAbsolute, normalize, relative, resolve } from 'node:path';

/**
 * A small static server for the demo and lab pages.
 *
 * Hand-written rather than pulled in as a dependency for the same reason the
 * smoke test is: it serves a handful of files, and its containment rule is short
 * enough to read and check.
 */

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

export interface StaticMount {
  /** URL path prefix, e.g. `/` or `/vendor`. */
  prefix: string;
  /** Absolute directory on disk. */
  dir: string;
  /** Shown instead of a bare 404 when a file is missing, keyed by path. */
  missingHint?: Readonly<Record<string, string>>;
}

export interface StaticServerOptions {
  port: number;
  mounts: readonly StaticMount[];
  /** Called with the bound port once listening. */
  onReady?: (port: number) => void;
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * Resolve a request path inside a mount, or return null.
 *
 * The containment check is on the *resolved* path, not the raw one. Comparing
 * prefixes on the request string is the classic traversal bug: `/static/../..`
 * passes a naive check and then escapes.
 */
function locate(
  mounts: readonly StaticMount[],
  pathname: string,
): { file: string } | string | null {
  for (const mount of mounts) {
    if (!pathname.startsWith(mount.prefix)) continue;
    const tail = pathname.slice(mount.prefix.length).replace(/^\/+/, '');
    const wanted = tail === '' ? 'index.html' : tail;
    const file = resolve(mount.dir, normalize(wanted));

    // Containment is decided with `relative`, which is separator-aware on every
    // platform. Comparing string prefixes against a literal "/" is the bug that
    // made this server refuse every request on Windows: `resolve` returns
    // backslash paths there, so the boundary never matched.
    const rel = relative(mount.dir, file);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return 'Forbidden';
    }
    if (existsSync(file) && statSync(file).isFile()) {
      return { file };
    }
    const hint = mount.missingHint?.[pathname];
    if (hint) return hint;
  }
  return null;
}

export function serveStatic(options: StaticServerOptions): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${options.port}`);

    if (url.pathname === '/healthz') {
      send(res, 200, 'application/json; charset=utf-8', '{"ok":true}');
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      send(res, 400, 'text/plain', 'Bad request');
      return;
    }

    const found = locate(options.mounts, pathname);
    if (found === null) {
      send(res, 404, 'text/plain', 'Not found\n');
      return;
    }
    if (typeof found === 'string') {
      send(res, found === 'Forbidden' ? 403 : 404, 'text/plain', `${found}\n`);
      return;
    }

    res.writeHead(200, {
      'content-type': TYPES[extname(found.file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(found.file).pipe(res);
  });

  server.listen(options.port, () => options.onReady?.(options.port));
  return server;
}
