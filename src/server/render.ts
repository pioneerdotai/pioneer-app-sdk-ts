import type { Bootstrap } from "./config.js";
import { failure, hostFailure } from "../error.js";

const maxInput = 64 * 1024 * 1024;
const maxOutput = 32 * 1024 * 1024;

export interface ScreenshotOptions {
  path: string;
  input: unknown;
  signal?: AbortSignal;
}

export interface PdfOptions {
  html: string;
  signal?: AbortSignal;
}

export function createRender(
  host: Bootstrap["host_api"],
  assertOpen: () => void,
  lifetime: AbortSignal,
) {
  async function request(body: object, mime: string, signal?: AbortSignal) {
    assertOpen();
    if (!host?.capabilities.includes("host.render")) throw failure("sdk.capability_unavailable");
    const endpoint = new URL(host.endpoint);
    endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
    endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + "/render";
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > maxInput) throw failure("sdk.render_input_limit");
    const requestSignal = AbortSignal.any([
      lifetime, AbortSignal.timeout(240000), ...(signal ? [signal] : []),
    ]);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { authorization: "Bearer " + host.credential, "content-type": "application/json" },
        body: payload,
        signal: requestSignal,
      });
      if (!response.ok || !response.body || response.headers.get("content-type") !== mime) {
        if (response.body) await response.body.cancel();
        if (response.status === 429) throw hostFailure("host.render_busy");
        if (response.status === 401 || response.status === 403) throw hostFailure("host.revoked");
        throw hostFailure("host.render_failed");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > maxOutput) throw failure("sdk.render_output_limit");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!size) throw failure("sdk.render_empty_output");
      return { data: Buffer.concat(chunks, size), headers: response.headers };
    } catch (error) {
      if (requestSignal.aborted) throw failure("sdk.render_cancelled");
      if (error instanceof TypeError) throw failure("sdk.render_unavailable");
      throw error;
    }
  }

  return Object.freeze({
    async screenshot({ path, input, signal }: ScreenshotOptions) {
      const { data, headers } = await request({ operation: "screenshot", path, input }, "image/png", signal);
      const encoded = headers.get("pioneer-render-metadata");
      if (!encoded) throw failure("sdk.render_invalid_metadata");
      try {
        return { data, metadata: JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown };
      } catch {
        throw failure("sdk.render_invalid_metadata");
      }
    },
    async pdf({ html, signal }: PdfOptions) {
      return (await request({ operation: "pdf", html }, "application/pdf", signal)).data;
    },
  });
}
