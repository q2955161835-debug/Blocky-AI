import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

export interface WindowChromeBridge {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export class NoopWindowChromeBridge implements WindowChromeBridge {
  async minimize(): Promise<void> {}

  async toggleMaximize(): Promise<void> {}

  async close(): Promise<void> {}
}

export class TauriWindowChromeBridge implements WindowChromeBridge {
  constructor(private readonly window?: Window) {}

  private currentWindow(): Window {
    // Resolve the native handle only when a window action is invoked. This
    // keeps ordinary Web/unit rendering independent from the Tauri runtime.
    return this.window ?? getCurrentWindow();
  }

  minimize(): Promise<void> {
    return this.currentWindow().minimize();
  }

  toggleMaximize(): Promise<void> {
    return this.currentWindow().toggleMaximize();
  }

  close(): Promise<void> {
    return this.currentWindow().close();
  }
}
