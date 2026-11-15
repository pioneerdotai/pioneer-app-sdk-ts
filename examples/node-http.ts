import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { createAppServerContext, nodeRequestHeaders, PioneerError } from '@pioneercompany/app-sdk/server';

const app = await createAppServerContext();
// Attach these functions to the application's existing server. SDK starts none.
export function handleHttp(req: IncomingMessage, res: ServerResponse) {
  try {
    const headers = nodeRequestHeaders(req);
    if (req.url === '/healthz') {
      app.authenticateServiceRequest(headers);
      res.writeHead(200).end('ready');
      return;
    }
    const context = app.authenticateRequest(headers);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user: context.user.id }));
  } catch (error) {
    res.writeHead(error instanceof PioneerError && error.code === 'sdk.user_missing' ? 403 : 401).end();
  }
}
export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  try {
    const context = app.authenticateRequest(nodeRequestHeaders(req));
    // Pass req, socket, head, context to your authorized WebSocket handler here.
    void context; void head;
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  } catch {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  }
}
export const close = () => app.close(); // Called by application lifecycle owner.
