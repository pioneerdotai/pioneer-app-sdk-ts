import { connectApp } from '@pioneer/app-sdk/client';

// Server renders <base href> using authenticated pioneer-app-base-path.
const app = await connectApp();
const unsubscribe = app.theme.subscribe(theme => {
  document.documentElement.style.colorScheme = theme.appearance;
  document.body.style.backgroundColor = theme.background;
});
export const loadState = () => fetch(app.url('/state'), { credentials: 'omit' });
export const openStream = () => new WebSocket(app.webSocketUrl('/terminal'));
export function dispose() { unsubscribe(); app.dispose(); }
