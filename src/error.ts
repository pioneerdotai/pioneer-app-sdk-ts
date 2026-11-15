/** Stable machine code; messages contain no remote text, credentials or payloads. */
export class PioneerError extends Error {
  readonly name = "PioneerError";
  constructor(
    readonly code: string,
    message: string,
    readonly source: "sdk" | "host" = "sdk",
    readonly rpcCode?: number,
  ) {
    super(message);
  }
}

export const failure = (code: string) => new PioneerError(code, `Pioneer operation failed (${code}).`);
export function hostFailure(code: unknown, rpcCode?: number): PioneerError {
  const safe = typeof code === "string" && /^host\.[a-z_]{1,64}$/.test(code) ? code : "host.operation_failed";
  return new PioneerError(safe, `Gateway rejected operation (${safe}).`, "host", rpcCode);
}
