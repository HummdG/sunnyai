// Tiny local HTTP server for offline tests of the HTTP layer and provider failover.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request seen by the local server. */
export interface SeenRequest { method: string; url: string; headers: IncomingMessage['headers']; body: string; t: number }

/** Handle of a running local server. */
export interface LocalServer {
  url: string;
  host: string;
  requests: SeenRequest[];
  /** Max simultaneous in-flight requests observed. */
  maxActive: () => number;
  close: () => Promise<void>;
}

/** Starts a server on 127.0.0.1 with a random port. The handler may be async. */
export async function startLocalServer(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>): Promise<LocalServer> {
  const requests: SeenRequest[] = [];
  let active = 0;
  let maxActive = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body, t: Date.now() });
      res.on('close', () => active--);
      try {
        await handler(req, res, body);
      } catch (e) {
        res.statusCode = 599;
        res.end(String(e));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    requests,
    maxActive: () => maxActive,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** Promise-based delay. */
export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
