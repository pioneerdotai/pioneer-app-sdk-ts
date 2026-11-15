import { failure } from "../error.js";

export interface PtyHead {
  readonly start: number;
  readonly end: number;
  readonly exitStatus: number | null;
  readonly failed: boolean;
}
export interface PtySnapshot {
  readonly after: number;
  readonly next: number;
  readonly end: number;
  readonly bytes: Uint8Array;
  readonly exitStatus: number | null;
  readonly failed: boolean;
  readonly inputSequence: number;
}
export function unsigned(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function status(value: unknown): value is number | null {
  return value === null || (unsigned(value) && value <= 0xffffffff);
}
export function decodeSnapshot(raw: unknown, after: number): PtySnapshot {
  const value = raw as Record<string, unknown> | null;
  if (!value || !Array.isArray(value.bytes) || value.bytes.length > 16384 ||
      !value.bytes.every(byte => unsigned(byte) && byte <= 255) ||
      !unsigned(value.next) || value.next !== after + value.bytes.length ||
      !unsigned(value.end) || value.end < value.next || !status(value.exit_status) ||
      typeof value.failed !== "boolean" || !unsigned(value.input_sequence)) throw failure("sdk.invalid_output");
  return Object.freeze({ after, next: value.next, end: value.end, bytes: Uint8Array.from(value.bytes),
    exitStatus: value.exit_status, failed: value.failed, inputSequence: value.input_sequence });
}
export function decodeHeads(raw: unknown): readonly { id: string; head: PtyHead }[] {
  const value = raw as { sessions?: unknown } | null;
  if (!value || !Array.isArray(value.sessions) || value.sessions.length > 8) throw failure("sdk.invalid_output");
  return value.sessions.map(item => {
    if (!item || typeof item.session_id !== "string" || !unsigned(item.start) ||
        !unsigned(item.end) || item.end < item.start || !status(item.exit_status) || typeof item.failed !== "boolean") throw failure("sdk.invalid_output");
    return { id: item.session_id, head: Object.freeze({ start: item.start, end: item.end,
      exitStatus: item.exit_status, failed: item.failed }) };
  });
}
