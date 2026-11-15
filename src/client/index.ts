import { failure } from "../error.js";
export { PioneerError } from "../error.js";

export interface Theme {
  readonly appearance: "light" | "dark";
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly accent: string;
  readonly "accent-foreground": string;
}
export interface ConnectAppOptions {
  /** Exact grant root, absolute or relative to document URL; must end in /. */
  baseUrl?: string;
}
export interface AppClient {
  readonly theme: {
    readonly current: Readonly<Theme> | null;
    /** Delivers current synchronously if known, then future updates. */
    subscribe(listener: (theme: Readonly<Theme>) => void): () => void;
  };
  url(path: string): string;
  webSocketUrl(path: string): string;
  dispose(): void;
}

/** Resolves immediately: Pioneer has no theme handshake or readiness event. */
export async function connectApp(options: ConnectAppOptions = {}): Promise<AppClient> {
  if (typeof window === "undefined") throw failure("sdk.browser_required");
  // Only an explicit base element is trusted. document.baseURI alone could be
  // an arbitrary nested document, and inferring a grant token is not a contract.
  const configured = options.baseUrl ?? document.querySelector("base[href]")?.getAttribute("href");
  if (!configured) throw failure("sdk.base_url_required");
  let root: URL;
  try { root = new URL(configured, window.location.href); }
  catch { throw failure("sdk.invalid_url"); }
  if (!["http:", "https:"].includes(root.protocol) || root.origin !== new URL(window.location.href).origin ||
      root.username || root.password || root.search || root.hash || !root.pathname.endsWith("/")) {
    throw failure("sdk.invalid_url");
  }
  let disposed = false;
  let current: Readonly<Theme> | null = null;
  const listeners = new Set<(theme: Readonly<Theme>) => void>();
  const receive = (event: MessageEvent) => {
    if (disposed) return;
    if (window.parent === window) {
      if (event.source !== window || event.origin !== window.location.origin) return;
    } else if (event.source !== window.parent) return;
    // Embedded origin may be opaque; direct dev views use self + exact origin.
    // A theme message never authenticates a user or a backend request.
    const data = event.data;
    if (!data || data.type !== "pioneer.theme" || !data.palette) return;
    const value = data.palette;
    if (value.appearance !== "dark" && value.appearance !== "light") return;
    const colors = ["background", "foreground", "muted", "border", "accent", "accent-foreground"] as const;
    for (const key of colors) {
      if (typeof value[key] !== "string" || value[key].length > 128 || !CSS.supports("color", value[key])) return;
    }
    current = Object.freeze({ appearance: value.appearance, ...Object.fromEntries(colors.map(key => [key, value[key]])) }) as Readonly<Theme>;
    for (const listener of [...listeners]) {
      if (disposed) break;
      if (!listeners.has(listener)) continue;
      try { listener(current); } catch { /* One consumer cannot block others. */ }
    }
  };
  window.addEventListener("message", receive);
  const url = (path: string) => {
    if (disposed) throw failure("sdk.closed");
    // Reject encoded separators/dots too, including nested encoding: proxies
    // disagree about decoding order. Query contents are left intact.
    if (typeof path !== "string" || /[\u0000-\u0020\\]/.test(path) || path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) throw failure("sdk.invalid_url");
    const pathname = path.split(/[?#]/, 1)[0];
    if (/%(?:2e|2f|5c|25)/i.test(pathname) || pathname.split("/").some(part => part === "." || part === "..")) throw failure("sdk.invalid_url");
    const target = new URL(path.replace(/^\//, ""), root);
    if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) throw failure("sdk.invalid_url");
    return target.href;
  };
  return Object.freeze({
    theme: Object.freeze({
      get current() { return current; },
      subscribe(listener: (theme: Readonly<Theme>) => void) {
        if (disposed) throw failure("sdk.closed");
        listeners.add(listener);
        if (current) {
          try { listener(current); } catch { /* Match update delivery isolation. */ }
        }
        return () => { listeners.delete(listener); };
      },
    }),
    url,
    webSocketUrl(path: string) {
      const target = new URL(url(path));
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      return target.href;
    },
    dispose() { disposed = true; listeners.clear(); window.removeEventListener("message", receive); },
  });
}
