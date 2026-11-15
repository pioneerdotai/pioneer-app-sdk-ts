import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { configuration } from "./config.js";
import type { ServerOptions } from "./config.js";
import { Transport } from "./transport.js";
import { Pty } from "./pty.js";
import type { CreatePtyOptions } from "./pty.js";
import { failure } from "../error.js";
export { PioneerError } from "../error.js";
export type { Bootstrap, ServerOptions } from "./config.js";
export type { OperationOptions } from "./transport.js";
export type { Dimensions, CreatePtyOptions, OutputFrame, OutputSubscription, SubscribeOptions } from "./pty.js";
export type { Pty } from "./pty.js";

/** Return undefined for missing or duplicate fields. Header names are lowercase. */
export interface RequestHeaders { get(name: string): string | undefined }
export interface UserContext { readonly user: { readonly id: string } }
export interface AppServerContext {
  readonly execution: { readonly id: string };
  readonly appData: string;
  readonly host: {
    readonly capabilities: readonly string[];
    readonly pty: { create(options: CreatePtyOptions): Promise<Pty> };
  };
  authenticateServiceRequest(headers: RequestHeaders): void;
  authenticateRequest(headers: RequestHeaders): UserContext;
  close(): Promise<void>;
}

/** Preserve raw duplicate detection for both HTTP and upgrade requests. */
export function nodeRequestHeaders(request: Pick<IncomingMessage, "rawHeaders">): RequestHeaders {
  return {
    get(name) {
      const values: string[] = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        if (request.rawHeaders[i].toLowerCase() === name) values.push(request.rawHeaders[i + 1]);
      }
      return values.length === 1 ? values[0] : undefined;
    },
  };
}

export async function createAppServerContext(options: ServerOptions = {}): Promise<AppServerContext> {
  const { bootstrap, appData } = await configuration(options);
  const expected = Buffer.from(bootstrap.ui_proxy.credential, "ascii");
  const transport = new Transport(bootstrap.host_api);
  const capabilities = Object.freeze([...(bootstrap.host_api?.capabilities ?? [])]);
  const owned = new Set<Pty>();
  const creating = new Set<Promise<Pty>>();
  let stopped = false;
  let closing: Promise<void> | null = null;
  const assertOpen = () => { if (stopped) throw failure("sdk.closed"); };
  const authenticateServiceRequest = (headers: RequestHeaders) => {
    assertOpen();
    const actual = headers.get("pioneer-app-execution-credential");
    if (typeof actual !== "string" || !/^[a-f0-9]{64}$/.test(actual) || !timingSafeEqual(Buffer.from(actual, "ascii"), expected)) throw failure("sdk.unauthorized");
  };
  return Object.freeze({
    execution: Object.freeze({ id: bootstrap.execution_id }),
    appData,
    host: Object.freeze({
      capabilities,
      pty: Object.freeze({
        async create(options: CreatePtyOptions) {
          assertOpen();
          if (!capabilities.includes("host.pty")) throw failure("sdk.capability_unavailable");
          if (owned.size + creating.size >= 8) throw failure("sdk.capacity");
          let terminal: Pty;
          const operation = Pty.create(transport, options, () => { owned.delete(terminal); });
          creating.add(operation);
          try {
            terminal = await operation;
            if (stopped) { await terminal.close(); throw failure("sdk.closed"); }
            owned.add(terminal);
            return terminal;
          } finally { creating.delete(operation); }
        },
      }),
    }),
    authenticateServiceRequest,
    authenticateRequest(headers: RequestHeaders): UserContext {
      authenticateServiceRequest(headers);
      const id = headers.get("pioneer-app-user-id");
      if (typeof id !== "string" || !/^[A-Za-z0-9]{21}$/.test(id)) throw failure("sdk.user_missing");
      return Object.freeze({ user: Object.freeze({ id }) });
    },
    close() {
      if (closing) return closing;
      stopped = true;
      closing = (async () => {
        const settled = await Promise.allSettled([...creating]);
        const terminals = new Set([...owned, ...settled.flatMap(r => r.status === "fulfilled" ? [r.value] : [])]);
        const results = await Promise.allSettled([...terminals].map(terminal => terminal.close()));
        transport.close();
        expected.fill(0);
        if (results.some(r => r.status === "rejected")) throw failure("sdk.cleanup_incomplete");
      })();
      return closing;
    },
  });
}
