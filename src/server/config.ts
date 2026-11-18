import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { failure, PioneerError } from "../error.js";

/** Input only: never attach this credential-bearing value to public contexts. */
export interface Bootstrap {
  execution_id: string;
  ui_base_path?: string;
  ui_proxy: { credential: string };
  host_api: { endpoint: string; credential: string; capabilities: string[] } | null;
}
export interface ServerOptions { bootstrap?: unknown; bootstrapPath?: string; appData?: string }
export async function configuration(options: ServerOptions): Promise<{ bootstrap: Bootstrap; appData: string }> {
  const configuredPath = options.bootstrapPath ?? process.env.PIONEER_BOOTSTRAP;
  const development = process.env.NODE_ENV === "development"
    && options.bootstrap === undefined && configuredPath === undefined;
  const appData = options.appData ?? process.env.APP_DATA
    ?? (development ? resolve(".pioneer-data") : undefined);
  if (typeof appData !== "string" || !appData || !isAbsolute(appData) || appData.includes("\0")) throw failure("sdk.invalid_app_data");
  let value = options.bootstrap;
  if (value === undefined) {
    const path = development ? resolve("credential.json") : configuredPath;
    if (!path || !isAbsolute(path)) throw failure("sdk.bootstrap_missing");
    try {
      const file = await open(path, "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 16384) throw failure("sdk.invalid_bootstrap");
        const buffer = Buffer.alloc(16385);
        let length = 0;
        while (length < buffer.length) {
          const read = await file.read(buffer, length, buffer.length - length, null);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > 16384) throw failure("sdk.invalid_bootstrap");
        value = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      } finally { await file.close(); }
    } catch (error) {
      if (development && (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new PioneerError("sdk.dev_credentials_missing", "Save the JSON from pioneer dev app add as credential.json in the project root.");
      }
      if (development) throw invalidDevelopmentCredentials();
      throw failure("sdk.invalid_bootstrap");
    }
  }
  try {
    // Copy only validated fields; reject non-JSON explicit configuration too.
    const raw = JSON.stringify(value);
    if (!raw || Buffer.byteLength(raw) > 16384) throw new Error();
    const v = JSON.parse(raw);
    if (!v || !/^[A-Za-z0-9_-]{21}$/.test(v.execution_id) || typeof v.execution_id !== "string" ||
        typeof v.ui_proxy?.credential !== "string" || !/^[a-f0-9]{64}$/.test(v.ui_proxy.credential) ||
        (v.ui_base_path !== undefined && v.ui_base_path !== "/")) throw new Error();
    let host: Bootstrap["host_api"] = null;
    if (development && v.host_api === null) throw new Error();
    if (v.host_api !== null) {
      const h = v.host_api;
      if (!h || typeof h.endpoint !== "string" || typeof h.credential !== "string" || !/^[a-f0-9]{64}$/.test(h.credential) ||
          !Array.isArray(h.capabilities) || !h.capabilities.every((c: unknown) => typeof c === "string" && c.length <= 128)) throw new Error();
      const url = new URL(h.endpoint);
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      host = { endpoint: url.href, credential: h.credential, capabilities: [...h.capabilities] };
    }
    return { appData, bootstrap: { execution_id: v.execution_id, ui_proxy: { credential: v.ui_proxy.credential }, host_api: host } };
  } catch {
    if (development) throw invalidDevelopmentCredentials();
    throw failure("sdk.invalid_bootstrap");
  }
}

function invalidDevelopmentCredentials() {
  return new PioneerError("sdk.invalid_bootstrap", "Invalid credential.json. Save the JSON from pioneer dev app add again.");
}
