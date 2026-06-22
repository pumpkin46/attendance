/**
 * Bridge to the desktop app's host window (an embedded WebView2). All of this
 * is inert in a normal browser: the bridge is absent, so the helpers no-op and
 * {@link isDesktopApp} returns false.
 */

type WindowAction = 'minimize' | 'maximize' | 'close'

interface WebView2Bridge {
  postMessage(message: unknown): void
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', handler: (event: MessageEvent) => void): void
}

function bridge(): WebView2Bridge | undefined {
  return (window as unknown as { chrome?: { webview?: WebView2Bridge } }).chrome?.webview
}

/** True when running inside the desktop app's WebView2 host (not a browser). */
export const isDesktopApp = (): boolean => !!bridge()

/** Ask the host window to minimize, toggle-maximize, or close (hide to tray). */
export function sendWindowAction(action: WindowAction): void {
  bridge()?.postMessage({ type: 'window', action })
}

/** Ask the host to (re)broadcast its current maximized state. */
export function requestWindowState(): void {
  bridge()?.postMessage({ type: 'window', action: 'state' })
}

/** Subscribe to host maximized-state changes; returns an unsubscribe function. */
export function onMaximizedChange(cb: (maximized: boolean) => void): () => void {
  const wv = bridge()
  if (!wv) return () => {}
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; maximized?: boolean } | null
    if (data?.type === 'window-state' && typeof data.maximized === 'boolean') cb(data.maximized)
  }
  wv.addEventListener('message', handler)
  return () => wv.removeEventListener('message', handler)
}

/** CSS classes (see index.css) marking a region draggable / not, in the desktop app. */
export const DRAG_REGION = 'app-drag'
export const NO_DRAG_REGION = 'app-no-drag'
