import { failure } from "../error.js";
export { PioneerError } from "../error.js";

import { decodeTheme, type Theme } from "./theme.js";
export { THEME_COLOR_KEYS, THEME_CONFIG_COLOR_KEYS } from "./theme.js";
export type {
  Theme, ThemeMode, ThemeValue, ThemeObject, ThemeColorName, ThemeColors,
  ThemeConfig, ThemeConfigColors, ThemeConfigColorName, ThemeToken,
} from "./theme.js";

export interface ConnectAppOptions {
  /** Exact grant root, absolute or relative to document URL; must end in /. */
  baseUrl?: string;
}
/** Fullscreen fills Pioneer's application area, not the operating system screen. */
export type AppPlacement = "fullscreen" | "bottom" | "right";
export interface AppClient {
  readonly view: {
    /** Moves this open view without navigating or restarting the application. */
    setPlacement(placement: AppPlacement): Promise<void>;
    /** Requests closing this application view. No acknowledgement. */
    close(): void;
  };
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
  const page = new URL(window.location.href);
  const nativeBase = (window as Window & { __pioneerAppBaseUrl?: unknown }).__pioneerAppBaseUrl;
  const devBase = window.parent === window && typeof nativeBase === "string" ? nativeBase : undefined;
  const configured = options.baseUrl ?? devBase ?? document.querySelector("base[href]")?.getAttribute("href");
  if (!configured) throw failure("sdk.base_url_required");
  let root: URL;
  try { root = new URL(configured, page); }
  catch { throw failure("sdk.invalid_url"); }
  if (!["http:", "https:"].includes(root.protocol) ||
      root.username || root.password || root.search || root.hash || !root.pathname.endsWith("/")) {
    throw failure("sdk.invalid_url");
  }
  if (root.origin !== page.origin) {
    const loopback = (url: URL) => url.hostname === "localhost" || url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (options.baseUrl !== undefined || configured !== devBase || page.protocol !== "http:" ||
        !loopback(page) || !loopback(root) ||
        !/\/storage\/app-views\/[A-Za-z0-9_-]{43}\/$/.test(root.pathname)) {
      throw failure("sdk.invalid_url");
    }
  }
  let disposed = false;
  let current: Readonly<Theme> | null = null;
  const listeners = new Set<(theme: Readonly<Theme>) => void>();
  const pending = new Map<string, {
    placement: AppPlacement;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  // Available even in opaque sandbox origins (no secure-context requirement).
  const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  const postViewRequest = (message: { type: string; id: string; placement?: AppPlacement }) => {
    const direct = window.parent === window;
    window.parent.postMessage(message, direct ? window.location.origin : "*");
  };
  const receive = (event: MessageEvent) => {
    if (disposed) return;
    if (window.parent === window) {
      if (event.source !== window || event.origin !== window.location.origin) return;
    } else if (event.source !== window.parent) return;
    // Embedded origin may be opaque; direct dev views use self + exact origin.
    // A theme message never authenticates a user or a backend request.
    const data = event.data;
    if (data?.type === "pioneer.view.result" && typeof data.id === "string") {
      const call = pending.get(data.id);
      if (call && data.placement === call.placement) {
        pending.delete(data.id);
        clearTimeout(call.timer);
        call.resolve();
      }
      return;
    }
    if (!data || data.type !== "pioneer.theme") return;
    const theme = decodeTheme(data.theme);
    if (!theme) return;
    current = theme;
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
    view: Object.freeze({
      setPlacement(placement: AppPlacement): Promise<void> {
        if (disposed) return Promise.reject(failure("sdk.closed"));
        if (!["fullscreen", "bottom", "right"].includes(placement)) return Promise.reject(failure("sdk.invalid_placement"));
        if (pending.size >= 16) return Promise.reject(failure("sdk.view_overloaded"));
        const id = requestId();
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(failure("sdk.view_timeout"));
          }, 5000);
          pending.set(id, { placement, resolve, reject, timer });
          try {
            postViewRequest({ type: "pioneer.view.setPlacement", id, placement });
          } catch {
            pending.delete(id);
            clearTimeout(timer);
            reject(failure("sdk.view_unavailable"));
          }
        });
      },
      close(): void {
        if (disposed) throw failure("sdk.closed");
        try { postViewRequest({ type: "pioneer.view.close", id: requestId() }); }
        catch { throw failure("sdk.view_unavailable"); }
      },
    }),
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
    dispose() {
      disposed = true;
      listeners.clear();
      window.removeEventListener("message", receive);
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(failure("sdk.closed"));
      }
      pending.clear();
    },
  });
}
