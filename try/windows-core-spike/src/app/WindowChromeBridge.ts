import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

export interface WindowChromeBridge {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  onCloseRequested(handler: () => void): Promise<() => void>;
}

export class NoopWindowChromeBridge implements WindowChromeBridge {
  async minimize(): Promise<void> {}

  async toggleMaximize(): Promise<void> {}

  async close(): Promise<void> {}

  async onCloseRequested(): Promise<() => void> {
    return () => {};
  }
}

export class TauriWindowChromeBridge implements WindowChromeBridge {
  constructor(private readonly window?: Window) {}

  private currentWindow(): Window | null {
    // Resolve the native handle only when a window action is invoked. This
    // keeps ordinary Web/unit rendering independent from the Tauri runtime.
    if (this.window) return this.window;
    if (!("__TAURI_INTERNALS__" in globalThis)) return null;
    return getCurrentWindow();
  }

  minimize(): Promise<void> {
    return this.currentWindow()?.minimize() ?? Promise.resolve();
  }

  toggleMaximize(): Promise<void> {
    return this.currentWindow()?.toggleMaximize() ?? Promise.resolve();
  }

  close(): Promise<void> {
    return this.currentWindow()?.destroy() ?? Promise.resolve();
  }

  onCloseRequested(handler: () => void): Promise<() => void> {
    const currentWindow = this.currentWindow();
    if (!currentWindow) return Promise.resolve(() => {});
    return currentWindow.onCloseRequested((event) => {
      event.preventDefault();
      handler();
    });
  }
}
