import { connectApp } from '@pioneer/app-sdk/client';
import type { Theme } from '@pioneer/app-sdk/client';

// Browser module initialization, BEFORE load/DOMContentLoaded. The installed
// backend renders base href from its authenticated pioneer-app-base-path header.
// For a direct root dev server, use connectApp({ baseUrl: '/' }) here instead.
// SSR imports do not connect. This example never applies DOM/style mutations.
const connection = typeof window === 'undefined' ? null : connectApp();

// UI state can attach later: subscribe immediately supplies a captured palette.
export async function mountView(setTheme: (theme: Readonly<Theme>) => void) {
  if (!connection) throw new Error('Mount the view in a browser');
  const app = await connection;
  const unsubscribe = app.theme.subscribe(setTheme);
  return {
    loadState: () => fetch(app.url('/state'), { credentials: 'omit' }),
    openStream: () => new WebSocket(app.webSocketUrl('/terminal')),
    dispose() { unsubscribe(); app.dispose(); },
  };
}
